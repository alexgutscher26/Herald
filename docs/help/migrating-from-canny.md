---
title: Migrating from Canny
slug: migrating-from-canny
collection: Migrating to Herald
---

Canny exports CSV, and Herald has a Canny-specific mapping preset, so most
columns are recognised before you touch them. The import creates requests and
vote totals; it does not copy Canny's settings, comment threads or user
accounts.

## Before you start

Decide which Herald product should receive the data. One Canny board usually
maps to one Herald product; if you have several Canny boards that share a
customer audience, they can still import into one product and become separate
Herald boards.

Create the product first. You need `settings:manage` on the workspace to open
**Import**.

## Export from Canny

1. Open Canny's admin area and export the posts for each board as CSV.
2. Keep the header row. The file should include at least `Title` and
   `Details`; `Board`, `Status`, `Vote count`, `Author`, `Created`, `Category`
   and a cover-image column are used when present.
3. Do not re-save the file in a spreadsheet if it contains multi-line
   descriptions. Spreadsheet apps can rewrite quotes and line breaks; the
   importer handles RFC 4180 quoting, but a round-tripped file loses it.

## Import into Herald

1. Open **Import** for the product: `/app/{workspace}/{product}/import`.
2. Upload the CSV. Herald detects Canny from the headers (`Vote count`,
   `Details`, `Author`, `Created`) and proposes a column mapping.
3. Check the mapping. A mapping needs a **Title**. Leave a field unmapped
   rather than pointing it at a column that means something else.
4. Run the dry run. It reports how many rows would import, fail or be skipped
   without writing anything. Fix the mapping before starting if the failure
   count is unexpected.
5. Start the import. It runs as a background job in bounded batches, so you
   can leave the page; the import detail polls the same product-scoped route
   for progress.
6. Read the row report. A row that failed keeps its error text; a row that
   imported with a warning keeps the warning and the original status word.

The board column must match a board that already exists in the product, by
name or by its public URL path. Create the boards before importing; an
unmatched board fails that row with its name and the row report lists it.
When the column is empty, the import uses the fallback board you selected.
A status word the importer does not recognise imports as **Open** and is
recorded in the row report, so nothing is silently discarded.

## How Canny values map

| Canny status | Herald status |
| --- | --- |
| Open, New, Idea, Submitted | Open |
| Under review, Reviewing, Under consideration | Under review |
| Planned, Planning, Accepted, Next | Planned |
| In progress, Started, Building | In progress |
| Complete, Completed, Done, Shipped, Released, Live | Shipped |
| Closed, Declined, Won't do, Not planned, Archived, Duplicate | Closed |

Vote counts are preserved as imported totals; Herald does not invent voter
accounts for them. A new vote added in Herald after the import counts once and
is separate from the imported total. Author name and email are used to
resolve or create a customer; without an email the request still imports but
cannot send the author a notification.

Created dates are preserved when parseable. An unparseable date uses the
import time and is reported on the row.

## What is not copied

- Comment threads, internal notes and Canny's moderation history.
- Canny user accounts, sessions, segments and notification preferences.
- Boards, statuses, tags and roadmap settings as configuration. Boards are
  created by name; statuses are translated into Herald's vocabulary.
- Custom fields. Put anything you need to keep into the description before
  exporting, or keep Canny read-only until the migration is signed off.

Replaying the same import does not process a row twice. Uploading the same
file again as a **new** import creates new requests, so use the row report
rather than re-uploading to fix a handful of rows.

## After the import

1. Confirm each board's visibility. The import matches existing boards and does
   not change whether they are public.
2. Review the status mapping on a sample of requests, then publish the roadmap
   columns customers should see.
3. Add tags and merge duplicates. Merged requests keep their public
   canonical target and their votes move to the surviving request.
4. Keep Canny read-only for a week. If a customer submits there out of habit,
   reply with the new portal URL instead of running the import again.
