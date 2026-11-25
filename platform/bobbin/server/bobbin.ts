import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  AppId,
  AppManifest,
  Bootstrap,
  NavigationMode,
  ProfileId,
  RuntimeProfile,
  Session,
} from '../../contracts/index.ts';
import { manifests, validateManifest } from '../../spool/src/manifests.ts';
import { installErrorHandling, RuntimeError, sendRuntimeError } from './errors.ts';
import { requireCapability } from './authorization.ts';
import { createUpstreamTransport } from '../../binder/server/adapters/upstream.ts';
import { registerTransactionRoutes } from '../../binder/server/transactions/routes.ts';
import { registerDocumentRoutes } from '../../binder/server/documents/routes.ts';
import { registerMenuRoutes } from '../../binder/server/menu/routes.ts';
import { assertLocalBoundary, assertTrustedGatewayBoundary } from './local-boundary.ts';
import {
  createLocalSessionStore,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  type SessionStore,
} from './session-store.ts';
import type { ThreadActorRole } from '../../thread/inventory/contracts.ts';
import {
  InMemoryThreadRequestRepository,
  type ThreadRequestRepository,
} from '../../thread/pipeline/repository.ts';
import { registerThreadPipelineRoutes } from '../../thread/pipeline/routes.ts';
import { registerThreadDiscoveryRoutes } from '../../thread/discovery/routes.ts';
import {
  InMemoryThreadBuildJobRepository,
  type ThreadBuildJobRepository,
} from '../../thread/jobs/repository.ts';
import { registerThreadBuildJobRoutes } from '../../thread/jobs/routes.ts';
import {
  InMemoryThreadArtifactRepository,
  type ThreadArtifactRepository,
} from '../../thread/artifacts/repository.ts';
import { registerThreadArtifactRoutes } from '../../thread/artifacts/routes.ts';
import {
  InMemoryThreadAutomationRunRepository,
  type ThreadAutomationRunRepository,
} from '../../thread/automation/repository.ts';
import { createDefaultThreadAutomationAdapters } from '../../thread/automation/adapters.ts';
import type { ThreadAutomationAdapters } from '../../thread/automation/contracts.ts';
import { registerThreadAutomationRoutes } from '../../thread/automation/routes.ts';
import {
  InMemoryThreadReleaseRepository,
  type ThreadReleaseRepository,
} from '../../thread/releases/repository.ts';
import { listThreadInventoryCatalog } from '../../thread/releases/catalog.ts';
import { registerThreadReleaseRoutes } from '../../thread/releases/routes.ts';
export { requireCapability } from './authorization.ts';

export interface BobbinOptions {
  upstreamUrl: string;
  upstreamAllowedHostnames?: readonly string[];
  staticRoot?: string;
  /** Trusted public origin used to simulate independently published GCP Storage MFE assets. */
  applicationAssetBaseUrl?: string;
  onApplicationAssetServed?: (path: string) => void;
  runtimeProfile?: RuntimeProfile;
  navigationMode?: NavigationMode;
  sessionStore?: SessionStore;
  trustedGatewayKey?: string;
  /** Supplied by trusted server-side identity integration, never by a browser payload. */
  threadManagementActor?: ThreadActorRole;
  threadRequestRepository?: ThreadRequestRepository;
  threadBuildJobRepository?: ThreadBuildJobRepository;
  threadArtifactRepository?: ThreadArtifactRepository;
  threadAutomationRunRepository?: ThreadAutomationRunRepository;
  threadAutomationAdapters?: ThreadAutomationAdapters;
  threadReleaseRepository?: ThreadReleaseRepository;
}

declare module 'fastify' {
  interface FastifyRequest {
    syntheticSession?: Session;
    syntheticProfile?: ProfileId;
    syntheticBrowserToken?: string;
  }
}

const profiles: Bootstrap['profiles'] = [
  { id: 'associate', label: 'Synthetic associate · both apps' },
  { id: 'restricted', label: 'Synthetic restricted · communications only' },
];

function assertReviewedManifest(manifest: AppManifest) {
  validateManifest(manifest);
  if (!['transaction-history', 'associate-communications'].includes(manifest.id)) {
    throw new Error('Unregistered application manifest.');
  }
  for (const operation of Object.values(manifest.operations)) {
    if (
      (!operation.startsWith(`/api/apps/${manifest.id}/`) &&
        !operation.startsWith(`/api/binder/v1/apps/${manifest.id}/`)) ||
      /[?:#\\]/.test(operation) ||
      operation.includes('..') ||
      operation.includes('//')
    ) {
      throw new Error(`Manifest ${manifest.id} contains an unapproved operation path.`);
    }
  }
}

/** Same-origin runtime. Address selection stays on the server; no import-time listening. */
export function buildBobbin(options: BobbinOptions): FastifyInstance {
  const runtimeProfile = options.runtimeProfile ?? 'combined';
  const navigationMode = options.navigationMode ?? 'embedded';
  const hostedManifests =
    runtimeProfile === 'combined' || runtimeProfile === 'hub'
      ? manifests
      : manifests.filter((manifest) => manifest.id === runtimeProfile);
  const applicationAssetBaseUrl = options.applicationAssetBaseUrl
    ? new URL(options.applicationAssetBaseUrl)
    : undefined;
  if (
    applicationAssetBaseUrl &&
    (!['http:', 'https:'].includes(applicationAssetBaseUrl.protocol) ||
      applicationAssetBaseUrl.username ||
      applicationAssetBaseUrl.password ||
      applicationAssetBaseUrl.pathname !== '/' ||
      applicationAssetBaseUrl.search ||
      applicationAssetBaseUrl.hash)
  ) {
    throw new Error('The application asset base must be a server-configured HTTP(S) origin.');
  }
  const exposedManifests = hostedManifests.map((manifest) => ({
    ...structuredClone(manifest),
    entry: applicationAssetBaseUrl
      ? new URL(manifest.entry, applicationAssetBaseUrl).toString()
      : manifest.entry,
  }));
  const upstream = createUpstreamTransport(options.upstreamUrl, options.upstreamAllowedHostnames);
  const sessionStore =
    options.sessionStore ?? createLocalSessionStore(options.threadManagementActor);
  const threadRequestRepository =
    options.threadRequestRepository ?? new InMemoryThreadRequestRepository();
  const threadBuildJobRepository =
    options.threadBuildJobRepository ?? new InMemoryThreadBuildJobRepository();
  const threadArtifactRepository =
    options.threadArtifactRepository ?? new InMemoryThreadArtifactRepository();
  const threadAutomationRunRepository =
    options.threadAutomationRunRepository ?? new InMemoryThreadAutomationRunRepository();
  const threadAutomationAdapters =
    options.threadAutomationAdapters ?? createDefaultThreadAutomationAdapters();
  const threadReleaseRepository =
    options.threadReleaseRepository ?? new InMemoryThreadReleaseRepository();
  const threadInventoryCatalog = () => listThreadInventoryCatalog(threadReleaseRepository);
  hostedManifests.forEach(assertReviewedManifest);
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  installErrorHandling(app);
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (
      reply.statusCode === 200 &&
      /^\/modules\/(transaction-history|associate-communications)\.js$/.test(path)
    ) {
      options.onApplicationAssetServed?.(path);
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-overlock-data-mode', 'synthetic');
    reply.header('x-overlock-runtime-profile', runtimeProfile);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    const assetSource = applicationAssetBaseUrl ? ` ${applicationAssetBaseUrl.origin}` : '';
    reply.header(
      'content-security-policy',
      `default-src 'self'; script-src 'self'${assetSource}; style-src 'self' 'unsafe-inline'${assetSource}; img-src 'self' data:${assetSource}; font-src 'self' data:${assetSource}; connect-src 'self'${assetSource}; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    );
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (options.trustedGatewayKey) assertTrustedGatewayBoundary(request, options.trustedGatewayKey);
    else assertLocalBoundary(request);
    if (!path.startsWith('/api/')) return;
    const state = await sessionStore.resolve(readSessionCookie(request.headers.cookie));
    if (state.created)
      reply.header(
        'set-cookie',
        `${SESSION_COOKIE_NAME}=${state.token}; Path=/; HttpOnly; SameSite=Strict`,
      );
    request.syntheticSession = state.session;
    request.syntheticProfile = state.profile;
    request.syntheticBrowserToken = state.token;
    const appMatch =
      /^\/api\/apps\/([^/]+)(?:\/|$)/.exec(path) ??
      /^\/api\/binder\/v1\/apps\/([^/]+)(?:\/|$)/.exec(path);
    if (appMatch) {
      const manifest = hostedManifests.find((item) => item.id === appMatch[1]);
      if (!manifest)
        throw new RuntimeError(404, 'APP_NOT_FOUND', 'This application is not registered.');
      requireCapability(request, manifest.capability);
    }
  });

  function bootstrap(request: FastifyRequest): Bootstrap {
    const session = request.syntheticSession!;
    return {
      synthetic: true,
      session,
      apps: exposedManifests.filter((manifest) =>
        session.capabilities.includes(manifest.capability),
      ),
      profiles,
      runtime: {
        name: 'OneX Hub',
        upstream: 'Synthetic legacy service over HTTP',
        contractVersion: '1.0',
        profile: runtimeProfile,
        navigationMode,
        orchestration: 'single-spa-root-config',
        hostingMode: 'bobbin-fallback',
        assetDelivery: applicationAssetBaseUrl ? 'gcp-storage-simulation' : 'bobbin-bundled',
      },
      binder: {
        name: 'Binder',
        mode: 'mock',
        basePath: '/api/binder/v1',
        contractVersion: '1.0',
      },
    };
  }

  app.get('/health', async () => ({ ok: true, service: 'bobbin', synthetic: true }));
  app.get('/ready', async (request) => {
    try {
      await upstream.call('runtime.health', { requestId: request.id });
    } catch {
      throw new RuntimeError(503, 'NOT_READY', 'Bobbin is waiting for its synthetic upstream.');
    }
    return {
      ok: true,
      service: 'bobbin',
      synthetic: true,
      profile: runtimeProfile,
      manifests: hostedManifests.length,
      upstream: 'ready',
    };
  });
  app.get('/api/bootstrap', async (request) => bootstrap(request));
  app.post<{ Body: { profile: ProfileId } }>(
    '/api/session',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['profile'],
          properties: { profile: { type: 'string', enum: ['associate', 'restricted'] } },
        },
      },
    },
    async (request, reply) => {
      const state = await sessionStore.change(request.syntheticBrowserToken, request.body.profile);
      if (state.created)
        reply.header(
          'set-cookie',
          `${SESSION_COOKIE_NAME}=${state.token}; Path=/; HttpOnly; SameSite=Strict`,
        );
      request.syntheticSession = state.session;
      request.syntheticProfile = state.profile;
      request.syntheticBrowserToken = state.token;
      return bootstrap(request);
    },
  );
  app.get<{ Params: { appId: AppId } }>('/api/apps/:appId/manifest', async (request) => {
    const manifest = exposedManifests.find((item) => item.id === request.params.appId);
    if (!manifest)
      throw new RuntimeError(404, 'APP_NOT_FOUND', 'This application is not registered.');
    requireCapability(request, manifest.capability);
    return manifest;
  });

  app.get(
    '/api/runtime/probe',
    {
      schema: { querystring: { type: 'object', properties: {}, additionalProperties: false } },
    },
    async (request) => {
      const result = await upstream.call('runtime.ping', { requestId: request.id });
      if (
        !result ||
        typeof result !== 'object' ||
        !('operation' in result) ||
        result.operation !== 'legacy.ping'
      ) {
        throw new RuntimeError(
          502,
          'UPSTREAM_INVALID_RESPONSE',
          'The synthetic upstream returned an unexpected response.',
        );
      }
      return { ok: true, synthetic: true, transport: 'http', upstream: result };
    },
  );

  if (runtimeProfile === 'combined' || runtimeProfile === 'transaction-history')
    registerTransactionRoutes(app, upstream);
  if (runtimeProfile === 'combined' || runtimeProfile === 'associate-communications') {
    registerDocumentRoutes(app, upstream);
    registerMenuRoutes(app);
  }
  if (runtimeProfile === 'combined' || runtimeProfile === 'hub') {
    registerThreadPipelineRoutes(app, threadRequestRepository, threadInventoryCatalog);
    registerThreadDiscoveryRoutes(app, threadRequestRepository, threadInventoryCatalog);
    registerThreadArtifactRoutes(app, threadBuildJobRepository, threadArtifactRepository);
    registerThreadBuildJobRoutes(
      app,
      threadRequestRepository,
      threadBuildJobRepository,
      threadArtifactRepository,
      threadReleaseRepository,
    );
    registerThreadAutomationRoutes(
      app,
      threadRequestRepository,
      threadBuildJobRepository,
      threadArtifactRepository,
      threadAutomationRunRepository,
      threadAutomationAdapters,
      threadInventoryCatalog,
    );
    registerThreadReleaseRoutes(
      app,
      threadRequestRepository,
      threadBuildJobRepository,
      threadArtifactRepository,
      threadReleaseRepository,
    );
  }

  if (options.staticRoot) {
    app.register(fastifyStatic, {
      root: resolve(options.staticRoot),
      prefix: '/',
      wildcard: false,
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    const knownAppRoute =
      path === '/' ||
      hostedManifests.some((manifest) => path === manifest.path || path === `${manifest.path}/`);
    if (options.staticRoot && request.method === 'GET' && knownAppRoute) {
      return reply.type('text/html').sendFile('index.html');
    }
    return sendRuntimeError(
      request,
      reply,
      new RuntimeError(
        404,
        'NOT_FOUND',
        'No approved runtime operation or application route exists at this path.',
      ),
    );
  });
  app.addHook('onClose', async () => {
    await sessionStore.close();
  });
  return app;
}
