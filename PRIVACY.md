# Privacy policy — Backlink Atlas

Last updated: 2 September 2026

This app reads the text of your Confluence pages. That is a bigger claim than
most monitoring apps make, so this document starts with it rather than burying
it, and then says exactly what happens to what it reads.

## The short version

To know what links to a page, something has to read the pages that might link
to it. Confluence's API has no reverse index — there is no call that answers
"what points here" — so this app builds one by reading each page's stored
markup and extracting the links from it.

**It reads the words. It does not keep them.** What is written to storage is
the connections: this page id links to that page id, at that heading, and
whether the link still lands. The prose, the tables, the images, the comments
and the attachments are read, used to find links, and discarded within the same
function call.

Nothing is sent anywhere. The app declares no external permissions, so the
Forge platform would refuse an outbound call even if the code attempted one.

## What the app can access

| | |
|---|---|
| `read:page:confluence` | Page content, in Confluence's storage format. This is what carries the links. |
| `read:space:confluence` | Space keys and names, so a finding can say which space it is in. Confluence's page API names a space only by a numeric id. |
| `read:content.permission:confluence` | Whether a given person may read a given page. Asked of Confluence before any row is shown to anyone. Nothing is read about the page or the person beyond yes or no. |
| `read:confluence-user` | Whether the person pressing "rebuild the index" administers this site. Asked about that person only, at the moment they press it, and never stored. |
| `storage:app` | The index, held in Forge storage inside your Atlassian environment. |

The two permission scopes are there to take things away, not to gather them:
without the first, the app could not tell whether you are allowed to see a
result, and would have to either show you everything or nothing.

It asks for nothing else. In particular it does not ask for
`read:attachment:confluence`, which is why links to attachments are listed as
unchecked rather than judged.

## What is stored

Two kinds of record, and this is the complete list of fields.

**For each page:** its id, its title, the folded form of its title used for
matching, its version number, its space key, the number of pages linking to it,
the number of links on it, how many of those do not land, when it was last
indexed, and the text of its headings.

Headings are stored because a link can point at one, and a link to a heading
that has been renamed breaks silently — no error, no redirect. Checking that is
only possible with a list of the headings that exist. Headings are titles of
sections, not content; if a page has more than 300 the list is dropped and the
app reports that it cannot check that page's anchors, rather than storing more.

**For each link:** the id, title and space of the page it is on, a short hash
that tells this link apart from the others on the same page, a reference to
what it points at, the target's title and space as the link named them, the
heading it points at if any, what kind of link it is, whether it lands and the
sentence explaining why, how many times it appears, and when it was last seen.

**Page and link text is not stored.** The repository's security audit enforces
this: it builds a page record from a page whose every field is filled with
marker text, and fails if any of it reaches the record, or if a new field
appears that this policy does not list. So this section cannot quietly go out
of date.

## What is not stored

- The body of any page.
- Comments, attachments, or their contents.
- Who wrote or edited anything. The app never reads author fields.
- Any personal data. It holds no names, no email addresses, no account ids.

## Who can see what

The index is built with the app's own permissions, so it knows about every page
on the site — including pages you cannot open.

Nothing from it is shown to you until Confluence has confirmed, as you, that you
may see it. Every report asks Confluence which of the pages involved you have
access to, and shows only those. Where results are removed, the number removed
is stated — "4 pages link here, and 2 more you do not have access to" — because
silently showing four would be misleading and showing six would be the leak.

The app does not model Confluence's permissions. It asks Confluence and accepts
the answer. When that question cannot be answered, the row is hidden: a failure
to answer is not permission.

## Logs

Forge writes application logs, which your site administrators and the app's
developer can read. The app does not write page titles, page content or user
identifiers into them. What it logs is counts and error messages.

## Where the data lives

In Forge's hosted storage, inside Atlassian's cloud, in the region your
Atlassian site is in. The app has no server, no database and no infrastructure
of its own. There is nowhere else for the data to be.

## Retention and deletion

The index is kept until it is replaced by the next sweep, or until the app is
uninstalled. Uninstalling removes the app's storage.

Deleting a page removes it and its links from the index at the next nightly
sweep, which is when the app next sees the site whole.

## Sub-processors

None. The app uses no analytics, no error reporting service, no content
delivery network and no AI service. It has no way to reach any of them.

## Changes

Changes are published in the public repository with their date, and material
ones are noted in the release notes. Because the audit checks this document
against the code, a change to what is stored cannot ship without a change here.

## Contact

Raise an issue in the public repository, or use the support contact on the
Marketplace listing.
