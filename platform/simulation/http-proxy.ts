import type { FastifyReply, FastifyRequest } from 'fastify';
import { RuntimeError } from '../bobbin/server/errors.ts';

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function requestBody(request: FastifyRequest): BodyInit | undefined {
  if (['GET', 'HEAD'].includes(request.method) || request.body === undefined) return;
  if (typeof request.body === 'string' || request.body instanceof Uint8Array)
    return request.body as BodyInit;
  return JSON.stringify(request.body);
}

export async function forwardHttp(
  request: FastifyRequest,
  reply: FastifyReply,
  origin: URL,
  extraHeaders: Record<string, string> = {},
) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(lower) || lower === 'host') continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  let response: Response;
  try {
    response = await fetch(`${origin.origin}${request.raw.url ?? request.url}`, {
      method: request.method,
      headers,
      body: requestBody(request),
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new RuntimeError(502, 'ROUTE_UNAVAILABLE', 'The selected local service is unavailable.');
  }
  for (const [name, value] of response.headers.entries()) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) reply.header(name, value);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return reply.code(response.status).send(bytes);
}
