---
title: Migrating from Featurebase
slug: migrating-from-featurebase
collection: Migrating to Herald
---

Herald does not ship a Featurebase-specific adapter. Its CSV export is still
a normal CSV: import it with the **Generic** format and map the columns
yourself. That is deliberate — guessing a column called `Name` or `Status`
from a competitor's export can silently put the wrong data in a field.

## Export from Featurebase

Export the posts for each board as CSV. Featurebase's column names vary by
export version, so open the file and identify which column holds each of
these:

| Herald field | What to look for |
| --- | --- |
| Title | The post title, often `Title` or `Name` |
| Body | The description or content column |
| Board | The board name, if the export includes it |
| Status | The post's status or workflow state |
| Category | Feature request, bug, improvement or question |
| Author | The submitter's name |
| Author email | The submitter's email, if present |
| Votes | The upvote count, not a priority score |
| Created at | The submission date |
| Image URL | A public cover image, if the export exposes one |

If the export omits votes or author email, leave those fields unmapped. A
request without an author still imports; it just cannot notify anyone. A vote
total that is really a priority score is worse than no total.

## Import into Herald

1. Open **Import** for the product.
2. Upload the CSV and choose **Generic** if detection does not pick a
   dedicated format.
3. Map each field to the column you identified. **Title** is required.
4. Run the dry run. It reports importable, failed and skipped rows without
   writing; adjust the mapping and run it again.
5. Start the import and read the row report.

Create the target boards in Herald before importing. The mapped board column
is matched by name or public URL path; an unmatched name fails that row and is
listed in the report. Your fallback board is used only when the cell is empty.
Status and category words are translated with the shared vocabulary:

| Wording | Herald status |
| --- | --- |
| Open, New, Idea | Open |
| Under review, Reviewing | Under review |
| Planned, Next | Planned |
| In progress, Building | In progress |
| Complete, Done, Shipped, Released | Shipped |
| Closed, Declined, Won't do, Archived | Closed |

An unknown word imports as **Open** and is listed on the row. Category values
map to feature request, bug, improvement or question; an unknown category
uses Herald's default rather than failing the row.

## What is not copied

- Comment threads and replies.
- Featurebase docs, help-center articles and changelog entries. Those are
  different products; export and recreate them rather than mixing them into
  feedback.
- User accounts, segments, survey responses and notification preferences.
- Custom fields and board appearance.

## After the import

Publish only the boards you want customers to browse, then check a sample of
requests against the source export. If you need a repeatable sync rather than
a one-time move, use the Herald API or a CSV produced from Featurebase's API
on a schedule; do not re-upload the whole export, which creates a second copy
of every request.
