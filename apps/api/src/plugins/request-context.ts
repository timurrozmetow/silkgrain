import { fastifyRequestContext, requestContext } from '@fastify/request-context';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module '@fastify/request-context' {
  interface RequestContextData {
    requestId: string;
    /** Set by the auth guards once a token is verified. */
    subjectType?: 'customer' | 'admin';
    subjectId?: number;
  }
}

/**
 * Puts the request id into an AsyncLocalStorage store.
 *
 * Without it, anything below the route handler - a service, a repository, a queue producer -
 * has to be handed the request or the logger explicitly just to be able to correlate a line.
 * With it, `requestContext.get('requestId')` works anywhere inside the request's lifetime.
 */
export const requestContextPlugin = fp(
  async function context(app: FastifyInstance) {
    await app.register(fastifyRequestContext, {
      defaultStoreValues: { requestId: 'no-request' },
    });

    app.addHook('onRequest', (request, _reply, done) => {
      requestContext.set('requestId', request.id);
      done();
    });
  },
  { name: 'silkgrain-request-context' },
);

export { requestContext };
