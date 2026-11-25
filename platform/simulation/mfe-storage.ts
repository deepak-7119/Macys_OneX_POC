import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { installErrorHandling, RuntimeError } from '../bobbin/server/errors.ts';
import { assertLocalBoundary } from '../bobbin/server/local-boundary.ts';

function reviewedOrigin(value: string): string {
  const origin = new URL(value);
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('The local MFE storage origin must be an approved loopback HTTP origin.');
  }
  return origin.origin;
}

/**
 * Local stand-in for a GCP Storage bucket/CDN. It serves only built MFE modules and
 * their immutable chunks; it has no authentication, session or API responsibilities.
 */
export function buildMfeStorage(options: {
  staticRoot: string;
  allowedBrowserOrigin: string;
}): FastifyInstance {
  const allowedBrowserOrigin = reviewedOrigin(options.allowedBrowserOrigin);
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  installErrorHandling(app);
  app.addHook('onRequest', async (request, reply) => {
    assertLocalBoundary(request);
    const path = request.url.split('?')[0];
    if (!path.startsWith('/modules/') && !path.startsWith('/assets/')) {
      throw new RuntimeError(404, 'ASSET_NOT_FOUND', 'Only reviewed MFE assets are published.');
    }
    reply.header('access-control-allow-origin', allowedBrowserOrigin);
    reply.header('cross-origin-resource-policy', 'cross-origin');
    reply.header('x-content-type-options', 'nosniff');
  });
  app.register(fastifyStatic, {
    root: resolve(options.staticRoot),
    prefix: '/',
    wildcard: false,
    setHeaders(reply, filePath) {
      reply.header(
        'cache-control',
        /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.setNotFoundHandler(() => {
    throw new RuntimeError(404, 'ASSET_NOT_FOUND', 'The requested MFE asset is not published.');
  });
  return app;
}
