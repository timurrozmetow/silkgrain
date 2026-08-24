import type {
  AdminFaqInput,
  AdminFaqList,
  AdminFaqRow,
  AdminFaqUpdateInput,
  AdminRecipeDetail,
  AdminRecipeInput,
  AdminRecipeList,
  AdminRecipeRow,
  AdminRecipeUpdateInput,
} from '@silkgrain/contracts';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import { faqs, products, recipeProducts, recipes } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { processImage } from '../media/image.service';
import type { Storage } from '../media/storage.service';

import type { AdminActor } from './actor';
import { diffSnapshots } from './audit.diff';
import { faqSnapshot, recipeSnapshot } from './audit.projectors';
import { type AuditContext, recordAudit } from './audit.service';

/**
 * Recipes and the FAQ in the back office.
 *
 * Both tables have had a public endpoint and a seed since Phase 2 and no way to write them in
 * production - the same gap categories had, and with the same symptom: `/recipes` is in the main
 * navigation and opens empty, and `/help` answers every question with nothing.
 *
 * Neither is deleted. A recipe is a URL somebody may have shared and a FAQ answer is something a
 * customer may have been told; `is_published = false` takes either out of the shop while leaving
 * the row to be brought back, which is the same terminal action promo codes, administrators and
 * categories already use. The one difference from categories is that nothing depends on a recipe
 * the way a product depends on its category, so unpublishing one has no reach beyond itself.
 *
 * `published_at` is stamped by the publish route rather than typed into a form. It is the answer
 * to "since when", and a field an editor could type would let it disagree with `is_published` -
 * a recipe dated next March that is live today, or a live one with no date at all.
 */

type RecipeRow = typeof recipes.$inferSelect;
type FaqRow = typeof faqs.$inferSelect;

// ------------------------------------------------------------------------------------ recipes

function toRecipeRow(row: RecipeRow, productCount: number): AdminRecipeRow {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    imageUrl: row.heroImageUrl,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    servings: row.servings,
    difficulty: row.difficulty,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    productCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every recipe, drafts included, newest first.
 *
 * The storefront's `listRecipes` filters to published and sorts by publication date; a draft has
 * no publication date, so sorting this list the same way would bury exactly the rows an editor
 * came here to finish. `updated_at` is what "what was I working on" means.
 */
export async function listAdminRecipes(db: Database): Promise<AdminRecipeList> {
  const [rows, links] = await Promise.all([
    db.select().from(recipes).orderBy(asc(recipes.title)),
    db
      .select({ recipeId: recipeProducts.recipeId, total: count() })
      .from(recipeProducts)
      .groupBy(recipeProducts.recipeId),
  ]);

  const counts = new Map(links.map((link) => [link.recipeId, link.total]));
  return { items: rows.map((row) => toRecipeRow(row, counts.get(row.id) ?? 0)) };
}

export async function getAdminRecipe(db: Database, id: number): Promise<AdminRecipeDetail> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!row) throw notFound('Recipe');

  const links = await db
    .select({ productId: recipeProducts.productId })
    .from(recipeProducts)
    .where(eq(recipeProducts.recipeId, id))
    .orderBy(asc(recipeProducts.position));

  return {
    ...toRecipeRow(row, links.length),
    imageAlt: row.heroImageAlt,
    body: row.body,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    productIds: links.map((link) => link.productId),
  };
}

async function assertRecipeSlugFree(
  tx: DbExecutor,
  slug: string,
  exceptId: number | null,
): Promise<void> {
  const [clash] = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      exceptId === null
        ? eq(recipes.slug, slug)
        : and(eq(recipes.slug, slug), ne(recipes.id, exceptId)),
    );

  if (clash) {
    throw new AppError('CONFLICT', `Another recipe already uses the slug "${slug}"`, {
      details: [{ path: 'slug', message: 'Already taken' }],
    });
  }
}

/**
 * Replaces a recipe's product links.
 *
 * Delete-then-insert rather than a diff: the list is at most twelve rows keyed by position, and a
 * reorder changes every one of them anyway. The ids are checked first, because
 * `recipe_products.product_id` is `ON DELETE cascade` from `products` and an id that does not
 * exist would fail on the foreign key as a 500 rather than as "no such product".
 */
async function setRecipeProducts(
  tx: DbExecutor,
  recipeId: number,
  productIds: number[],
): Promise<void> {
  await tx.delete(recipeProducts).where(eq(recipeProducts.recipeId, recipeId));
  if (productIds.length === 0) return;

  const unique = [...new Set(productIds)];
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, unique));

  if (found.length !== unique.length) {
    const known = new Set(found.map((row) => row.id));
    const missing = unique.filter((id) => !known.has(id));
    throw new AppError('CONFLICT', `No product with id ${missing.join(', ')}`, {
      details: [{ path: 'productIds', message: 'One of these products does not exist' }],
    });
  }

  await tx
    .insert(recipeProducts)
    .values(unique.map((productId, position) => ({ recipeId, productId, position })));
}

function recipeColumns(input: AdminRecipeUpdateInput) {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    servings: input.servings,
    difficulty: input.difficulty,
    heroImageAlt: input.imageAlt ?? null,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
  };
}

export async function createRecipe(
  db: Database,
  input: AdminRecipeInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminRecipeDetail> {
  const id = await db.transaction(async (tx) => {
    await assertRecipeSlugFree(tx, input.slug, null);

    const [inserted] = await tx
      .insert(recipes)
      .values({
        ...recipeColumns(input),
        isPublished: input.isPublished,
        // Stamped here rather than left null, so a recipe created live has a date from the start.
        publishedAt: input.isPublished ? new Date() : null,
      })
      .$returningId();
    if (!inserted) throw new AppError('INTERNAL', 'The recipe was not inserted');

    await setRecipeProducts(tx, inserted.id, input.productIds);

    const [created] = await tx.select().from(recipes).where(eq(recipes.id, inserted.id));
    await recordAudit(tx, actor, context, {
      action: 'recipe.created',
      entityId: inserted.id,
      entityLabel: input.title,
      before: null,
      after: created ? recipeSnapshot(created) : null,
    });
    return inserted.id;
  });

  return getAdminRecipe(db, id);
}

export async function updateRecipe(
  db: Database,
  id: number,
  input: AdminRecipeUpdateInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminRecipeDetail> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(recipes).where(eq(recipes.id, id)).for('update');
    if (!existing) throw notFound('Recipe');

    await assertRecipeSlugFree(tx, input.slug, id);
    await tx.update(recipes).set(recipeColumns(input)).where(eq(recipes.id, id));
    await setRecipeProducts(tx, id, input.productIds);

    const [after] = await tx.select().from(recipes).where(eq(recipes.id, id));
    const delta = after && diffSnapshots(recipeSnapshot(existing), recipeSnapshot(after));
    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'recipe.updated',
        entityId: id,
        entityLabel: after.title,
        before: delta.before,
        after: delta.after,
      });
    }
  });

  return getAdminRecipe(db, id);
}

/**
 * The terminal action, and the only writer of `published_at`.
 *
 * The date is stamped the first time a recipe goes live and never moved again: taking one down to
 * fix a typo and putting it back is not republishing it, and a list sorted by that date should
 * not reshuffle because somebody corrected a measurement.
 */
export async function setRecipePublished(
  db: Database,
  id: number,
  isPublished: boolean,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminRecipeDetail> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(recipes).where(eq(recipes.id, id)).for('update');
    if (!row) throw notFound('Recipe');
    if (row.isPublished === isPublished) return;

    await tx
      .update(recipes)
      .set({
        isPublished,
        publishedAt: isPublished && row.publishedAt === null ? new Date() : row.publishedAt,
      })
      .where(eq(recipes.id, id));

    await recordAudit(tx, actor, context, {
      action: 'recipe.published_changed',
      entityId: id,
      entityLabel: row.title,
      before: { isPublished: row.isPublished },
      after: { isPublished },
    });
  });

  return getAdminRecipe(db, id);
}

/** The hero, through the same pipeline every other photograph in the shop takes. */
export async function setRecipeImage(
  db: Database,
  storage: Storage,
  id: number,
  file: Buffer,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminRecipeDetail> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) throw notFound('Recipe');

  const processed = await processImage(file);
  const url = await storage.put(processed.key, processed.body, processed.contentType);

  await db.transaction(async (tx) => {
    await tx.update(recipes).set({ heroImageUrl: url }).where(eq(recipes.id, id));
    await recordAudit(tx, actor, context, {
      action: 'recipe.image_updated',
      entityId: id,
      entityLabel: existing.title,
      before: { heroImageUrl: existing.heroImageUrl },
      after: { heroImageUrl: url },
    });
  });

  // Only once the row is committed, and only when the bytes actually changed: an identical upload
  // lands on the same content-addressed key, and removing it would delete the live image.
  if (existing.heroImageUrl !== null && existing.heroImageUrl !== url) {
    await storage.remove(existing.heroImageUrl);
  }

  return getAdminRecipe(db, id);
}

// --------------------------------------------------------------------------------------- FAQ

function toFaqRow(row: FaqRow): AdminFaqRow {
  return {
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    position: row.position,
    isPublished: row.isPublished,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every entry, unpublished included, in the order the Help page draws them.
 *
 * Flat rather than grouped, which is the one place this departs from the storefront's shape: the
 * accordion groups by category because that is how it reads, and an editor reordering entries
 * needs the whole list in one sort so a `position` collision between two categories is visible.
 */
export async function listAdminFaqs(db: Database): Promise<AdminFaqList> {
  const rows = await db
    .select()
    .from(faqs)
    .orderBy(asc(faqs.category), asc(faqs.position), asc(faqs.id));
  return { items: rows.map(toFaqRow) };
}

export async function createFaq(
  db: Database,
  input: AdminFaqInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminFaqList> {
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(faqs)
      .values({
        category: input.category,
        question: input.question,
        answer: input.answer,
        position: input.position,
        isPublished: input.isPublished,
      })
      .$returningId();
    if (!inserted) throw new AppError('INTERNAL', 'The FAQ entry was not inserted');

    const [created] = await tx.select().from(faqs).where(eq(faqs.id, inserted.id));
    await recordAudit(tx, actor, context, {
      action: 'faq.created',
      entityId: inserted.id,
      entityLabel: input.question,
      before: null,
      after: created ? faqSnapshot(created) : null,
    });
  });

  return listAdminFaqs(db);
}

export async function updateFaq(
  db: Database,
  id: number,
  input: AdminFaqUpdateInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminFaqList> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(faqs).where(eq(faqs.id, id)).for('update');
    if (!existing) throw notFound('FAQ entry');

    await tx
      .update(faqs)
      .set({
        category: input.category,
        question: input.question,
        answer: input.answer,
        position: input.position,
      })
      .where(eq(faqs.id, id));

    const [after] = await tx.select().from(faqs).where(eq(faqs.id, id));
    const delta = after && diffSnapshots(faqSnapshot(existing), faqSnapshot(after));
    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'faq.updated',
        entityId: id,
        entityLabel: after.question,
        before: delta.before,
        after: delta.after,
      });
    }
  });

  return listAdminFaqs(db);
}

export async function setFaqPublished(
  db: Database,
  id: number,
  isPublished: boolean,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminFaqList> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(faqs).where(eq(faqs.id, id)).for('update');
    if (!row) throw notFound('FAQ entry');
    if (row.isPublished === isPublished) return;

    await tx.update(faqs).set({ isPublished }).where(eq(faqs.id, id));
    await recordAudit(tx, actor, context, {
      action: 'faq.published_changed',
      entityId: id,
      entityLabel: row.question,
      before: { isPublished: row.isPublished },
      after: { isPublished },
    });
  });

  return listAdminFaqs(db);
}
