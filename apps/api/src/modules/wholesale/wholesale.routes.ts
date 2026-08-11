import { ApiError, WholesaleRequestInput, WholesaleRequestResult } from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { submitWholesaleRequest } from './wholesale.service';

/**
 * The wholesale enquiry form's endpoint.
 *
 * Three an hour from one address, tighter than the Help form's five: a business fills this in
 * once, and the row it writes lands in a queue a human works through.
 */
const WHOLESALE_LIMIT = { rateLimit: { max: 3, timeWindow: '1 hour' } };

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function wholesaleRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/wholesale/requests',
    {
      config: WHOLESALE_LIMIT,
      schema: {
        tags: ['wholesale'],
        summary: 'Submit a wholesale enquiry',
        description:
          'Carries a honeypot field and the time the form rendered. A submission failing either ' +
          'check gets the same 201 a real one does and is simply not stored. Reading requests ' +
          'back belongs to the admin panel in Phase 7; there is no public GET.',
        body: WholesaleRequestInput,
        response: { 201: WholesaleRequestResult, 422: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      await submitWholesaleRequest(app.db, request.body, { ip: request.ip });
      return reply.status(201).send({ received: true } as const);
    },
  );
}
