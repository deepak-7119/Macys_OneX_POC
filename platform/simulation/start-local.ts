import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildBobbin } from '../bobbin/server/bobbin.ts';
import { createHttpSessionStore } from '../bobbin/server/session-store.ts';
import { buildMockUpstream } from '../binder/server/adapters/mock/mock-legacy.ts';
import { buildApigeeMock } from './apigee-mock.ts';
import { buildMfeStorage } from './mfe-storage.ts';
import { buildSessionService } from './session-service.ts';

const ports = {
  hub: Number(process.env.PORT ?? 4300),
  assets: Number(process.env.MFE_PORT ?? 4310),
  session: Number(process.env.SESSION_PORT ?? 4340),
  apigee: Number(process.env.APIGEE_PORT ?? 4350),
  backend: Number(process.env.BACKEND_PORT ?? 4360),
};
if (
  Object.values(ports).some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
  new Set(Object.values(ports)).size !== Object.values(ports).length
) {
  throw new Error('Topology ports must be distinct integers between 1024 and 65535.');
}

const sessionKey = 'local-session-key-for-synthetic-topology';
const staticRoot = resolve(import.meta.dirname, '../../dist');
if (!existsSync(resolve(staticRoot, 'index.html'))) {
  throw new Error('Build the UI first: npm run build');
}
const origin = (port: number) => `http://127.0.0.1:${port}`;

const backend = buildMockUpstream();
const apigee = buildApigeeMock({ backendUrl: origin(ports.backend) });
const sessions = buildSessionService({ internalKey: sessionKey, threadActor: 'governance' });
const assets = buildMfeStorage({
  staticRoot,
  allowedBrowserOrigin: origin(ports.hub),
});
const hub = buildBobbin({
  upstreamUrl: origin(ports.apigee),
  staticRoot,
  applicationAssetBaseUrl: origin(ports.assets),
  runtimeProfile: 'combined',
  navigationMode: 'embedded',
  sessionStore: createHttpSessionStore(origin(ports.session), sessionKey),
});

const services: Array<[string, FastifyInstance, number]> = [
  ['legacy-backend', backend, ports.backend],
  ['apigee-mock', apigee, ports.apigee],
  ['enterprise-session-simulation', sessions, ports.session],
  ['gcp-storage-mfe-simulation', assets, ports.assets],
  ['one-x-hub-bobbin-fallback', hub, ports.hub],
];
const started: FastifyInstance[] = [];
try {
  for (const [, service, port] of services) {
    await service.listen({ host: '127.0.0.1', port });
    started.push(service);
  }
} catch (error) {
  await Promise.allSettled(started.reverse().map((service) => service.close()));
  throw error;
}
console.log(
  `\nOverlock one-Hub MFE simulation: ${origin(ports.hub)}/\n` +
    services.map(([name, , port]) => `  ${name.padEnd(36)} ${origin(port)}`).join('\n') +
    '\n\nOne Hub dynamically loads TH and AC from the storage simulation.\n' +
    'Bobbin remains the fallback auth/session/API host until the enterprise edge is confirmed.\n' +
    'All identities and business data are synthetic.\n',
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([...started].reverse().map((service) => service.close()));
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
