import type { FastifyInstance } from 'fastify';
import type { BinderMenu } from '../../contracts/menu.ts';
import { requireCapability } from '../../../bobbin/server/authorization.ts';

export function registerMenuRoutes(app: FastifyInstance) {
  app.get('/api/binder/v1/apps/associate-communications/menu', async (request) => {
    requireCapability(request, 'documents:read');
    const session = request.syntheticSession!;
    const response: BinderMenu = {
      appId: 'associate-communications',
      source: 'mock',
      context: {
        division: session.division,
        store: session.store,
        presentation: 'pos',
      },
      items: [
        { key: 1, label: 'Training Alerts', action: 'training-alerts', disabled: false },
        { key: 2, label: 'Product Warranties', hint: 'Not in this POC', disabled: true },
        { key: 3, label: 'POS Quick Tips', hint: 'Not in this POC', disabled: true },
        { key: 4, label: 'Color Your Day / Other', hint: 'Not in this POC', disabled: true },
        { key: 5, label: 'Not assigned', disabled: true },
        { key: 6, label: 'Not assigned', disabled: true },
        {
          key: 7,
          label: 'Communication Menu',
          action: 'communication-menu',
          disabled: false,
        },
        { key: 8, label: 'Exit to POS', hint: 'Simulated', action: 'exit', disabled: false },
      ],
    };
    return response;
  });
}
