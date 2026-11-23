# Trust pack

Public procurement pages and the facts behind them.

| Page | Route | Source |
| --- | --- | --- |
| Security and trust | `/trust` | `src/app/trust/page.tsx` |
| Data Processing Agreement | `/legal/dpa` | `src/app/legal/dpa/page.tsx` |
| Sub-processors | `/legal/subprocessors` | `src/app/legal/subprocessors/page.tsx` |
| Data residency | `/legal/data-residency` | `src/app/legal/data-residency/page.tsx` |

All copy and provider data live in `src/features/trust/content.ts`; the pages are
server-rendered and need no account. `tests/trust.test.ts` checks that the
required sections, providers and honest SOC 2 wording are present.

## Rules for editing

1. **Never claim a certification that has not been issued.** SOC 2 is
   explicitly not held. A report is commissioned only when a signed deal
   requires it.
2. **Keep the sub-processor list factual.** The list names Vercel, Neon, Resend,
   Stripe, optional Slack and the operator-configured AI provider. A deployment
   that substitutes any of these must update `SUBPROCESSORS` before publishing.
3. **Separate core from optional.** Optional providers only process data when a
   workspace connects them; the table shows that.
4. **Residency describes the deployment, not an aspiration.** Primary storage
   follows the database region; email, billing and integrations can process in
   the United States. Do not add a regional guarantee unless it is in the order
   form and the infrastructure actually supports it.
5. **Update `TRUST_LAST_UPDATED`** whenever the content changes. Every page
   displays it.

## Contact addresses

`SECURITY_CONTACT` and `PRIVACY_CONTACT` are in the content module. Replace
them with monitored inboxes before publishing a production trust page.
