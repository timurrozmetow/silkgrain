import {
  ApiError,
  ContactMessageInput,
  ContactMessageResult,
  FaqListResponse,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { listFaqs, submitContactMessage } from './content.service';

/**
 * The Help page's two halves.
 *
 * The contact form is the one unauthenticated write in the storefront, so it carries the
 * tightest limit in the platform after the credential routes. A person writes in once; five an
 * hour from one address is already generous.
 */
const CONTACT_LIMIT = { rateLimit: { max: 5, timeWindow: '1 hour' } };

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function contentRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/faqs',
    {
      schema: {
        tags: ['content'],
        summary: 'Published FAQ entries, grouped by category',
        description:
          'Grouped on the server in the enum’s order, so the Help page and the admin panel ' +
          'cannot sort the sections differently. An empty category is omitted.',
        response: { 200: FaqListResponse },
      },
    },
    () => listFaqs(app.db),
  );

  routes.post(
    '/contact',
    {
      config: CONTACT_LIMIT,
      schema: {
        tags: ['content'],
        summary: 'Send a message from the Help page',
        description:
          'Carries a honeypot field and the time the form rendered. A submission that fails ' +
          'either check gets the same 201 a real one does and is simply not stored - telling a ' +
          'bot it was caught tells it what to change.',
        body: ContactMessageInput,
        response: { 201: ContactMessageResult, 422: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      await submitContactMessage(app.db, request.body, { ip: request.ip });
      return reply.status(201).send({ received: true } as const);
    },
  );
}
