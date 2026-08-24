import { type ContactMessageInput, FAQ_CATEGORY, type FaqListResponse } from '@silkgrain/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { contactMessages, faqs } from '../../db/schema';
import { looksAutomated } from '../../lib/form-guards';

/**
 * The FAQ, and the Help page's message.
 */

export async function listFaqs(db: Database): Promise<FaqListResponse> {
  const rows = await db
    .select({
      id: faqs.id,
      category: faqs.category,
      question: faqs.question,
      answer: faqs.answer,
    })
    .from(faqs)
    .where(eq(faqs.isPublished, true))
    .orderBy(asc(faqs.position), asc(faqs.id));

  // Grouped in the enum's order rather than the rows' order, so adding an entry cannot
  // reshuffle the sections it does not belong to. An empty category is left out entirely.
  const groups = FAQ_CATEGORY.map((category) => ({
    category,
    items: rows.filter((row) => row.category === category),
  })).filter((group) => group.items.length > 0);

  return { groups };
}

export interface ContactContext {
  ip: string;
}

/**
 * Stores the message, or pretends to.
 *
 * A submission that fails the checks is answered exactly as a real one is. Telling a bot it was
 * caught tells it what to change, and telling a person their message was rejected because they
 * typed quickly would be worse still - so the only asymmetry is whether a row is written.
 */
export async function submitContactMessage(
  db: Database,
  input: ContactMessageInput,
  context: ContactContext,
): Promise<{ stored: boolean }> {
  if (looksAutomated(input)) return { stored: false };

  await db.insert(contactMessages).values({
    name: input.name,
    email: input.email,
    subject: input.subject,
    body: input.body,
    orderNumber: input.orderNumber ?? null,
    submittedIp: context.ip,
  });

  return { stored: true };
}
