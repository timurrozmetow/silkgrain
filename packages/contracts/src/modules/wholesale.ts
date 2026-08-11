import { z } from 'zod';

import { BusinessType, VolumeBand } from '../enums';
import { Email, Phone, Slug } from '../primitives';

/**
 * The wholesale enquiry, exactly the field set the mockup draws (decision D-5).
 *
 * One contact-name field and no business address. The `wholesale_requests` table keeps its
 * address and `contact_last_name` columns nullable so a longer form can arrive later without
 * rewriting a migration - which is the whole reason they are nullable rather than absent.
 *
 * Input only. The admin's view of a request - status, assignee, the notes log - belongs to
 * Phase 7 and is not drafted here: a schema nothing serialises is a schema nobody has checked.
 */
export const WholesaleRequestInput = z
  .object({
    businessName: z.string().trim().min(2).max(200),
    businessType: BusinessType,
    /** One field, as designed. Split names are the admin form's problem, not the applicant's. */
    contactName: z.string().trim().min(2).max(160),
    email: Email,
    phone: Phone.optional(),
    monthlyVolumeBand: VolumeBand,
    /**
     * Category slugs from the chips. Optional because the design does not mark it required, and
     * an enquiry that names no category is still an enquiry worth answering.
     */
    categoriesOfInterest: z.array(Slug).max(12).optional(),
    notes: z.string().trim().max(2000).optional(),

    /**
     * The honeypot, and deliberately `string` rather than `z.literal('')`.
     *
     * A literal would reject a filled honeypot with a 422, which works and tells the bot exactly
     * which field gave it away. Accepting any string lets the handler answer the same 201 a real
     * enquiry gets and quietly store nothing. The same reasoning as `ContactMessageInput`, and
     * the same mistake was in this file's draft.
     */
    website: z.string().max(200).optional(),
    /** Milliseconds since the epoch, stamped when the form rendered. See `looksAutomated`. */
    formRenderedAt: z.coerce.number().int().positive(),
  })
  .strict();
export type WholesaleRequestInput = z.infer<typeof WholesaleRequestInput>;

/**
 * The same answer whether the enquiry was stored or silently dropped.
 *
 * A bot told it was caught learns what to change; a person told their enquiry was rejected
 * because they typed quickly learns to distrust the form.
 */
export const WholesaleRequestResult = z.object({ received: z.literal(true) });
export type WholesaleRequestResult = z.infer<typeof WholesaleRequestResult>;
