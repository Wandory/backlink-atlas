# Marketplace listing — Backlink Atlas

Everything the listing form asks for, written out so it can be pasted rather
than composed under pressure. Character limits are Atlassian's.

---

## Creating the listing

The Marketplace "Publish a new app" form needs these before anything else:

| Field | Value |
|---|---|
| Vendor | **Illia Sharan** — not "Devlink Watch", which is an empty duplicate |
| Upload app | **Forge app** |
| Forge app | **Backlink Atlas** — appears only once distribution status is Sharing |
| Version | 2.0.0 (filled in automatically) |
| Compatible Atlassian apps | **Confluence Cloud** |
| App key | `io.github.wandory.backlinkatlas` |
| App name | `Backlink Atlas for Confluence` |

Then **Save as private** rather than "Next: Make public" — the listing is filled
in first and made public at the end, so nothing half-written is ever visible.

## Name

```
Backlink Atlas for Confluence
```

Marketplace validates the name against its branding guidelines, which require
the `<App Name> for <Product Name>` shape when a product is named. Carrying the
product is also how the catalogue is searched: people look for "confluence
backlinks", not for a brand they have never heard of. The app calls itself
**Backlink Atlas** everywhere inside Confluence, where the product is obvious.

## Tagline (max 130, and it must not end in punctuation)

```
What links to this page, and which links no longer land
```
*(54 characters. The full stop is deliberately absent — Marketplace rejects a
tagline that ends in one.)*

## Summary (max 250)

```
Confluence has no reverse index — nothing answers what links to a page. This builds one: what links here, which links no longer land, and which pages nothing links to. It finds links to a renamed heading, which break in silence.
```
*(225 characters.)*

## Categories (choose exactly these two)

- **Content and communication**
- **Administrative tools**

## Keywords (choose exactly these four)

- **Documentation**
- **Knowledge Base**
- **Document Management**
- **Audit**

None of the four is the word a customer would actually type — there is no
"backlinks" or "broken links" keyword in Atlassian's fixed list. These are the
nearest available, and the tagline and summary carry the real words.

## Images to upload

| Field | File |
|---|---|
| App logo (144×144) | `web/brand/logo.png` |
| Banner (1120×548) | `web/brand/banner.png` |

## Other fields on the Details page

| Field | Value |
|---|---|
| App stores personal data | **No** |
| Data security and privacy statement | `https://github.com/Wandory/backlink-atlas/blob/main/PRIVACY.md` |
| Track work items | `https://github.com/Wandory/backlink-atlas/issues` |
| Support ticketing system | `https://github.com/Wandory/backlink-atlas/issues` |
| Release behavior | leave as *Publish app immediately after approval* |

## Highlights

Three, each with a title (max 80) and a summary (max 250).

**1.**
```
See what links here — the answer Confluence has never given
```
```
Confluence has no reverse index. Nothing in its REST API answers "what points at this page", and the request for it has been open since 2014. This app builds that index and puts the answer on the page, and in the byline, where you need it before you rename or delete anything.
```

**2.**
```
Find the links that broke silently
```
```
Not only links to deleted pages. Also links to a heading that has been renamed — those fail without an error, without a redirect, dropping the reader at the top of a long page. Nothing in Confluence reports them. This does, and says which heading is gone.
```

**3.**
```
Reads pages, stores connections, sends nothing anywhere
```
```
It reads page text to find the links, then discards it: what is stored is the graph, not the words. It declares no external permissions, so the platform itself would refuse an outbound call. Everyone sees only the pages they may open, and hidden results are counted, not concealed.
```

## Long summary — the "Summary" box on the version page (max 1000)

```
Confluence cannot tell you what links to a page. There is no call in its API that answers it, which is why the request for one has sat on Atlassian's public tracker since 2014 with over six hundred votes.

Backlink Atlas builds the reverse index Confluence does not keep, and answers three questions with it.

What links here — listed on the page and counted in the byline, so you know what you are about to break before you rename, move or delete something.

Which links no longer land — including links to a heading that has been renamed, which break with no error and no redirect and are invisible to everyone until a reader complains.

What nothing links to — pages reachable from the tree but from no page's text.

It reads page text to find the links and does not keep it. It writes nothing to Confluence. It declares no external permissions, so nothing can leave your site even by accident. Everyone sees only the pages they are allowed to open, and where results are withheld the number is shown rather than quietly dropped.

Free, open source, Apache 2.0, with its security audit in the repository.
```

## More details / long description

```
### The gap this fills

Confluence's REST API has no inbound-link call. Not a limited one — none. You can ask what a page contains; you cannot ask what points at it. The feature request has been open since 2014, in "Gathering Interest", with 629 votes.

That means the reverse index has to be built, and kept. This app reads each page's stored markup, extracts every link, and maintains the index that answers the question backwards.

### What you get

**On the page.** A "Backlinks" macro listing every page that links to this one, and a byline item showing the count without adding anything to the page.

**Per space.** A Link health report: every link in the space that no longer lands, with the reason in plain words, and every page nothing links to.

**Three kinds of broken, told apart.** A link to a page that is gone. A link to a heading that is gone — the silent one. And a link to a title that more than one page in the space carries, where which page opens is up to Confluence.

### What it deliberately does not do

It does not check links to the outside world. They are recorded and shown as external, never called broken. Checking them would mean calling out to the internet, and this app declares no external permissions at all — that is a promise the platform enforces rather than one you have to take on trust.

It does not check attachments, because it does not ask for permission to read them. It says "unchecked" instead of guessing.

It does not write to Confluence. No scope in its manifest would allow it.

### Permissions, and why each one

- read:page:confluence — page bodies. This is what carries the links.
- read:space:confluence — space keys, so a finding can say which space it is in. Confluence's page API names a space only by a numeric id.
- read:content.permission:confluence — whether a given person may read a given page. Asked of Confluence before any result is shown, which is what stops anyone seeing a page they cannot open.
- read:confluence-user — whether the person pressing "rebuild the index" administers the site. Asked about them, at that moment, and never stored.
- storage:app — the index, held in Forge storage inside your Atlassian environment.

Two of those five exist to withhold things rather than to gather them. Not one of them can change anything.

### Privacy

The app reads the words on your pages. It does not store them. What it stores is ids, titles, headings and link states — the full field list is in the privacy policy, and the repository's audit fails the build if a field is added that the policy does not list, so the policy cannot quietly go out of date.

### Who sees what

The index is built with the app's permissions, so it knows about every page on the site. Nothing from it is shown to you until Confluence has confirmed, as you, that you may see it. Where rows are removed the count is stated: "4 pages link here, and 2 more you do not have access to". Showing four would mislead you; showing six would leak.

### Freshness

Pages edited in the last hour are re-read hourly. Renaming a page can break links on pages you never touched, and those are found by the nightly sweep. Every report says when the index was last rebuilt, so you can judge the answer instead of assuming it is current.

### Open source

Apache 2.0, source public, including the security audit that gates every release.
```

## Support

- **Support type:** Community
- **Documentation:** https://github.com/Wandory/backlink-atlas#readme
- **Support site:** https://github.com/Wandory/backlink-atlas/issues
- **Privacy policy:** https://github.com/Wandory/backlink-atlas/blob/main/PRIVACY.md
- **End user terms:** https://github.com/Wandory/backlink-atlas/blob/main/TERMS.md

## Pricing

Free.

## Data security answers

Prepared for the security and data questions the listing asks.

| Question | Answer |
|---|---|
| Does the app store customer data outside Atlassian? | No. There is no infrastructure outside Forge. |
| Does the app transmit data to third parties? | No. No external permissions are declared. |
| What personal data is processed? | None. No names, email addresses or account ids are read or stored. |
| Is data encrypted at rest and in transit? | Yes, by the Forge platform. |
| Where is data stored? | Forge hosted storage, in the region of the customer's Atlassian site. |
| Sub-processors? | None. |
| How is customer data deleted? | Uninstalling removes app storage. Deleting a page removes it from the index. |
| Does the app read page content? | Yes — that is how links are found. It is not retained; only the resulting link graph is stored. |

## Release notes for 1.0.0

```
First release.

- Backlinks macro and byline item: what links to this page.
- Link health per space: links to deleted pages, links to renamed headings, and titles that more than one page carries.
- Orphan pages: reachable from the tree, but from no page's text.
- Nightly index rebuild, plus an hourly pass over whatever was edited since the last one.
- Read-only, no external permissions, page text never stored.
```
