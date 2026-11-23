---
title: Migrating from Nolt
slug: migrating-from-nolt
collection: Migrating to Herald
---

Nolt's export is close to Herald's model: boards contain posts, posts have
votes and a status, and authors are customers. The Nolt preset recognises the
usual columns, and the board column recreates your boards by name.

## Export from Nolt

Export each board as CSV. The Nolt preset prefers:

| Herald field | Preferred Nolt columns |
| --- | --- |
| Title | `Title` |
| Body | `Body`, `Description` |
| Board | `Board` |
| Status | `Status` |
| Category | `Category` |
| Votes | `Votes` |
| Author | `Author`, `Created by` |
| Created at | `Created at`, `Date` |

Keep the header row and the original quoting. If you open the file in a
spreadsheet, export it again rather than saving over it.

## Import into Herald

1. Open **Import** for the product.
2. Upload the CSV. Nolt is detected from `Body`, `Board`, `Votes` and
   `Author`; choose it manually if the file looks generic.
3. Map the columns and run the dry run.
4. Start the import, then read the row report. A row with no title fails;
   everything else imports with a warning when a value cannot be translated.

Nolt often uses several boards for one product. Create a matching Herald
board for each one before importing, then import them into the same product.
The board column matches by name or public URL path; a fallback board is used
only when the cell is empty, and an unmatched name fails the row. If two Nolt
boards should be one Herald board, map both to the same existing board before
importing, or import them separately and merge the requests afterwards.

## Status mapping

| Nolt wording | Herald status |
| --- | --- |
| Open, New, Idea | Open |
| Under review, Reviewing, Considering | Under review |
| Planned, Next, Accepted | Planned |
| In progress, Started, Building | In progress |
| Completed, Done, Shipped, Released | Shipped |
| Closed, Declined, Won't do, Archived | Closed |

An unrecognised status word is imported as **Open** and kept in the row
report. Fix those rows in Herald or rename the status in the export.

## What is not copied

- Comment threads and replies.
- Nolt's user accounts, notification settings and email preferences.
- Board appearance, custom domains and integrations.
- Tags that are not exposed as a mapped column. Add tags in Herald after the
  import; they are not inferred from text.

## After the import

1. Confirm each board's visibility. The import matches existing boards and does
   not change whether they are public.
2. Publish the roadmap columns you want customers to see.
3. Check the vote totals on a few high-demand requests. Imported totals are
   preserved, but they do not create voter rows, so a customer who voted in
   Nolt is not automatically following the request in Herald.
4. Point the old Nolt URL at the new portal, or leave a final post telling
   customers where the board moved. Keep Nolt read-only during the transition
   so the same request is not submitted twice.
