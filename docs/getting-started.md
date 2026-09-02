# Getting started

## Install it

From the Atlassian Marketplace, on any Confluence Cloud site you administer.
It asks for three permissions, and none of them lets it change anything:

| | |
|---|---|
| `read:page:confluence` | Page text. This is what carries the links. |
| `read:space:confluence` | Space keys, so a finding can say which space it is in. |
| `storage:app` | The index, held inside your Atlassian environment. |

## Build the index

Nothing works until the index exists, and the app says so plainly rather than
showing you empty reports.

Go to **Settings → Apps → Backlink Atlas** and press **Rebuild the index now**.

The first build reads every page on the site. On a small site that is a few
minutes; on a large one it can be an hour or more. It runs in the background as
a chain of small steps, so you can close the page — nothing is lost, and the
status shows how far it has got.

After that it rebuilds itself nightly, and re-reads any page you edit
immediately.

## What links here

Two places, and you do not have to choose.

**In the byline**, under the page title, a count appears: "6 backlinks". It is
there on every page, without editing anything.

**As a macro**, if you want the list on the page itself. Edit the page, type
`/Backlinks`, and insert it. It lists every page that links to the one it is on.

Both show only the pages you are allowed to open. If some are hidden you are
told how many — "6 pages link here, and 2 more you do not have access to" —
rather than being quietly given a smaller number.

## Link health for a space

In a space, open **Link health** from the space menu.

**Links that no longer land.** Three kinds, told apart because the fix is
different for each:

- *Points at a page that is not there.* The page was renamed, moved, or
  deleted.
- *Points at a heading that is gone.* The page is fine; the heading it pointed
  at has been renamed. This is the one nothing else reports — the link still
  opens the page and drops the reader at the top of it, with no error.
- *Points at a title more than one page carries.* Which page opens is up to
  Confluence, and it may not be the one that was meant.

Each says which page carries the broken link, so you know where to go.

**Pages nothing links to.** Reachable through the tree, but from no page's
text. Normal for a space homepage. For anything else it usually means the page
was orphaned by a reorganisation, and nobody will find it.

## Before you rename or delete a page

This is what the app is for. Open the page, look at the backlink count, and you
know what you are about to break. If it says nothing links here, it is safe.

## What it will not tell you

**Links to other websites are not checked.** They are recorded and shown as
external. The app declares no external permissions, so it cannot reach the
internet at all — it has no way to know whether an outside address still
answers, and it does not pretend to.

**Attachments are not checked.** The app does not ask for permission to read
them, so a link to one is listed as unchecked rather than judged.

**A rename is not caught instantly.** Editing a page updates that page's links
at once. But renaming a page can break links on other pages, ones nobody
touched, and those are found by the nightly sweep. Every report says when the
index was last rebuilt, so you can see how current the answer is.

## If the numbers look wrong

**Everything is empty.** The index has not been built. The settings page says
so; press Rebuild.

**A page you know links here is missing.** Either the index has not caught up —
check the last rebuild time — or you do not have access to that page, in which
case it is counted in the withheld number instead.

**A link is called broken and it works.** That is a bug worth reporting, and it
is treated as a serious one: a report that cries wolf gets ignored, and then the
genuinely broken links never get fixed. Raise an issue with the page and the
link.

**The sweep says it failed.** The message says what Confluence returned. Press
Rebuild to start again; a failed sweep leaves the previous index in place rather
than a half-built one.

## Removing it

Uninstall from **Settings → Apps**. That deletes the index. Your pages and their
links are untouched — the app never wrote to them.
