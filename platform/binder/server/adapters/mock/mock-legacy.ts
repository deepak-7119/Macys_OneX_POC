import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  installErrorHandling,
  RuntimeError,
  sendRuntimeError,
} from '../../../../bobbin/server/errors.ts';
import { registerMockTransactionRoutes } from '../../transactions/mock.ts';
import { registerMockDocumentRoutes } from '../../documents/mock.ts';

/** Separate HTTP fixture service. Importing/building this module never listens. */
export function buildMockUpstream(): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  installErrorHandling(app);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-overlock-data-mode', 'synthetic');
    reply.header('cache-control', 'no-store');
  });
  app.get('/health', async () => ({ ok: true, service: 'mock-upstream', synthetic: true }));
  app.get('/legacy/ping', async () => ({
    ok: true,
    service: 'mock-upstream',
    operation: 'legacy.ping',
    synthetic: true,
  }));
  registerMockTransactionRoutes(app);
  registerMockDocumentRoutes(app);
  app.setNotFoundHandler((request, reply) =>
    sendRuntimeError(
      request,
      reply,
      new RuntimeError(
        404,
        'NOT_FOUND',
        'No synthetic upstream operation is registered at this path.',
      ),
    ),
  );
  return app;
}
