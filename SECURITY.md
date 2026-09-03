# Security policy — Backlink Atlas

## Reporting a vulnerability

Report it privately, not in a public issue:

**[Open a private security advisory](https://github.com/Wandory/backlink-atlas/security/advisories/new)**

If that is not available to you, raise an issue saying only that you have a
security report and asking for a private channel — no details in the public
thread.

You will get a reply. There is no contracted response time, and pretending
otherwise would be the first dishonest sentence in this repository; what there
is, is a single maintainer who reads reports.

## What this app can and cannot do

Worth knowing before you look, because it bounds the damage any bug in it could
cause.

| | |
|---|---|
| **Permissions** | `read:page:confluence`, `read:space:confluence`, `read:content.permission:confluence`, `read:confluence-user`, `storage:app`. Nothing else, and not one of them writes. |
| **Writes to Confluence** | none, ever. No scope that writes is requested, so the platform would refuse. |
| **Network egress** | none. The manifest declares no external permissions, so the platform will not let it call out even if the code tried. |
| **Credentials held** | none. No token, no webhook secret, no password, nothing to steal. |
| **Reads** | page bodies, to extract the links, and space keys. |
| **Stores** | the link graph — ids, titles, headings and states. Not page text. The full list is in [PRIVACY.md](PRIVACY.md). |
| **Runs on** | Atlassian's own infrastructure, via Forge. |

## The risk that matters most here

It is not a traditional vulnerability. **The index is built with the app's
permissions, so it knows every page on the site**, including pages a given
reader may not open. A backlink names a page. Naming a page someone cannot see
tells them it exists, and its title often tells them more than that.

Everything read out of the index is therefore filtered before it is shown:
Confluence is asked, as the person asking, which of the pages involved they may
see, and only those are returned. Where rows are removed the count is stated.
When the question cannot be answered the row is hidden — a failure to answer is
not permission.

**Any way around that filter is the most serious thing you could find here**,
and it is treated as such.

## In scope

- Anything that shows a reader a page, title, or the existence of a page they
  are not allowed to see. Including through counts: a byline that says "7
  backlinks" where the reader may see three has leaked the other four.
- Anything that lets a non-administrator start or stop a sweep. Those cost the
  site something, so they check the caller's permission as that user.
- Anything that makes the app store page content. The privacy policy says it
  does not, and the audit enforces the field list — a way past it matters.
- Anything that makes the app report a working link as broken, or a broken one
  as working. A report that cries wolf gets closed and never opened again, and
  then the genuinely broken links are never fixed either. That is a security
  problem in its own right and it is treated as one.
- Anything that gets customer identifiers into vendor-readable logs.

## Out of scope

- Findings against Confluence or Forge themselves. Report those to Atlassian.
- The absence of features. External link checking is not a gap, it is a
  decision, and it is written down as one.
- Staleness between sweeps. Renaming a page can break links on other pages, and
  those are not found until the next sweep. This is known, documented, listed
  in the audit's accepted risks, and stated in every report.

## What is already done

The repository carries its own security audit, whose checks come from the
[Marketplace security requirements for cloud apps][mp] and the [Forge security
model][forge] rather than from imagination:

```bash
npm run audit
```

It runs inside `npm test` and fails the build on any high finding. Half its
checks are static; the other half call the real functions with hostile input —
a permission check is asked what it does when the call fails, a key builder is
handed a page title full of characters the platform forbids, and the row
builders are handed a page whose every field is marker text, to prove none of it
reaches storage.

Every check is itself tested against code written to be exactly what it looks
for. An audit that has never found anything is indistinguishable from an audit
that cannot.

## Fixes

Security fixes ship as soon as they are ready and are described plainly in the
release notes — including what was wrong, not only that something was. An
advisory nobody can act on is not a disclosure.

Atlassian's [Security Bug Fix Policy][bugfix] applies to apps on the
Marketplace, and this app is held to it.

[mp]: https://developer.atlassian.com/platform/marketplace/security-requirements/
[forge]: https://developer.atlassian.com/platform/forge/security/
[bugfix]: https://www.atlassian.com/trust/security/bug-fix-policy
