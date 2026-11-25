import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputDirectory, port = '9224'] = process.argv.slice(2);

if (!outputDirectory) {
  throw new Error('Expected an output directory.');
}

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const pageTarget = targets.find(
  (target) => target.type === 'page' && target.url.startsWith('http://127.0.0.1:4300/'),
);

if (!pageTarget) {
  throw new Error('The local OneX Hub page was not available through Chrome DevTools.');
}

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;

  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluate(expression) {
  await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
}

async function capture(fileName) {
  const result = await command('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(result.data, 'base64'));
}

await mkdir(outputDirectory, { recursive: true });
await command('Page.enable');
await command('Runtime.enable');
await command('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await wait(1000);

await evaluate(`(() => {
  const button = document.querySelector('[aria-controls="implementation-map"]');
  if (button?.getAttribute('aria-expanded') === 'true') button.click();
  window.scrollTo({ top: 0, behavior: 'instant' });
})()`);
await wait(500);
await capture('overlock-poc-hub.jpeg');

await evaluate(`(() => {
  const button = document.querySelector('[aria-controls="implementation-map"]');
  if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`);
await evaluate(`document.getElementById('implementation-map')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
await wait(500);
await capture('overlock-poc-flow.jpeg');

socket.close();
console.log(path.join(outputDirectory, 'overlock-poc-hub.jpeg'));
console.log(path.join(outputDirectory, 'overlock-poc-flow.jpeg'));
