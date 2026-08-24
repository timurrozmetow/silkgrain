import type {
  AdminCategoryInput,
  AdminCategoryList,
  AdminCategoryNode,
  AdminCategoryRow,
  AdminCategoryUpdateInput,
} from '@silkgrain/contracts';
import { and, asc, count, countDistinct, eq, inArray, ne } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import { categories, productVariants, products } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { processImage } from '../media/image.service';
import type { Storage } from '../media/storage.service';

import type { AdminActor } from './actor';
import { diffSnapshots } from './audit.diff';
import { categorySnapshot } from './audit.projectors';
import { type AuditContext, recordAudit } from './audit.service';

/**
 * Categories in the back office.
 *
 * The screen that unblocks every other one: `products.category_id` is NOT NULL and nothing else in
 * the panel can create a category, so a freshly migrated shop cannot hold a single product until
 * this exists.
 *
 * Three rules do most of the work here, and all three are about the storefront staying coherent.
 *
 * **A category's active flag decides whether its products are in the shop at all.** It is part of
 * `PUBLISHED_PRODUCT` - `status = 'active' AND categories.is_active` - which is how Phase 3 fixed
 * the defect where deactivating a category removed it from the mega-menu and left its products in
 * the grid, in search and in the cart. So switching one off retires a branch of the catalogue, and
 * this file's job is to make that consequence visible rather than surprising: the response carries
 * the counts the panel prints beside the switch.
 *
 * **The tree is exactly two levels, and it is enforced rather than described.** A category with a
 * parent may not be given children and a category with children may not be given a parent. The
 * mega-menu draws parents as a grid and children as a chip row; a third level would exist in the
 * database and be invisible in the shop, which is the worst of both.
 *
 * **There is no DELETE.** `products.category_id` is `ON DELETE restrict`, so MySQL would refuse a
 * category anybody had used and allow one nobody had - a rule that depends on how much work has
 * been done rather than on what the operator meant. `parent_id` is `ON DELETE set null`, so a
 * delete would also promote a child to the top level as a side effect nobody asked for. The
 * terminal action is `is_active = false`, exactly as it is for promo codes and administrators.
 */

type CategoryRow = typeof categories.$inferSelect;

/**
 * Deactivating a parent takes its children with it, inside the same transaction.
 *
 * Without that, a child left active under an inactive parent is the Phase 3 defect wearing a
 * different hat: `PUBLISHED_PRODUCT` joins the product's own category, so the child's products
 * stay in the grid and in search, while `listCategories` drops the child from the tree because its
 * parent is not in it. The category is unreachable from every menu in the shop and its products
 * are still for sale.
 *
 * The alternative was to teach the storefront to check the parent as well, which means a self-join
 * on `categories` in every product query, every facet and every search - a hot read path made
 * slower to compensate for a rare write. Cascading one write is cheaper and, unlike the read-path
 * fix, it is visible in the audit log.
 *
 * Reactivating does not cascade: a child switched off on its own was switched off for a reason,
 * and turning the parent back on must not undo somebody else's decision.
 */
const CASCADE_NOTE = (names: string[]): string =>
  `Sub-categories deactivated with it: ${names.join(', ')}`;

// ------------------------------------------------------------------------------------ reading

/**
 * Two counts per category, neither of them folding in a child's.
 *
 * `productCount` is everything filed directly here at any status - the number that answers "is
 * anything using this". `liveCount` is what the shop would show for it: an active product with at
 * least one active variant, the same definition `countProductsByCategory` uses on the storefront,
 * minus the category's own active flag. Leaving that flag out is deliberate - the point of the
 * number beside a deactivated category is what would come back if it were switched on.
 */
async function countsByCategory(
  db: Database,
): Promise<Map<number, { total: number; live: number }>> {
  const [totals, live] = await Promise.all([
    db
      .select({ categoryId: products.categoryId, total: count() })
      .from(products)
      .groupBy(products.categoryId),
    db
      .select({ categoryId: products.categoryId, total: countDistinct(products.id) })
      .from(products)
      .innerJoin(
        productVariants,
        and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true)),
      )
      .where(eq(products.status, 'active'))
      .groupBy(products.categoryId),
  ]);

  const counts = new Map<number, { total: number; live: number }>();
  for (const row of totals) counts.set(row.categoryId, { total: row.total, live: 0 });
  for (const row of live) {
    const entry = counts.get(row.categoryId);
    if (entry) entry.live = row.total;
  }
  return counts;
}

function toRow(
  row: CategoryRow,
  counts: Map<number, { total: number; live: number }>,
): AdminCategoryRow {
  const tally = counts.get(row.id);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    imageUrl: row.imageUrl,
    parentId: row.parentId,
    position: row.position,
    isActive: row.isActive,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    productCount: tally?.total ?? 0,
    liveCount: tally?.live ?? 0,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The whole tree, inactive rows included.
 *
 * The storefront's `listCategories` filters to active because a customer must not be shown a
 * retired category; this one must show them, because this is the screen where one is brought back.
 * Two audiences, two projections - the same rule the product list already follows.
 */
export async function listAdminCategories(db: Database): Promise<AdminCategoryList> {
  const [rows, counts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.position), asc(categories.name)),
    countsByCategory(db),
  ]);

  const childrenOf = new Map<number, CategoryRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const items: AdminCategoryNode[] = rows
    .filter((row) => row.parentId === null)
    .map((row) => ({
      ...toRow(row, counts),
      children: (childrenOf.get(row.id) ?? []).map((child) => toRow(child, counts)),
    }));

  return { items };
}

async function readRow(db: Database, id: number): Promise<CategoryRow> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  if (!row) throw notFound('Category');
  return row;
}

// ------------------------------------------------------------------------------------ writing

/**
 * A duplicate slug, caught before the unique index turns it into a 500.
 *
 * The same guard the product writer has, and for the same reason: a slug is the row's public
 * address, so a clash is a conflict about a name rather than an internal error.
 */
async function assertSlugFree(
  tx: DbExecutor,
  slug: string,
  exceptId: number | null,
): Promise<void> {
  const [clash] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      exceptId === null
        ? eq(categories.slug, slug)
        : and(eq(categories.slug, slug), ne(categories.id, exceptId)),
    );

  if (clash) {
    throw new AppError('CONFLICT', `Another category already uses the slug "${slug}"`, {
      details: [{ path: 'slug', message: 'Already taken' }],
    });
  }
}

/**
 * Everything that can go wrong about a parent, in one place.
 *
 * Moving a category to the top level is always allowed, so the whole function is a no-op for a
 * null parent. `selfId` is null when creating, which removes two of the checks: a row that does
 * not exist yet cannot be its own parent and cannot have children of its own.
 *
 * `willBeActive` is the flag the row will carry when the write lands, not the one it carries now.
 * Filing an active category under a deactivated parent hides it from every menu in the shop while
 * leaving its products for sale, which is the incoherence the deactivation cascade exists to stop
 * arriving by the other door.
 */
async function assertParentAllowed(
  tx: DbExecutor,
  parentId: number | null,
  selfId: number | null,
  willBeActive: boolean,
): Promise<void> {
  if (parentId === null) return;

  if (parentId === selfId) {
    throw new AppError('CONFLICT', 'A category cannot be its own parent', {
      details: [{ path: 'parentId', message: 'That is this category' }],
    });
  }

  if (selfId !== null) {
    const [child] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, selfId))
      .limit(1);

    if (child) {
      throw new AppError(
        'CONFLICT',
        'This category has sub-categories of its own, so it cannot be filed under another one',
        { details: [{ path: 'parentId', message: 'It already has sub-categories' }] },
      );
    }
  }

  const [parent] = await tx
    .select({ parentId: categories.parentId, name: categories.name, isActive: categories.isActive })
    .from(categories)
    .where(eq(categories.id, parentId));

  if (!parent) {
    throw new AppError('CONFLICT', 'That parent category does not exist', {
      details: [{ path: 'parentId', message: 'No such category' }],
    });
  }

  if (parent.parentId !== null) {
    throw new AppError(
      'CONFLICT',
      `${parent.name} is itself a sub-category, and the shop only has two levels`,
      { details: [{ path: 'parentId', message: 'That is already a sub-category' }] },
    );
  }

  if (willBeActive && !parent.isActive) {
    throw new AppError(
      'CONFLICT',
      `${parent.name} is deactivated, so nothing active can be filed under it`,
      { details: [{ path: 'parentId', message: 'That category is deactivated' }] },
    );
  }
}

function columnsFor(input: AdminCategoryUpdateInput) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    icon: input.icon ?? null,
    parentId: input.parentId,
    position: input.position,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
  };
}

export async function createCategory(
  db: Database,
  input: AdminCategoryInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminCategoryList> {
  await db.transaction(async (tx) => {
    await assertSlugFree(tx, input.slug, null);
    await assertParentAllowed(tx, input.parentId, null, input.isActive);

    const [inserted] = await tx
      .insert(categories)
      .values({ ...columnsFor(input), isActive: input.isActive })
      .$returningId();
    if (!inserted) throw new AppError('INTERNAL', 'The category was not inserted');

    const [created] = await tx.select().from(categories).where(eq(categories.id, inserted.id));
    await recordAudit(tx, actor, context, {
      action: 'category.created',
      entityId: inserted.id,
      entityLabel: input.name,
      before: null,
      after: created ? categorySnapshot(created) : null,
    });
  });

  return listAdminCategories(db);
}

/**
 * Replaces a category's fields.
 *
 * The slug may be renamed, and nothing stops it - unlike a promo code, which an order snapshots by
 * value. What a rename costs is a link: `/shop/c/<slug>` is a page somebody may have bookmarked or
 * a search engine may have indexed, and there is no redirect table in this platform to soften it.
 * That is a fact the operator needs before pressing the button, not a refusal, so the panel says
 * so at the field and the API allows it.
 */
export async function updateCategory(
  db: Database,
  id: number,
  input: AdminCategoryUpdateInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminCategoryList> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .for('update');
    if (!existing) throw notFound('Category');

    await assertSlugFree(tx, input.slug, id);
    // `isActive` is not in this body, so the flag the row already carries is the one it will keep.
    await assertParentAllowed(tx, input.parentId, id, existing.isActive);

    await tx.update(categories).set(columnsFor(input)).where(eq(categories.id, id));

    const [after] = await tx.select().from(categories).where(eq(categories.id, id));
    const delta = after && diffSnapshots(categorySnapshot(existing), categorySnapshot(after));
    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'category.updated',
        entityId: id,
        entityLabel: after.name,
        before: delta.before,
        after: delta.after,
      });
    }
  });

  return listAdminCategories(db);
}

/**
 * The terminal action, and the one with consequences beyond its own row.
 *
 * Switching a category off takes its products out of the shop - out of the grid, out of search,
 * out of the mega-menu - because `PUBLISHED_PRODUCT` requires the category to be active. Switching
 * a parent off takes its sub-categories with it, in this transaction, for the reason `CASCADE_NOTE`
 * explains. Switching a child on under a deactivated parent is refused: it would put products back
 * in the grid under a heading no menu in the shop leads to.
 */
export async function setCategoryActive(
  db: Database,
  id: number,
  isActive: boolean,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminCategoryList> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
    if (!row) throw notFound('Category');
    if (row.isActive === isActive) return;

    if (isActive && row.parentId !== null) {
      const [parent] = await tx
        .select({ name: categories.name, isActive: categories.isActive })
        .from(categories)
        .where(eq(categories.id, row.parentId));
      if (parent && !parent.isActive) {
        throw new AppError(
          'CONFLICT',
          `${parent.name} is deactivated; bring it back first, or move this category to the top level`,
        );
      }
    }

    // Read before the write, so the entry names the children as they were.
    const cascaded = isActive
      ? []
      : await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.parentId, id), eq(categories.isActive, true)));

    await tx.update(categories).set({ isActive }).where(eq(categories.id, id));
    if (cascaded.length > 0) {
      await tx
        .update(categories)
        .set({ isActive: false })
        .where(
          inArray(
            categories.id,
            cascaded.map((child) => child.id),
          ),
        );
    }

    await recordAudit(tx, actor, context, {
      action: 'category.active_changed',
      entityId: id,
      entityLabel: row.name,
      before: { isActive: row.isActive },
      after: { isActive },
      // One entry for the one action the operator took, with the collateral named in it rather
      // than scattered across a row per child (D-36).
      note: cascaded.length > 0 ? CASCADE_NOTE(cascaded.map((child) => child.name)) : null,
    });
  });

  return listAdminCategories(db);
}

// ------------------------------------------------------------------------------------- images

/**
 * The category hero, processed and stored exactly as a product photograph is.
 *
 * It is an upload rather than a URL field because production serves under `img-src 'self' data:`
 * (D-52): an address pasted from anywhere else renders as a blank rectangle, with no error
 * anywhere for anybody to notice. Going through `processImage` also means the same webp cap, the
 * same metadata strip and the same content-addressed key as every other image in the shop.
 *
 * The old object is removed after the row is written, best-effort, on the storage service's own
 * terms: the database says what exists and the bucket holds the bytes.
 */
export async function setCategoryImage(
  db: Database,
  storage: Storage,
  id: number,
  file: Buffer,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminCategoryList> {
  const existing = await readRow(db, id);
  const processed = await processImage(file);
  const url = await storage.put(processed.key, processed.body, processed.contentType);

  await db.transaction(async (tx) => {
    await tx.update(categories).set({ imageUrl: url }).where(eq(categories.id, id));
    await recordAudit(tx, actor, context, {
      action: 'category.image_updated',
      entityId: id,
      entityLabel: existing.name,
      before: { imageUrl: existing.imageUrl },
      after: { imageUrl: url },
    });
  });

  // Only after the row is committed, and only when the bytes actually changed: an identical
  // upload lands on the same content-addressed key, and removing it would delete the live image.
  if (existing.imageUrl !== null && existing.imageUrl !== url)
    await storage.remove(existing.imageUrl);

  return listAdminCategories(db);
}

export async function clearCategoryImage(
  db: Database,
  storage: Storage,
  id: number,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminCategoryList> {
  const existing = await readRow(db, id);
  if (existing.imageUrl === null) return listAdminCategories(db);

  await db.transaction(async (tx) => {
    await tx.update(categories).set({ imageUrl: null }).where(eq(categories.id, id));
    await recordAudit(tx, actor, context, {
      action: 'category.image_removed',
      entityId: id,
      entityLabel: existing.name,
      before: { imageUrl: existing.imageUrl },
      after: { imageUrl: null },
    });
  });

  await storage.remove(existing.imageUrl);
  return listAdminCategories(db);
}
