import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { ProfileId } from '../contracts/index.ts';
import type { ThreadActorRole } from '../thread/inventory/contracts.ts';
import { installErrorHandling, RuntimeError } from '../bobbin/server/errors.ts';
import { createLocalSessionStore } from '../bobbin/server/session-store.ts';

function exactSecret(value: unknown, expected: string): boolean {
  if (typeof value !== 'string' || !value || !expected) return false;
  const actual = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function buildSessionService(options: {
  internalKey: string;
  threadActor?: ThreadActorRole;
}): FastifyInstance {
  if (!options.internalKey) throw new Error('The session service requires an internal key.');
  const store = createLocalSessionStore(options.threadActor);
  const app = Fastify({ logger: false, bodyLimit: 4096 });
  installErrorHandling(app);
  app.get('/health', async () => ({ ok: true, service: 'shared-session', synthetic: true }));
  app.addHook('onRequest', async (request) => {
    if (request.url === '/health') return;
    if (!exactSecret(request.headers['x-overlock-internal-key'], options.internalKey)) {
      throw new RuntimeError(
        403,
        'INTERNAL_FORBIDDEN',
        'The internal session request is not trusted.',
      );
    }
  });
  const tokenSchema = { anyOf: [{ type: 'string', pattern: '^[a-f0-9]{64}$' }, { type: 'null' }] };
  app.post<{ Body: { token?: string } }>(
    '/internal/v1/sessions/resolve',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { token: tokenSchema },
        },
      },
    },
    async (request) => store.resolve(request.body.token),
  );
  app.post<{ Body: { token?: string; profile: ProfileId } }>(
    '/internal/v1/sessions/change',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['profile'],
          properties: {
            token: tokenSchema,
            profile: { type: 'string', enum: ['associate', 'restricted'] },
          },
        },
      },
    },
    async (request) => store.change(request.body.token, request.body.profile),
  );
  app.addHook('onClose', async () => store.close());
  return app;
}
