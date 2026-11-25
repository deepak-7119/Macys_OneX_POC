import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildBobbin } from './bobbin.ts';
import { buildMockUpstream } from '../../binder/server/adapters/mock/mock-legacy.ts';
import { FileThreadRequestRepository } from '../../thread/pipeline/repository.ts';
import { FileThreadBuildJobRepository } from '../../thread/jobs/repository.ts';
import { FileThreadArtifactRepository } from '../../thread/artifacts/repository.ts';
import { FileThreadAutomationRunRepository } from '../../thread/automation/repository.ts';
import { FileThreadReleaseRepository } from '../../thread/releases/repository.ts';

const port = Number(process.env.PORT ?? 4300);
const upstreamPort = Number(process.env.MOCK_PORT ?? 4301);
if (
  ![port, upstreamPort].every(
    (value) => Number.isInteger(value) && value >= 1024 && value <= 65535,
  ) ||
  port === upstreamPort
)
  throw new Error('Use distinct local ports between 1024 and 65535');
const staticRoot = resolve(import.meta.dirname, '../../../dist');
if (!existsSync(resolve(staticRoot, 'index.html')))
  throw new Error('Build the UI first: npm run build');
const upstream = buildMockUpstream();
await upstream.listen({ host: '127.0.0.1', port: upstreamPort });
const threadRequestRepository = new FileThreadRequestRepository(
  resolve(import.meta.dirname, '../../../runtime/thread-requests.json'),
);
const threadBuildJobRepository = new FileThreadBuildJobRepository(
  resolve(import.meta.dirname, '../../../runtime/thread-build-jobs.json'),
);
const threadArtifactRepository = new FileThreadArtifactRepository(
  resolve(import.meta.dirname, '../../../runtime/thread-artifacts.json'),
);
const threadAutomationRunRepository = new FileThreadAutomationRunRepository(
  resolve(import.meta.dirname, '../../../runtime/thread-adapter-runs.json'),
);
const threadReleaseRepository = new FileThreadReleaseRepository(
  resolve(import.meta.dirname, '../../../runtime/thread-releases.json'),
);
const bobbin = buildBobbin({
  upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
  staticRoot,
  threadRequestRepository,
  threadBuildJobRepository,
  threadArtifactRepository,
  threadAutomationRunRepository,
  threadReleaseRepository,
  onApplicationAssetServed: (path) => console.log(`[Bobbin] application asset served: ${path}`),
});
try {
  await bobbin.listen({ host: '127.0.0.1', port });
} catch (error) {
  await upstream.close();
  throw error;
}
console.log(
  `\nOverlock POC: http://127.0.0.1:${port}/\nSynthetic upstream: http://127.0.0.1:${upstreamPort}/health\nLoopback only. All data and identities are synthetic.\n`,
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await bobbin.close();
  await upstream.close();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
