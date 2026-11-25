import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { RuntimeError } from './errors.ts';

interface LocalAuthority {
  hostname: string;
  port: number;
}

function authority(value: unknown, defaultPort: number): LocalAuthority | undefined {
  if (typeof value !== 'string') return;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(value);
  if (!match) return;
  const port = match[2] === undefined ? defaultPort : Number(match[2]);
  if (port < 1 || port > 65535) return;
  return { hostname: match[1].toLowerCase(), port };
}

function exactSecret(value: unknown, expected: string): boolean {
  if (typeof value !== 'string' || !value || !expected) return false;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** A Bobbin behind the local gateway trusts only gateway-added forwarding headers. */
export function assertTrustedGatewayBoundary(request: FastifyRequest, expectedKey: string) {
  if (!exactSecret(request.headers['x-overlock-gateway-key'], expectedKey)) {
    throw new RuntimeError(
      403,
      'GATEWAY_FORBIDDEN',
      'This runtime only accepts the trusted gateway.',
    );
  }
  const protocol = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  if (protocol !== 'http' && protocol !== 'https') {
    throw new RuntimeError(403, 'GATEWAY_FORBIDDEN', 'The gateway forwarding context is invalid.');
  }
  const host = authority(forwardedHost, protocol === 'https' ? 443 : 80);
  if (!host) {
    throw new RuntimeError(403, 'GATEWAY_FORBIDDEN', 'The gateway forwarding context is invalid.');
  }
  const mutatingApi =
    request.url.split('?')[0].startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const origin = request.headers.origin;
  if (!mutatingApi || origin === undefined) return;
  const parsed = /^(https?):\/\/([^/?#]+)$/.exec(origin);
  const originHost = parsed && authority(parsed[2], parsed[1] === 'https' ? 443 : 80);
  if (
    !parsed ||
    !originHost ||
    parsed[1] !== protocol ||
    originHost.hostname !== host.hostname ||
    originHost.port !== host.port
  ) {
    throw new RuntimeError(
      403,
      'ORIGIN_FORBIDDEN',
      'Mutating API requests must use the gateway origin.',
    );
  }
}

/** Local demonstration boundary, not enterprise authentication or a proxy trust model. */
export function assertLocalBoundary(request: FastifyRequest) {
  const defaultPort = request.protocol === 'https' ? 443 : 80;
  const host = authority(request.headers.host, defaultPort);
  const localPort = request.raw.socket.localPort;
  if (!host || (localPort && localPort !== host.port)) {
    throw new RuntimeError(
      403,
      'HOST_FORBIDDEN',
      'This local demonstration only accepts its loopback host and port.',
    );
  }
  const mutatingApi =
    request.url.split('?')[0].startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const origin = request.headers.origin;
  if (!mutatingApi || origin === undefined) return;
  const parsed = /^(https?):\/\/([^/?#]+)$/.exec(origin);
  const originHost = parsed && authority(parsed[2], parsed[1] === 'https' ? 443 : 80);
  if (
    !parsed ||
    !originHost ||
    parsed[1] !== request.protocol ||
    originHost.hostname !== host.hostname ||
    originHost.port !== host.port
  ) {
    throw new RuntimeError(
      403,
      'ORIGIN_FORBIDDEN',
      'Mutating local API requests must use the same origin.',
    );
  }
}
