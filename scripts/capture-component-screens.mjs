import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputDirectory, port = '9227'] = process.argv.slice(2);
if (!outputDirectory) throw new Error('Expected an output directory.');

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const pageTarget = targets.find((target) => target.type === 'page');
if (!pageTarget) throw new Error('No browser page was available for capture.');

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function evaluate(expression) {
  return command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
}

async function navigate(url) {
  await command('Page.navigate', { url });
  await wait(1400);
}

async function capture(fileName) {
  const result = await command('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 94,
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

await navigate('http://127.0.0.1:4300/apps/transaction-history?view=web');
await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
await capture('transaction-history-components.jpeg');

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Find transactions'));
  button?.click();
})()`);
await wait(1000);
await evaluate(`(() => {
  const heading = [...document.querySelectorAll('h2')].find((item) => item.textContent?.includes('Search results'));
  heading?.closest('.panel')?.scrollIntoView({ block: 'start', behavior: 'instant' });
})()`);
await wait(350);
await capture('transaction-history-results-components.jpeg');

await navigate('http://127.0.0.1:4300/apps/associate-communications?view=web');
await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
await wait(500);
await capture('associate-communications-components.jpeg');

socket.close();
console.log('Captured component screens.');
