---
title: Migrating from UserJot
slug: migrating-from-userjot
collection: Migrating to Herald
---

UserJot exports posts as CSV, and Herald imports them with the **Generic**
format. There is no UserJot-specific preset: its column names and status
vocabulary are close enough to map by hand, and a wrong guess is harder to
notice than a manual mapping.

## Export from UserJot

Export each board's posts as CSV. Keep these columns where available:

| Herald field | What to look for |
| --- | --- |
| Title | The post title |
| Body | The post description or content |
| Board | The board name |
| Status | The workflow status |
| Category | Feature request, bug, improvement or question |
| Author | The submitter's name |
| Author email | The submitter's email |
| Votes | The vote or upvote count |
| Created at | The submission date |
| Image URL | A public cover image URL |

If the export has no board column, choose a fallback board in Herald. If it
has no votes column, leave votes unmapped; Herald will not invent a total.

## Import into Herald

1. Open **Import** for the product.
2. Upload the CSV and choose **Generic**.
3. Map the columns. **Title** is the only required field.
4. Run the dry run, fix the mapping if the failed count is surprising, then
   start the import.
5. Read the row report. Unknown status or category words are recorded there,
   not silently dropped.

Create the target boards in Herald first. The mapped board column is matched
by name or public URL path; an unknown name fails the row and is listed in the
report, and the fallback board is used only when the cell is empty. If several
UserJot boards should become one Herald board, point them all at one existing
board before importing or merge the requests afterwards. Merging keeps the
public canonical URL and moves votes to the surviving request.

## Status mapping

| UserJot wording | Herald status |
| --- | --- |
| Open, New, Idea | Open |
| Under review, Reviewing, Considering | Under review |
| Planned, Next, Accepted | Planned |
| In progress, Started, Building | In progress |
| Completed, Done, Shipped, Released | Shipped |
| Closed, Declined, Won't do, Archived | Closed |

An unrecognised word imports as **Open** and keeps its original value in the
report. Rename it in the export or fix the rows in Herald.

## What is not copied

- Comment threads and replies.
- UserJot's users, notification preferences and email settings.
- Roadmap configuration, changelog entries and docs.
- Custom fields, tags and board appearance.

## Moving between Herald workspaces

If the source is another Herald workspace rather than UserJot, do not import a
CSV. Use **Import → another Herald workspace** with an API token from the
source workspace. It fetches boards and requests through the API, preserving
vote totals, statuses and dates, and it never copies dashboard users or API
tokens. The token is used for that fetch only and is not stored.

## After the import

1. Set board visibility and publish the roadmap columns you want public.
2. Sample a few requests and compare them with the source export, including
   the author's email when it existed.
3. Keep the old tool read-only for a transition period, then close it. Running
   both in parallel splits votes and replies across two boards.
