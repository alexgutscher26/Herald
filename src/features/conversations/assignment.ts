/**
 * Workload-based conversation assignment.
 *
 * Round-robin is implemented as least-loaded rather than a cursor: the inbox
 * already knows how many active threads each operator owns, so the choice
 * survives restarts without another table to keep in sync. Ties go to the
 * operator seen most recently, then to name for a stable order.
 */

export type AssignmentCandidate = {
  id: string;
  name: string;
  active: number;
  /** Epoch milliseconds from the operator heartbeat, or null. */
  lastSeenAt: number | null;
};

export function pickLeastLoaded(
  candidates: readonly AssignmentCandidate[],
): AssignmentCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.active !== b.active) return a.active - b.active;
    const seen = (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);
    if (seen !== 0) return seen;
    return a.name.localeCompare(b.name);
  })[0]!;
}
