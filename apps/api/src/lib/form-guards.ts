/**
 * The two cheap checks every public form in the storefront carries.
 *
 * A hidden field a person never sees and never fills, and the time the form was rendered.
 * Neither is a CAPTCHA and neither is meant to be: they cost a real customer nothing - no puzzle,
 * no third-party script, no accessibility cliff - and they stop the volume of undirected form
 * spam that makes an inbox useless. Anything targeted at this site specifically will walk past
 * both, which is what the rate limit on each route is for.
 *
 * Shared by the Help page's message and the wholesale enquiry, because two copies of "three
 * seconds is not a reading speed" would eventually disagree about the number.
 */

/** Below this, nobody read the form. */
const MINIMUM_FILL_SECONDS = 3;

export interface GuardedSubmission {
  /** The honeypot. Absent or empty means a browser left it alone. */
  website?: string | undefined;
  /** `Date.now()` from when the form rendered. */
  formRenderedAt: number;
}

export function looksAutomated(input: GuardedSubmission, now = Date.now()): boolean {
  if (input.website !== undefined && input.website.length > 0) return true;
  const elapsedSeconds = (now - input.formRenderedAt) / 1000;
  // A negative age means the timestamp was tampered with, which is not something a browser does.
  return elapsedSeconds < MINIMUM_FILL_SECONDS;
}
