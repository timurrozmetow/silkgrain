import { type ApiError, type ErrorCode } from '@silkgrain/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { isAppError } from '../lib/errors';

/**
 * Turns everything thrown anywhere in the application into `{ error: { code, message } }`.
 *
 * One shape for every failure means the client has one branch to write. `requestId` is always
 * included so a customer can quote it and the matching log line can be found in seconds.
 */

interface Failure {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  /** Logged, never sent. */
  internal?: unknown;
}

function classify(error: unknown): Failure {
  if (isAppError(error)) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.cause === undefined ? {} : { internal: error.cause }),
    };
  }

  // Body, query or params failed their schema. The issue list is safe to return: it names
  // only the fields the client itself sent.
  if (error instanceof ZodError) {
    return {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'The request did not match the expected shape',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    };
  }

  if (isFastifyError(error)) {
    // @fastify/rate-limit, malformed JSON, payload too large: Fastify already picked a
    // correct status, so keep it and translate the code.
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return { status, code: statusToCode(status), message: error.message };
    }
    return {
      status: 500,
      code: 'INTERNAL',
      message: 'Something went wrong on our side',
      internal: error,
    };
  }

  return {
    status: 500,
    code: 'INTERNAL',
    message: 'Something went wrong on our side',
    internal: error,
  };
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'VALIDATION_FAILED';
  }
}

interface FastifyErrorLike {
  statusCode?: number;
  code?: string;
  message: string;
}

function isFastifyError(error: unknown): error is FastifyErrorLike {
  return error instanceof Error && ('statusCode' in error || 'code' in error) && 'message' in error;
}

export const errorHandlerPlugin = fp(
  // eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects a promise
  async function errorHandler(app: FastifyInstance) {
    app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const failure = classify(error);

      if (failure.status >= 500) {
        request.log.error({ err: failure.internal ?? error }, 'unhandled error');
      } else {
        // 4xx is the client's problem, not an incident: record it, do not page anyone.
        request.log.warn(
          { code: failure.code, status: failure.status, msg: failure.message },
          'request rejected',
        );
      }

      const body: ApiError = {
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.details === undefined ? {} : { details: failure.details }),
          requestId: request.id,
        },
      };

      return reply.status(failure.status).send(body);
    });

    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const body: ApiError = {
        error: {
          code: 'NOT_FOUND',
          message: `Route ${request.method} ${request.url} does not exist`,
          requestId: request.id,
        },
      };
      return reply.status(404).send(body);
    });
  },
  { name: 'silkgrain-error-handler' },
);
