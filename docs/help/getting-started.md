---
title: Getting started: workspace to first widget install
slug: getting-started
collection: Getting started
---

This is the shortest path from an empty account to a working customer loop:
a workspace, a board, one published release and the widget on your site.
Every step below is a real dashboard screen, and the setup checklist on the
overview reads the same database state, so it will tick itself off as you go.

## 1. Create the workspace and product

Sign up, then create a workspace. A workspace is the billing and team
boundary: members, plan, custom domain and audit log live there.

Inside it, create a **product**. A product owns its own boards, roadmap and
changelog, so create one per thing you ship rather than one per company.
Creating the product also creates its first feedback board, so there is no
separate "add board" step before you can accept a request.

If you run several products, switch between them from the product menu. Data
never crosses the boundary: a request, customer or API token resolved for one
product cannot read another.

## 2. Shape the board

Open **Boards** and choose the board that was created for you. Set:

- **Name and slug** — the slug is the public URL segment.
- **Visibility** — public boards appear on your portal; private boards are
  for your team and require a plan that includes them.
- **Guest posting** — whether a signed-out visitor may submit. Votes and
  comments still require a customer session, and every public write is
  rate-limited.
- **Description** — one sentence about what belongs here.

Statuses are not per board: a request's status is also its roadmap column.
Move it to Planned, In progress or Shipped and the public roadmap follows. A
status change also starts the customer notification path, so decide your
status vocabulary before you invite customers.

## 3. Write and publish the first release

Open **Releases → New**. Write the title, summary and body, and link the
requests the release addresses. Linking is what closes the loop: when the
release publishes, those requests move to Shipped and their followers are
notified.

Choose the channels deliberately:

- **Public changelog** — the entry appears on your portal and in RSS.
- **In-app widget** — customers see it in the widget's updates panel.
- **Subscriber email** — the announcement is queued for subscribers who have
  not unsubscribed. This is the only channel that sends mail.

Publish now or schedule it. Scheduled releases are published by the
`/api/cron/publish-releases` endpoint, so a scheduler must be running for the
time to take effect. Publishing is recorded in the release's revision
history; an edit after publishing is a new revision, not a silent overwrite.

## 4. Install the widget

Open **Widget**. Before copying the snippet:

1. Enable at least one public surface (feedback, roadmap or changelog).
2. Copy the public key shown on the page. Once widget settings exist, a
   missing or stale key renders the 404 page instead of a panel.
3. Add every origin you embed from under **Allowed origins**, for example
   `https://app.example.com`. An empty list keeps the widget open to any
   origin; an entry is an exact scheme, host and port with no wildcards.

Paste the snippet before `</body>`. The loader is one async script tagged
`data-project`, `data-key`, `data-position` and `data-theme`; there is no
build step and no inline bootstrap. Then use the installation check on the
Widget page.

The full snippet, React/Next.js/Vue/Svelte/Astro recipes, Content-Security-
Policy directives and troubleshooting are in
[Install the widget](install-the-widget).

## What "done" looks like

The overview checklist turns green when the product has a description, a
published release, a saved widget domain, a complete sender identity and a
second workspace member. Those five checks are read from PostgreSQL on every
request; clicking a checkbox is not part of the product.

A healthy first week looks like this:

- one public surface is live and linked from your site;
- a real request has arrived, been triaged and replied to;
- a release names the request and moved it to Shipped;
- the subscriber who followed it received one email, not a duplicate.

## Where to go next

- **Inbox** for customer conversations, including email and the widget.
- **Roadmap** to publish the columns customers should see.
- **Import** to bring requests from another tool; start with the matching
  migration guide so the status mapping is not guesswork.
- **Settings → Sender identity** before any subscriber email or campaign. A
  deployment-wide `EMAIL_FROM` is not enough for a win-back campaign.
