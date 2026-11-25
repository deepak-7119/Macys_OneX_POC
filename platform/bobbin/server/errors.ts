import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '../../contracts/index.ts';

export class RuntimeError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export function sendRuntimeError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: RuntimeError,
) {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
  return reply.code(error.statusCode).send(body);
}

export function installErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RuntimeError) return sendRuntimeError(request, reply, error);
    const frameworkError = error instanceof Error ? (error as Partial<FastifyError>) : undefined;
    if (frameworkError?.validation) {
      return sendRuntimeError(
        request,
        reply,
        new RuntimeError(
          400,
          'INVALID_REQUEST',
          'The request does not match the supported contract.',
        ),
      );
    }
    const status =
      frameworkError?.statusCode &&
      frameworkError.statusCode >= 400 &&
      frameworkError.statusCode < 500
        ? frameworkError.statusCode
        : 500;
    const code =
      status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : status === 415
          ? 'UNSUPPORTED_MEDIA_TYPE'
          : status >= 400 && status < 500
            ? 'INVALID_REQUEST'
            : 'INTERNAL_ERROR';
    return sendRuntimeError(
      request,
      reply,
      new RuntimeError(
        status,
        code,
        status === 413
          ? 'The request payload exceeds the local runtime limit.'
          : status >= 500
            ? 'The local runtime could not complete this request.'
            : 'This request is not supported.',
      ),
    );
  });
}
