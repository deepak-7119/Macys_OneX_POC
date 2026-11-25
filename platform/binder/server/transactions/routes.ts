import type { FastifyInstance } from 'fastify';
import type { TransactionQuery } from '../../../contracts/index.ts';
import { requireCapability } from '../../../bobbin/server/authorization.ts';
import type { UpstreamTransport } from '../adapters/upstream.ts';
import { createTransactionAdapter } from './adapter.ts';

const emptyQuery = { type: 'object', properties: {}, additionalProperties: false };

export function registerTransactionRoutes(app: FastifyInstance, upstream: UpstreamTransport) {
  const adapter = createTransactionAdapter(upstream);
  app.post<{ Body: TransactionQuery }>(
    '/api/apps/transaction-history/queries',
    {
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'criteria'],
          properties: {
            mode: { type: 'string', minLength: 1, maxLength: 50 },
            criteria: {
              type: 'object',
              additionalProperties: false,
              required: ['upc', 'fromDate', 'toDate'],
              properties: {
                upc: { type: 'string', pattern: '^[0-9]{1,15}$' },
                fromDate: { type: 'string', maxLength: 10 },
                toDate: { type: 'string', maxLength: 10 },
                store: { type: 'string', pattern: '^[0-9]{1,10}$' },
              },
            },
          },
        },
      },
    },
    async (request) =>
      adapter.query(requireCapability(request, 'transactions:read'), request.body, request.id),
  );
  app.get<{ Params: { id: string } }>(
    '/api/apps/transaction-history/transactions/:id',
    {
      schema: {
        querystring: emptyQuery,
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) =>
      adapter.detail(
        requireCapability(request, 'transactions:read'),
        request.params.id,
        request.id,
      ),
  );
  app.get<{ Params: { id: string; variant: string } }>(
    '/api/apps/transaction-history/transactions/:id/receipts/:variant',
    {
      schema: {
        querystring: emptyQuery,
        params: {
          type: 'object',
          required: ['id', 'variant'],
          properties: {
            id: { type: 'string', maxLength: 100 },
            variant: { type: 'string', maxLength: 40 },
          },
        },
      },
    },
    async (request) =>
      adapter.receipt(
        requireCapability(request, 'transactions:read'),
        request.params.id,
        request.params.variant,
        request.id,
      ),
  );
}
