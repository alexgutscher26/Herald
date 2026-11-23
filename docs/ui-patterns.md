# UI patterns

Five shared patterns keep the dashboard, portal and public pages consistent. Use
the component rather than recreating the layout on a new surface.

## Empty states

`src/components/shared/empty-state.tsx` is the only empty-state component. It
always renders an icon (default `Inbox`), a short title, one sentence and at
most one action. There is no status badge or second button.

```tsx
<EmptyState
  icon={MapIcon}
  title="No roadmap requests yet"
  description="Requests appear here as soon as feedback is collected."
  action={<Button asChild><Link href={newRequestHref}>New request</Link></Button>}
/>
```

- A filter result uses the same component; explain the filter in the sentence
  and make the single action "Clear filters".
- Inline hints inside a card, table row or widget panel are not empty states.
  They stay plain text because they do not replace a page or section.
- Page-level surfaces (boards, releases, feedback, roadmap, segments, winback,
  moderation, subscribers, public board/changelog/help/API docs, custom fields
  and the delivery log) use the shared component.

## Loading

`src/components/shared/page-skeleton.tsx` owns page loading. The blocks mirror
the page header, toolbar and content rows so the real content does not move the
page when it arrives. Variants: `list` (tables and inboxes), `cards` (overview
and settings grids) and `form` (editors).

Route-level `loading.tsx` files choose a variant and render inside the existing
shell:

- `src/app/(dashboard)/loading.tsx` — shell-level fallback, `cards`
- `src/app/(dashboard)/app/[workspaceSlug]/[productSlug]/loading.tsx` — `list`
- `src/app/(dashboard)/app/[workspaceSlug]/loading.tsx` — `form`

Do not add a page spinner. Local asynchronous buttons (refresh, verify, AI
draft) may keep their inline spinner because they are not page loads.

## Errors

`src/components/shared/error-state.tsx` is the only page error panel. It shows
what happened, a **Try again** action when retrying can help, a **Contact
support** link and an optional status link. It never renders a stack trace,
driver message or request payload.

`src/lib/support-link.ts` builds the support URL:

- `/app/{workspace}/{product}/...` and `/p/{workspace}/{product}/...` become
  `/p/{workspace}/{product}/support?subject=…&body=…`
- other routes fall back to `mailto:support@herald.app` with the same prefill

The body carries only the path, time and Next.js error digest. Error messages
are deliberately excluded so tenant data cannot leak into a message. The portal
support page reads `subject` and `body` and seeds `PortalSupportForm`.

Error boundaries using it: root (`src/app/error.tsx`), dashboard
(`src/app/(dashboard)/error.tsx`) and the public portal
(`src/app/p/[workspaceSlug]/[productSlug]/error.tsx`). A 403 uses the same panel
without retry, with a link back to the workspace overview and a support body
that says access is needed. The last-resort `src/app/global-error.tsx` keeps the
same retry/support/status actions with inline styles because the root layout may
have failed before the stylesheet loaded.

## Destructive actions

There are three cases, not one dialog everywhere:

1. **Workspace-level** (delete or transfer the workspace): typed confirmation.
   The workspace settings forms require the workspace name and the server
   actions re-check `confirmName`.
2. **Reversible non-workspace** (archive/restore a board, custom field or
   release; enable/disable a topic): perform the action immediately and offer
   **Undo** with `toastUndoable` from
   `src/components/shared/action-toast.ts` for eight seconds.
3. **Irreversible non-workspace** (delete content, merge requests, stop or send
   a campaign, pause a webhook, delete an account): use `ConfirmDialog` from
   `src/components/shared/confirm-dialog.tsx` with a normal confirmation. The
   dialog also supports `confirmText` for a workspace-level caller, but no other
   surface should use it.

`window.confirm` is not used. Account deletion requires the password and the
shared dialog; the server action keeps its literal `DELETE` guard, but the UI
does not ask people to type it because typed confirmation is reserved for
workspace-level actions.

## Toasts

- **No success toast for a change already on screen.** Saving a settings form,
  toggling a switch, changing a status, deleting a row or renaming a record is
  visible in the refreshed UI. The toast is noise.
- Keep a toast when the result is not visible: copied text, a test email, a
  queued campaign, an import summary, an issue created in another system, an
  out-of-view side effect.
- A reversible destructive action uses the Undo toast instead of a success
  toast. The Undo toast is the affordance, not a second confirmation.
- Failures always route through `toastActionFailure` or the surface's error
  state; do not swallow an error because the success toast was removed.

## Verification

- `tests/support-link.test.ts` covers product/portal routing, the mail fallback,
  encoding and the no-error-text guarantee.
- `tests/ui-patterns.test.tsx` renders the shared empty/loading components,
  checks every route `loading.tsx` and `error.tsx`, checks that no `EmptyState`
  still passes the removed badge prop, and checks the account/workspace typed
  confirmation split.
