# Launch checklist

**Date:** 2026-11-22
**Scope:** the launch gates in the marketing checklist. This document records
evidence, not intentions. A box is checked only when the evidence exists in this
repository or was produced by a command in this session.

| Gate | Status | Evidence and remaining work |
| --- | --- | --- |
| Backups verified | **Check ready; production blocked** | `runBackupVerification` inventories storage, re-reads sampled attachments, records the database inventory and writes and verifies a manifest. `bun run backups:verify` runs the same check by hand. On 2026-11-22 it exited 0 with `database=ok`, `storage=ok`, `manifest=ok`, `recorded=true`; the configured database now has all 87 journal migrations applied and the `backup_verifications` table exists. The 2026-11-04 local dump/restore drill used 35 migrations. The provider PITR restore has still never been exercised. |
| Alerts on | **Not verified** | `ALERT_WEBHOOK_URL` and `ERROR_WEBHOOK_URL` are both unset in this workspace; `bun run alerts:test` exits 1 with the configuration message. The scheduled `evaluate_alerts` job defines seven transition-only rules behind `ALERT_WEBHOOK_URL`, falling back to `ERROR_WEBHOOK_URL`. There is no delivery receipt, timestamp or on-call destination. A connected Sentry account exists, but the MCP session required sign-in and no Herald project or alert rule was visible; that is not evidence of production alerting. |
| Support inbox staffed | **Not verified** | `/open-source` publishes `support@herald.app`. No roster, response window, holiday backup or coverage record exists in the repository. Do not publish that page to production until the alias is monitored. |
| Docs published | **Public index built; help serves locally** | `/docs` is a static marketing route; `bun run build` lists it and the local production server returned `200` with `<title>Docs · Herald</title>`. It links the help center, API reference, changelog, status and trust. `/p/herald/herald/docs/api` and `/p/herald/herald/help` both returned `200` after the schema repair. `docs/help/` contains eight articles and `bun run db:import-help` imports them; a production deployment is still required before this gate is public. |
| Status page live | **Live locally; public blocked** | The local production server returned `200` for `/status` and `/api/health`; the page derives its components from live database, storage, queue, email and backup checks. No production origin exists, so the public URL is not live. |
| Demo video and interactive demo | **Done locally** | `/demo` links to Herald's real board, roadmap and changelog, and embeds the 29-second VP9 walkthrough at `public/demo/herald-demo.webm` (1280×800, 30 fps, 560,417 bytes). Frame samples cover the demo page, board, request detail, roadmap and changelog. The recording is not captioned or reviewed on a phone. |
| Status and trust linked from footer and pricing | **Done** | `MarketingFooter` links `/status`, `/trust` and `/docs`; the landing footer and `/pricing` link the same public surfaces. |
| Signup funnel analytics + privacy review | **Done** | Five server-side stages in `signup_funnel_events`, aggregate CLI, 400-day pruning and `docs/signup-funnel-privacy.md`. |
| Onboarding email sequence | **Done in code; provider not configured locally** | Four milestones, 20-hour pacing, unique ledger and account opt-out. `RESEND_API_KEY`/`EMAIL_FROM` are not set in this workspace, so no live send was possible. |
| Discount program decided | **Done** | Open-source maintainer discount, manual fulfilment, recorded in `docs/discount-program.md`; public terms at `/open-source`. |

## Verification run in this session

- `bun run typecheck` — exit 0.
- `bun run lint` — exit 0, 0 errors and 13 pre-existing warnings.
- `bun run build` — exit 0; `/docs` appears as a static route and the bundle
  budget passed.
- Local production server (`bun run start`, ephemeral loopback port) — `/docs`
  `200`, `/status` `200`, `/api/health` `200`,
  `/p/herald/herald/docs/api` `200`, `/p/herald/herald/help` `200`, and
  `/api/health?scope=readiness` `200`. The configured database now reports all
  87 journal migrations applied.
- `bun run alerts:test` — exit 1. Neither `ALERT_WEBHOOK_URL` nor
  `ERROR_WEBHOOK_URL` is set, so no synthetic alert was sent.
- `bun run backups:verify` — exit 0. `database=ok`, `storage=ok`,
  `manifest=ok`, `recorded=true`; the check inspected 3 objects / 1,058 bytes
  and wrote a manifest. This is not a PITR restore drill.
- The configured database was missing migrations 0077–0085 even though 0086 had
  already been applied, so `drizzle-kit migrate` could not fill the gap by
  timestamp. The nine files were applied in one transaction with their SHA-256
  hashes recorded in `public.drizzle_migrations`; the onboarding query then
  returned normally. `bun run db:migrate` exited 0 and reported no pending work.

## What still blocks a launch

1. **Production PITR restore test.** Create a disposable branch from the
   production database, restore the latest backup, point staging at it and verify
   sign-in, a public board, a submission, a conversation, an attachment and the
   latest migration. Record the restore time and migration tag in
   `docs/operations.md`. Rerun the local dump/restore drill against the current
   87-migration schema; the 2026-11-04 drill is stale.
2. **Alert test.** Configure `ALERT_WEBHOOK_URL` (and `ERROR_WEBHOOK_URL` for
   individual errors), run `bun run alerts:test`, confirm the synthetic message
   arrives in the on-call channel and record the timestamp and destination. Then
   point an external uptime monitor at `/api/health` and one public board.
3. **Support coverage.** Name the people monitoring `support@herald.app`, the
   hours they cover and the backup for holidays. Remove the public email or add
   an auto-acknowledgement if coverage is not ready.
4. **Publish and verify production.** Deploy the current schema and re-test
   `/docs`, the product help route, `/status` and the footer links on the
   production origin. The schema repair is complete locally. The docs decision
   is resolved: `/docs` is the public index; the per-workspace help and API pages
   remain the source content.

Do not mark the launch checklist complete while any of the first three items is
open. The docs and status routes are code-complete and locally reachable, but
they are not production-verified until a deployment exists.
