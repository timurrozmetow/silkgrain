import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

import type { Env } from '../env';

export interface SwaggerOptions {
  env: Env;
}

/**
 * OpenAPI generated from the Zod schemas the routes already validate against.
 *
 * Nothing is written by hand, so the document cannot describe an endpoint that no longer
 * behaves that way - the failure mode of every hand-maintained API reference.
 *
 * Not mounted in production: the document names every field of every request body, which is
 * a map of the attack surface, and the storefront does not read it at runtime.
 */
export const swaggerPlugin = fp<SwaggerOptions>(
  async function docs(app: FastifyInstance, { env }) {
    if (env.NODE_ENV === 'production') return;

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'SilkGrain API',
          description:
            'Storefront and back-office API. Money is always an integer number of cents ' +
            'plus an explicit currency; the client never sends a price.',
          version: '0.1.0',
        },
        servers: [{ url: `http://localhost:${String(env.API_PORT)}`, description: 'local' }],
        tags: [
          { name: 'system', description: 'Liveness and readiness' },
          { name: 'auth', description: 'Customer and administrator sessions' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Access token from /api/auth/login. Expires in 15 minutes.',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      // Swagger UI needs inline styles, which the global helmet policy forbids. `staticCSP`
      // sets a policy scoped to these routes instead of loosening it everywhere.
      staticCSP: true,
      uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
    });
  },
  { name: 'silkgrain-swagger' },
);
