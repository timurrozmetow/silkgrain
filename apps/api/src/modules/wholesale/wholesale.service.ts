import type { WholesaleRequestInput } from '@silkgrain/contracts';

import type { Database } from '../../db/client';
import { wholesaleRequests } from '../../db/schema';
import { looksAutomated } from '../../lib/form-guards';

/**
 * Storing a wholesale enquiry, or pretending to.
 *
 * A submission that fails the anti-automation checks is answered exactly as a real one is; the
 * only asymmetry is whether a row is written. `form-guards.ts` explains why.
 */

export interface WholesaleContext {
  ip: string;
}

export async function submitWholesaleRequest(
  db: Database,
  input: WholesaleRequestInput,
  context: WholesaleContext,
): Promise<{ stored: boolean }> {
  if (looksAutomated(input)) return { stored: false };

  await db.insert(wholesaleRequests).values({
    businessName: input.businessName,
    businessType: input.businessType,
    // The form asks for one name (decision D-5). It goes in whole rather than being split on a
    // space: "Anna Maria de Souza" has no reliable seam, and the admin panel is where a staff
    // member can correct a name if it ever matters.
    contactFirstName: input.contactName,
    contactLastName: null,
    email: input.email,
    phone: input.phone ?? null,
    monthlyVolumeBand: input.monthlyVolumeBand,
    // An empty selection is stored as NULL rather than `[]`, so "chose nothing" and "chose
    // nothing yet" are not two different shapes for the admin list to handle.
    categoriesOfInterest:
      input.categoriesOfInterest === undefined || input.categoriesOfInterest.length === 0
        ? null
        : input.categoriesOfInterest,
    notes: input.notes ?? null,
    submittedIp: context.ip,
  });

  return { stored: true };
}
