import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildBobbin } from '../bobbin/server/bobbin.ts';
import { createHttpSessionStore } from '../bobbin/server/session-store.ts';
import { buildMockUpstream } from '../binder/server/adapters/mock/mock-legacy.ts';
import { buildApigeeMock } from './apigee-mock.ts';
import { buildMfeStorage } from './mfe-storage.ts';
import { buildSessionService } from './session-service.ts';

const serviceName = process.env.SERVICE_NAME;
const port = Number(process.env.PORT ?? 8080);
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for ${serviceName ?? 'this service'}.`);
  return value;
};
const hostnameOf = (value: string) => new URL(value).hostname;
const staticRoot = resolve(import.meta.dirname, '../../dist');
let service: FastifyInstance;
if (serviceName === 'legacy-backend') {
  service = buildMockUpstream();
} else if (serviceName === 'apigee-mock') {
  service = buildApigeeMock({ backendUrl: required('BACKEND_URL') });
} else if (serviceName === 'session-service') {
  service = buildSessionService({
    internalKey: required('SESSION_INTERNAL_KEY'),
    threadActor: 'governance',
  });
} else if (serviceName === 'mfe-storage') {
  if (!existsSync(resolve(staticRoot, 'modules/transaction-history.js'))) {
    throw new Error('The MFE build is missing.');
  }
  service = buildMfeStorage({
    staticRoot,
    allowedBrowserOrigin: required('HUB_PUBLIC_ORIGIN'),
  });
} else if (serviceName === 'one-x-hub') {
  if (!existsSync(resolve(staticRoot, 'index.html'))) throw new Error('The UI build is missing.');
  const sessionUrl = required('SESSION_URL');
  const apigeeUrl = required('APIGEE_URL');
  service = buildBobbin({
    upstreamUrl: apigeeUrl,
    upstreamAllowedHostnames: [hostnameOf(apigeeUrl)],
    staticRoot,
    applicationAssetBaseUrl: required('MFE_PUBLIC_ORIGIN'),
    runtimeProfile: 'combined',
    navigationMode: 'embedded',
    sessionStore: createHttpSessionStore(sessionUrl, required('SESSION_INTERNAL_KEY'), [
      hostnameOf(sessionUrl),
    ]),
  });
} else {
  throw new Error(
    'SERVICE_NAME must be one-x-hub, mfe-storage, session-service, apigee-mock or legacy-backend.',
  );
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT is invalid.');
await service.listen({ host: '0.0.0.0', port });
console.log(`${serviceName} listening on ${port}`);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await service.close();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
