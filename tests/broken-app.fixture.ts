/** Manual browser failure gate only. Not imported or enabled by normal startup. */
import { resolve } from 'node:path';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';

const app = buildBobbin({
  upstreamUrl: 'http://127.0.0.1:4301',
  staticRoot: resolve(import.meta.dirname, '../dist'),
});
app.addHook('onRequest', async (request, reply) => {
  if (request.url.split('?')[0] === '/modules/transaction-history.js') {
    return reply
      .code(503)
      .type('application/json')
      .send({
        error: {
          code: 'DEMO_MODULE_UNAVAILABLE',
          message: 'Deliberate local browser test failure.',
          requestId: request.id,
        },
      });
  }
});
await app.listen({ host: '127.0.0.1', port: 4302 });
console.log(
  'Browser failure fixture: http://127.0.0.1:4302/ (TH module intentionally unavailable)',
);
process.on('SIGINT', () => void app.close());
process.on('SIGTERM', () => void app.close());
