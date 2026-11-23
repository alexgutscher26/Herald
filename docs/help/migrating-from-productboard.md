---
title: Migrating from Productboard
slug: migrating-from-productboard
collection: Migrating to Herald
---

Productboard is organised around features, components, products and notes.
Herald imports **requests**: one customer-facing item with a title, body,
board, status, category and vote total. A Productboard CSV export is a good
fit for the feature list, not for the research notes behind it.

## Choose what to bring

Productboard's hierarchy does not map one-to-one. A practical split is:

- one Herald product for the thing customers buy;
- one Herald board per Productboard product or component you want customers to
  browse;
- one Herald request per Productboard feature that customers can recognise.

Internal-only features, objectives and notes should stay in Productboard until
you decide they are worth publishing. Importing them creates public surface
area you then have to hide.

## Export from Productboard

Export the feature list as CSV. Herald's Productboard preset recognises:

| Herald field | Preferred Productboard columns |
| --- | --- |
| Title | `Name`, `Feature` |
| Body | `Description` |
| Board | `Product`, `Component` |
| Status | `Status` |
| Category | `Type` |
| Author | `Owner`, `Created by` |
| Votes | `Votes`, `User impact` |
| Created at | `Created at`, `Created` |

Two warnings:

- **`Owner` is usually an internal owner, not the customer who asked.** Map
  `Created by` to the author when it exists; otherwise leave the author
  unmapped. Importing a teammate as the requester creates customer records
  that will never receive a notification and pollute the demand count.
- **`User impact` is not a vote count.** If the column is a score rather than
  a number of customers, leave votes unmapped. Herald preserves imported vote
  totals as given; a made-up total is worse than zero.

## Import into Herald

1. Open **Import** for the product.
2. Upload the CSV. Productboard is detected from `User impact`, `Owner`,
   `Description` and `Component` headers; if detection stays generic, choose
   **Productboard** manually.
3. Map the fields, then run the dry run. Expect a high failure count only if
   `Name` is missing on many rows; that is the one required field.
4. Start the import and read the row report. Failed rows keep their error;
   warnings keep the original value that could not be translated.

Boards are matched by name or public URL path against boards that already
exist. Create them before importing; a name that does not match fails the row
and is listed in the report. If you export a single component at a time,
choose one fallback board and map the board column away so every row lands
in it.

## Status mapping

Productboard status names are workspace-specific. The importer translates the
common words:

| Productboard wording | Herald status |
| --- | --- |
| New, Idea, Open, Submitted | Open |
| Under review, Considering, Reviewing | Under review |
| Planned, Next, Accepted, Planning | Planned |
| In progress, Building, In development | In progress |
| Shipped, Done, Complete, Released | Shipped |
| Closed, Declined, Won't do, Archived, Rejected | Closed |

A custom status word imports as **Open** and is listed in the row report.
Either rename the status in the export or fix the affected rows in Herald
afterwards.

## What is not copied

- Productboard notes, insights, customer feedback linked to features, and
  their dates.
- Objectives, key results, releases and roadmap views.
- Custom fields and scoring. Fold anything you need into the description
  before exporting.
- Comment threads and internal discussion.

## After the import

Set each board's visibility, review a sample of requests, and link the
requests you are already working on to the right releases. Productboard can
stay the internal planning tool while Herald becomes the customer-facing
surface; the two do not need to be synced.
