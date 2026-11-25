import { RuntimeError } from '../../../bobbin/server/errors.ts';

const definitions = {
  'runtime.health': { method: 'GET', path: '/health' },
  'runtime.ping': { method: 'GET', path: '/legacy/ping' },
  'transactions.query': { method: 'POST', path: '/legacy/transactions/query' },
  'transactions.detail': { method: 'GET', path: '/legacy/transactions/{id}' },
  'documents.list': { method: 'POST', path: '/legacy/documents/list' },
  'documents.detail': { method: 'GET', path: '/legacy/documents/{id}' },
  'documents.page': { method: 'GET', path: '/legacy/documents/{id}/pages/{page}' },
} as const;

export type UpstreamOperation = keyof typeof definitions;
export interface UpstreamCall {
  requestId: string;
  params?: { id: string; page?: string };
  body?: unknown;
}
export interface UpstreamTransport {
  call(operation: UpstreamOperation, options: UpstreamCall): Promise<unknown>;
}

export function createUpstreamTransport(
  value: string,
  allowedHostnames: readonly string[] = [],
): UpstreamTransport {
  const origin = new URL(value);
  const approvedHostnames = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...allowedHostnames.map((hostname) => hostname.toLowerCase()),
  ]);
  if (
    origin.protocol !== 'http:' ||
    !approvedHostnames.has(origin.hostname.toLowerCase()) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error(
      'The synthetic upstream must be a server-configured approved loopback or container HTTP origin.',
    );
  }
  return {
    async call(operation, options) {
      const definition = definitions[operation];
      if (!definition)
        throw new RuntimeError(
          500,
          'OPERATION_NOT_REGISTERED',
          'The upstream operation is not registered.',
        );
      let path: string = definition.path;
      if (path.includes('{id}')) {
        if (!options.params?.id)
          throw new RuntimeError(
            500,
            'INVALID_OPERATION_BINDING',
            'The upstream operation binding is incomplete.',
          );
        path = path.replace('{id}', encodeURIComponent(options.params.id));
      }
      if (path.includes('{page}')) {
        if (!options.params?.page)
          throw new RuntimeError(
            500,
            'INVALID_OPERATION_BINDING',
            'The upstream operation binding is incomplete.',
          );
        path = path.replace('{page}', encodeURIComponent(options.params.page));
      }
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 1500);
      try {
        const response = await fetch(`${origin.origin}${path}`, {
          method: definition.method,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            accept: 'application/json',
            'x-request-id': options.requestId,
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
        });
        if (response.status >= 300 && response.status < 400) {
          throw new RuntimeError(
            502,
            'UPSTREAM_REDIRECT_REJECTED',
            'The synthetic upstream returned an unsupported redirect.',
          );
        }
        if (!response.ok)
          throw new RuntimeError(
            502,
            'UPSTREAM_FAILURE',
            'The synthetic upstream could not complete the operation.',
          );
        if (!response.headers.get('content-type')?.includes('application/json')) {
          throw new RuntimeError(
            502,
            'UPSTREAM_INVALID_RESPONSE',
            'The synthetic upstream returned an unexpected response.',
          );
        }
        let result: unknown;
        try {
          const declaredSize = Number(response.headers.get('content-length') ?? 0);
          if (declaredSize > 1024 * 1024) {
            await response.body?.cancel();
            throw new Error('Response exceeds the local JSON limit.');
          }
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Missing response body.');
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let size = 0;
          let text = '';
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 1024 * 1024) {
                await reader.cancel();
                throw new Error('Response exceeds the local JSON limit.');
              }
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            reader.releaseLock();
          }
          result = JSON.parse(text);
        } catch {
          if (timedOut)
            throw new RuntimeError(
              504,
              'UPSTREAM_TIMEOUT',
              'The synthetic upstream did not respond in time.',
            );
          throw new RuntimeError(
            502,
            'UPSTREAM_INVALID_RESPONSE',
            'The synthetic upstream returned invalid or oversized JSON.',
          );
        }
        if (
          !result ||
          typeof result !== 'object' ||
          !('synthetic' in result) ||
          result.synthetic !== true ||
          !('ok' in result) ||
          result.ok !== true ||
          !('service' in result) ||
          result.service !== 'mock-upstream'
        ) {
          throw new RuntimeError(
            502,
            'UPSTREAM_INVALID_RESPONSE',
            'The synthetic upstream returned an unexpected response.',
          );
        }
        return result;
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        throw new RuntimeError(
          timedOut ? 504 : 502,
          timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          timedOut
            ? 'The synthetic upstream did not respond in time.'
            : 'The synthetic upstream is unavailable.',
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
