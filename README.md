# Backlink Atlas

**What links to this page, and which links no longer land.**

Confluence cannot tell you what points at a page. There is no call in its REST
API that answers it — no `inbound`, no `backlinks`, nothing. The request for one
has been open on Atlassian's public tracker since 2014, with 629 votes, in
"Gathering Interest".

This app builds the reverse index Confluence does not keep.

## What it answers

**What links here.** A panel on the page, and a count in the byline, listing
every page that points at this one. The thing you want before you rename
something, move it, or delete it.

**Which links no longer land.** Not only links to deleted pages — also links to
a *heading* that has been renamed. Those break silently: no error, no redirect,
the reader is just dropped at the top of a long page and never told. Nothing in
Confluence reports them.

**What nothing links to.** Pages reachable from the tree but from no page's
text. Often fine for a space homepage. Usually a sign for anything else.

## What it does not do

- **It does not check links off your site.** They are recorded and shown as
  external, never reported as broken. Checking them would mean calling out to
  the internet; this app declares no external permissions at all, which is a
  promise the platform enforces rather than one you have to trust.
- **It does not check attachments.** It does not ask for permission to read
  them, so it says "unchecked" instead of guessing.
- **It does not write to Confluence.** There is no scope in the manifest that
  would let it, and no code that tries.

## What it reads

Page text — that is how links are found. It does not keep it. What is stored is
the graph: this page links to that page, at that heading, and whether it lands.
The full list of stored fields, and the audit check that keeps that list
honest, is in [PRIVACY.md](PRIVACY.md).

Three scopes, all of them read-only:

```yaml
- read:page:confluence     # page bodies, which carry the links
- read:space:confluence    # space keys, so a finding can name its space
- storage:app              # the index
```

## Who sees what

The index knows about every page on the site, because it is built with the
app's permissions. You are shown only the pages Confluence confirms you may
see, and it is asked as you, every time. Where rows are removed the number is
stated rather than quietly dropped — showing four when six exist is misleading,
and showing six is a leak.

## How it stays current

Pages edited in the last hour are re-read hourly. Everything else is caught by
a nightly sweep, because renaming a page can break links on pages you never
touched.

The hourly pass reads the newest-edited pages and stops as soon as it reaches
versions it already has — usually one request. Confluence will push an event on
every edit instead, but only to an app holding a classic scope over the summary
of all content, and three narrow read-only scopes are most of why this app is
worth installing.

A full sweep is far longer than the 25 seconds a Forge function gets, so it is
a chain of queued steps, each resuming at the cursor the last one left. Every
report says when the index was last rebuilt, so you can judge the answer rather
than being given a comforting silence.

## Running the tests

```bash
npm install
npm test
```

147 tests. The parser, the graph model, the link resolution and the whole
crawler run against a fake site, so the thing that normally runs at three in the
morning is actually exercised.

```bash
npm run audit
```

The security audit. Its checks come from the [Marketplace security
requirements][mp] and the [Forge security model][forge], not from imagination,
and every one of them is itself tested against code written to be exactly what
it looks for — because an audit that has never found anything is
indistinguishable from an audit that cannot.

## Licence

Apache 2.0. See [LICENSE](LICENSE).

[mp]: https://developer.atlassian.com/platform/marketplace/security-requirements/
[forge]: https://developer.atlassian.com/platform/forge/security/
