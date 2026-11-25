import { randomBytes, randomUUID } from 'node:crypto';
import type { ProfileId, Session } from '../../contracts/index.ts';
import { manifests } from '../../spool/src/manifests.ts';
import type { ThreadActorRole } from '../../thread/inventory/contracts.ts';

export const SESSION_COOKIE_NAME = 'overlock_synthetic_session';
const MAX_SYNTHETIC_SESSIONS = 256;
const SYNTHETIC_SESSION_IDLE_MS = 30 * 60 * 1000;

export interface SessionResolution {
  token: string;
  profile: ProfileId;
  session: Session;
  created: boolean;
}

export interface SessionStore {
  resolve(token?: string): Promise<SessionResolution>;
  change(token: string | undefined, profile: ProfileId): Promise<SessionResolution>;
  close(): Promise<void>;
}

interface BrowserState {
  profile: ProfileId;
  session: Session;
  lastUsedAt: number;
}

function sessionFor(
  profile: ProfileId,
  id = `synthetic-${randomUUID()}`,
  threadActor?: ThreadActorRole,
): Session {
  const allowed =
    profile === 'associate'
      ? manifests
      : manifests.filter((manifest) => manifest.id === 'associate-communications');
  const threadCapabilities = ['thread:inventory:read'];
  if (threadActor) {
    threadCapabilities.push('thread:requests:read', 'thread:requests:write');
    if (threadActor === 'governance') threadCapabilities.push('thread:governance:approve');
  }
  return {
    id,
    displayName:
      profile === 'associate'
        ? 'Jordan Lee · synthetic associate'
        : 'Taylor Morgan · synthetic restricted',
    division: '71',
    store: '1001',
    capabilities: [...allowed.map((manifest) => manifest.capability), ...threadCapabilities],
    ...(threadActor ? { threadActor } : {}),
    synthetic: true,
  };
}

export function readSessionCookie(header: string | undefined): string | undefined {
  const item = header
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  return item?.slice(SESSION_COOKIE_NAME.length + 1);
}

export function createLocalSessionStore(threadActor?: ThreadActorRole): SessionStore {
  const sessions = new Map<string, BrowserState>();
  function remember(token: string, state: BrowserState) {
    sessions.delete(token);
    sessions.set(token, state);
    while (sessions.size > MAX_SYNTHETIC_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
  }
  async function resolve(token?: string): Promise<SessionResolution> {
    let state = token ? sessions.get(token) : undefined;
    const now = Date.now();
    if (state && now - state.lastUsedAt > SYNTHETIC_SESSION_IDLE_MS) {
      sessions.delete(token!);
      state = undefined;
    }
    const created = !state;
    if (!state) {
      token = randomBytes(32).toString('hex');
      state = {
        profile: 'associate',
        session: sessionFor('associate', undefined, threadActor),
        lastUsedAt: now,
      };
    }
    state.lastUsedAt = now;
    remember(token!, state);
    return { token: token!, profile: state.profile, session: state.session, created };
  }
  return {
    resolve,
    async change(token, profile) {
      const current = await resolve(token);
      const session = sessionFor(profile, current.session.id, threadActor);
      const state = { profile, session, lastUsedAt: Date.now() };
      remember(current.token, state);
      return { token: current.token, profile, session, created: current.created };
    },
    async close() {
      sessions.clear();
    },
  };
}

function approvedOrigin(value: string, allowedHostnames: readonly string[]): URL {
  const origin = new URL(value);
  const allowed = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...allowedHostnames.map((hostname) => hostname.toLowerCase()),
  ]);
  if (
    origin.protocol !== 'http:' ||
    !allowed.has(origin.hostname.toLowerCase()) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('The shared session service must use an approved HTTP origin.');
  }
  return origin;
}

export function createHttpSessionStore(
  value: string,
  internalKey: string,
  allowedHostnames: readonly string[] = [],
): SessionStore {
  if (!internalKey) throw new Error('A shared-session internal key is required.');
  const origin = approvedOrigin(value, allowedHostnames);
  async function call(path: string, body: unknown): Promise<SessionResolution> {
    const response = await fetch(`${origin.origin}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-overlock-internal-key': internalKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('The shared session service is unavailable.');
    }
    const result = (await response.json()) as SessionResolution;
    if (
      !result ||
      typeof result.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(result.token) ||
      !['associate', 'restricted'].includes(result.profile) ||
      result.session?.synthetic !== true ||
      typeof result.created !== 'boolean'
    ) {
      throw new Error('The shared session service returned an invalid response.');
    }
    return result;
  }
  return {
    resolve: (token) => call('/internal/v1/sessions/resolve', { token }),
    change: (token, profile) => call('/internal/v1/sessions/change', { token, profile }),
    async close() {},
  };
}
