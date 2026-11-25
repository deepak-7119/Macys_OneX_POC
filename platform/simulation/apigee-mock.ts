import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { installErrorHandling } from '../bobbin/server/errors.ts';
import { forwardHttp } from './http-proxy.ts';

function backendOrigin(value: string): URL {
  const origin = new URL(value);
  if (
    origin.protocol !== 'http:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('The Apigee mock backend must be a server-configured HTTP origin.');
  return origin;
}

export function buildApigeeMock(options: { backendUrl: string }): FastifyInstance {
  const backend = backendOrigin(options.backendUrl);
  const app = Fastify({ logger: false, genReqId: () => randomUUID(), bodyLimit: 1024 * 1024 });
  installErrorHandling(app);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.headers['x-request-id'] ?? request.id);
    reply.header('x-apigee-simulation', 'policy-applied');
    reply.header('cache-control', 'no-store');
  });
  app.get('/health', async () => ({
    ok: true,
    service: 'mock-upstream',
    gateway: 'apigee-mock',
    synthetic: true,
  }));
  app.all('/legacy/*', async (request, reply) =>
    forwardHttp(request, reply, backend, { 'x-apigee-policy': 'local-simulation' }),
  );
  return app;
}
