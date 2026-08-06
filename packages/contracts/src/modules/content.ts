import { z } from 'zod';

import { FaqCategory } from '../enums';
import { Email, Id } from '../primitives';

import { OrderNumber } from './order';

/**
 * Editorial content: the FAQ, and the message the Help page sends.
 *
 * Both are read and written by the storefront rather than by an editor, which is why they live
 * here rather than under `admin/`. The FAQ's answers are Markdown, so a paragraph break in the
 * admin panel survives to the accordion.
 */

export const FaqEntry = z.object({
  id: Id,
  category: FaqCategory,
  question: z.string(),
  /** Markdown. */
  answer: z.string(),
});
export type FaqEntry = z.infer<typeof FaqEntry>;

/**
 * Grouped by category, in the order the accordion draws them.
 *
 * Grouped on the server rather than in the browser: the categories are a closed enum with a
 * fixed order, and doing it here means the Help page and the admin panel cannot sort them
 * differently.
 */
export const FaqListResponse = z.object({
  groups: z.array(
    z.object({
      category: FaqCategory,
      items: z.array(FaqEntry).min(1),
    }),
  ),
});
export type FaqListResponse = z.infer<typeof FaqListResponse>;

/**
 * The contact form.
 *
 * `website` is a honeypot: it is hidden from people and irresistible to the bots that fill
 * every field they find, so anything in it means the submission is not human. `formRenderedAt`
 * is the other half - a form submitted three seconds after it rendered was not read. Both are
 * checked server-side, and a caught submission is answered with the same 201 a real one gets,
 * because telling a bot it was caught is telling it what to change.
 */
export const ContactMessageInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: Email,
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(10).max(4000),
    /** Optional, so "where is my order" can be answered without asking for it twice. */
    orderNumber: OrderNumber.optional(),
    /**
     * Deliberately `string`, not `z.literal('')`.
     *
     * A literal would make the schema reject a filled honeypot with a 422 - which works, and
     * tells the bot precisely which field gave it away. Accepting any string lets the handler
     * answer the same 201 a real submission gets and quietly store nothing.
     */
    website: z.string().max(200).optional(),
    formRenderedAt: z.coerce.number().int().positive(),
  })
  .strict();
export type ContactMessageInput = z.infer<typeof ContactMessageInput>;

export const ContactMessageResult = z.object({ received: z.literal(true) });
export type ContactMessageResult = z.infer<typeof ContactMessageResult>;
