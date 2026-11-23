/**
 * One readable line for an audit entry's structured detail.
 *
 * Shared by the settings table and the CSV export so the two never disagree
 * about what an entry says. The mapping is intentionally small: an action that
 * records no detail still shows its stored metadata rather than a bare dash,
 * which keeps new actions useful without an edit here.
 */

export type AuditMetadata = Record<string, string | number | boolean | null>;

export type AuditDetailEntry = {
  action: string;
  metadata: AuditMetadata | null;
};

export function auditDetail(entry: AuditDetailEntry): string {
  const meta = entry.metadata;
  if (!meta) return "—";

  if (entry.action === "member.role_changed") {
    const parts = [
      typeof meta.memberEmail === "string" ? meta.memberEmail : "member",
      `${String(meta.previousRole ?? "?")} → ${String(meta.role ?? "?")}`,
    ];
    if (typeof meta.source === "string") parts.push(`via ${meta.source}`);
    if (typeof meta.tokensRevoked === "number" && meta.tokensRevoked > 0) {
      parts.push(`${meta.tokensRevoked} token${meta.tokensRevoked === 1 ? "" : "s"} revoked`);
    }
    return parts.join(" · ");
  }

  if (
    entry.action === "member.removed" ||
    entry.action === "member.invited" ||
    entry.action === "member.invitation_resent"
  ) {
    const parts = [
      typeof meta.memberEmail === "string"
        ? meta.memberEmail
        : String(meta.email ?? "member"),
    ];
    if (typeof meta.role === "string") parts.push(meta.role);
    if (meta.sessionsRevoked === true) parts.push("sessions revoked");
    if (typeof meta.tokensRevoked === "number" && meta.tokensRevoked > 0) {
      parts.push(`${meta.tokensRevoked} token${meta.tokensRevoked === 1 ? "" : "s"} revoked`);
    }
    if (typeof meta.reassigned === "string") parts.push(`work ${meta.reassigned}`);
    if (typeof meta.source === "string") parts.push(`via ${meta.source}`);
    return parts.join(" · ");
  }

  if (entry.action.startsWith("workspace.domain_claim")) {
    const parts = [String(meta.domain ?? "domain")];
    if (typeof meta.role === "string") parts.push(`joins as ${meta.role}`);
    return parts.join(" · ");
  }

  return Object.keys(meta)
    .sort()
    .map((key) => `${key}=${String(meta[key])}`)
    .join(" · ");
}
