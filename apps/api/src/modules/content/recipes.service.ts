import type { RecipeCard, RecipeDetail, RecipeListResponse } from '@silkgrain/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { recipeProducts, recipes } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { loadProductCards } from '../catalog/catalog.service';

/**
 * Recipes.
 *
 * `total_minutes` is computed here rather than on each client: it is prep plus cook, and two
 * places adding it up is two places that can round or label it differently.
 */

const PUBLISHED = and(eq(recipes.isPublished, true));

function toCard(row: typeof recipes.$inferSelect): RecipeCard {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    image:
      row.heroImageUrl === null
        ? null
        : { url: row.heroImageUrl, alt: row.heroImageAlt ?? row.title },
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: row.prepMinutes + row.cookMinutes,
    servings: row.servings,
    difficulty: row.difficulty,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export async function listRecipes(db: Database): Promise<RecipeListResponse> {
  const rows = await db
    .select()
    .from(recipes)
    .where(PUBLISHED)
    // Newest first, and the first one is the featured panel. A `featured` column would be a
    // second thing for an editor to remember; publishing something new is the intent already.
    .orderBy(desc(recipes.publishedAt), desc(recipes.id));

  const cards = rows.map(toCard);
  return { featured: cards[0] ?? null, items: cards.slice(1) };
}

export async function getRecipeBySlug(db: Database, slug: string): Promise<RecipeDetail> {
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.slug, slug), PUBLISHED));
  if (!row) throw notFound('Recipe');

  const links = await db
    .select({ productId: recipeProducts.productId })
    .from(recipeProducts)
    .where(eq(recipeProducts.recipeId, row.id))
    .orderBy(asc(recipeProducts.position));

  const ids = links.map((link) => link.productId);

  return {
    ...toCard(row),
    body: row.body,
    // Reuses the catalogue's own card builder, so a recipe's ingredient list carries the same
    // derived badges, price range and stock state a grid does - and an unpublished or retired
    // product simply does not come back.
    products: ids.length === 0 ? [] : await loadProductCards(db, ids),
    seo: { metaTitle: row.metaTitle, metaDescription: row.metaDescription },
  };
}
