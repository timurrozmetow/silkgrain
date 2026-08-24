import {
  ApiError,
  CategoryListResponse,
  ProductDetailResponse,
  ProductListQuery,
  ProductListResponse,
  SearchSuggestQuery,
  SearchSuggestResponse,
  Slug,
  TestimonialListQuery,
  TestimonialListResponse,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  getProductBySlug,
  listCategories,
  listProducts,
  listTestimonials,
  suggestProducts,
} from './catalog.service';

const SlugParams = z.object({ slug: Slug });

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/categories',
    {
      schema: {
        tags: ['catalog'],
        summary: 'The category tree with product counts',
        description:
          'Counts are computed from the database and describe exactly what the grid would ' +
          'show: an active product with at least one active variant. A parent count includes ' +
          'its children.',
        response: { 200: CategoryListResponse },
      },
    },
    () => listCategories(app.db),
  );

  routes.get(
    '/products',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Browse the catalogue',
        description:
          'Filters combine as OR inside a facet and AND across facets. Sidebar counts and the ' +
          'price bounds are each computed with their own filter removed, so ticking a category ' +
          'never collapses the others to zero.',
        querystring: ProductListQuery,
        response: { 200: ProductListResponse, 422: ApiError },
      },
    },
    (request) => listProducts(app.db, request.query),
  );

  routes.get(
    '/products/:slug',
    {
      schema: {
        tags: ['catalog'],
        summary: 'One product, with variants, nutrition, reviews and related items',
        params: SlugParams,
        response: { 200: ProductDetailResponse, 404: ApiError, 422: ApiError },
      },
    },
    (request) => getProductBySlug(app.db, request.params.slug),
  );

  routes.get(
    '/testimonials',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Five-star reviews for the home page',
        description:
          'Published five-star reviews of products still in the catalogue, long enough to read ' +
          'as a pull quote, verified buyers first. Not a separate table: a testimonial is a ' +
          'review, and a second copy of one would be a second copy nobody moderates.',
        querystring: TestimonialListQuery,
        response: { 200: TestimonialListResponse, 422: ApiError },
      },
    },
    async (request) => ({ items: await listTestimonials(app.db, request.query.limit) }),
  );

  routes.get(
    '/search/suggest',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Type-ahead results for the search overlay',
        querystring: SearchSuggestQuery,
        response: { 200: SearchSuggestResponse, 422: ApiError },
      },
    },
    (request) => suggestProducts(app.db, request.query.q, request.query.limit),
  );
}
