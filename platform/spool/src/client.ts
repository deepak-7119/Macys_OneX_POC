import type { ApiErrorBody, AppManifest } from '../../contracts/index.ts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ApiErrorBody['error'],
  ) {
    super(detail.message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('://'))
    throw new Error('Only same-origin API routes are allowed');
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const detail = body?.error;
    throw new ApiError(
      response.status,
      detail &&
        typeof detail.code === 'string' &&
        typeof detail.message === 'string' &&
        typeof detail.requestId === 'string'
        ? detail
        : {
            code: 'REQUEST_FAILED',
            message: 'The request could not be completed.',
            requestId: 'unavailable',
          },
    );
  }
  return response.json() as Promise<T>;
}
export function operationPath(
  manifest: AppManifest,
  operation: string,
  params: Record<string, string> = {},
): string {
  const template = manifest.operations[operation];
  if (!template) throw new Error(`Unknown operation: ${operation}`);
  const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!params[key]) throw new Error(`Missing operation parameter: ${key}`);
    return encodeURIComponent(params[key]);
  });
  const approvedPrefixes = [`/api/apps/${manifest.id}/`, `/api/binder/v1/apps/${manifest.id}/`];
  if (!approvedPrefixes.some((prefix) => path.startsWith(prefix)))
    throw new Error('Invalid application operation');
  return path;
}
