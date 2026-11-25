import type { FastifyInstance } from 'fastify';
import { requireCapability } from '../../../bobbin/server/authorization.ts';
import type { UpstreamTransport } from '../adapters/upstream.ts';
import { createDocumentAdapter } from './adapter.ts';

const noQuery = { type: 'object', properties: {}, additionalProperties: false };
const id = { type: 'string', minLength: 1, maxLength: 20 };

export function registerDocumentRoutes(app: FastifyInstance, upstream: UpstreamTransport) {
  const adapter = createDocumentAdapter(upstream);
  app.get<{ Querystring: { category?: string; fob?: string } }>(
    '/api/apps/associate-communications/documents',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string', enum: ['training-alerts'] },
            fob: { type: 'string', minLength: 1, maxLength: 60 },
          },
        },
      },
    },
    async (request) =>
      adapter.list(requireCapability(request, 'documents:read'), request.query.fob, request.id),
  );
  app.get<{ Params: { id: string } }>(
    '/api/apps/associate-communications/documents/:id',
    {
      schema: {
        querystring: noQuery,
        params: { type: 'object', required: ['id'], properties: { id } },
      },
    },
    async (request) =>
      adapter.detail(requireCapability(request, 'documents:read'), request.params.id, request.id),
  );
  app.get<{ Params: { id: string; page: string } }>(
    '/api/apps/associate-communications/documents/:id/pages/:page',
    {
      schema: {
        querystring: noQuery,
        params: {
          type: 'object',
          required: ['id', 'page'],
          properties: { id, page: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } },
        },
      },
    },
    async (request, reply) => {
      const svg = await adapter.page(
        requireCapability(request, 'documents:read'),
        request.params.id,
        Number(request.params.page),
        request.id,
      );
      return reply
        .type('image/svg+xml')
        .header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(svg);
    },
  );
}
