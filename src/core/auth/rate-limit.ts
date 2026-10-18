export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL_IP = 5;
export const MAX_FAILURES_PER_EMAIL = 20;

export interface Attempt {
  success: boolean;
  at: Date;
}

const inWindow = (a: Attempt, now: Date) => now.getTime() - a.at.getTime() < WINDOW_MS;

/**
 * Attempts for ONE email+IP. Blocked when the latest unbroken run of failures inside the
 * window reaches 5. A success ends the run, so typos before a good login don't count later.
 */
export function isRateLimited(attempts: Attempt[], now: Date): boolean {
  const newestFirst = [...attempts].sort((a, b) => b.at.getTime() - a.at.getTime());
  let failures = 0;
  for (const a of newestFirst) {
    if (!inWindow(a, now) || a.success) break;
    failures++;
  }
  return failures >= MAX_FAILURES_PER_EMAIL_IP;
}

/** Attempts for ONE email from any IP. Blocked at 20 failures inside the window. */
export function isEmailCapped(attempts: Attempt[], now: Date): boolean {
  const failures = attempts.filter((a) => !a.success && inWindow(a, now)).length;
  return failures >= MAX_FAILURES_PER_EMAIL;
}
