# Launch

The code is finished, tested and audited. What is left needs an Atlassian
account, and the account is the owner's — I do not create accounts, do not
handle credentials and do not sign agreements. Nothing below asks me to.

Everything marked **done** is in this repository already. Everything marked
**you** is a step only an account holder can take, and each one says exactly
what to click.

---

## Where this stands

| | |
|---|---|
| Code | done — 173 tests, all green |
| Security audit | done — no findings at all |
| Documentation, privacy policy, terms, security policy | done |
| Listing text, logo, banner, hero, three screenshots | done |
| Niche and competitor analysis | done — `business/NICHE.md` |
| App registered with Atlassian | done — `2beb7dcf-6bc6-4c40-8861-f5df230cf96c` |
| Deployed and installed on a live site | done — development environment |
| Tested against a real Confluence | **done, and it found the thing it was built to find** |
| Released to production | next |
| Submitted to the Marketplace | **you** for the agreement and the submit button, me for the rest |

### What the live site proved

A space with four linked pages, one link to a deleted page, one link to a
heading that had been renamed, and one page nothing points at. The app,
unprompted:

```
Links that no longer land (2)
  Points at a page that is not there — New Starter Checklist
    No page called "Laptop Setup" in OPS. It was renamed, moved or deleted.
  Points at a heading that is gone — New Starter Checklist
    "Deploy Runbook" exists, but has no heading called "Emergency rollback"
    any more. The link still opens the page and drops the reader at the top.

2 pages link here.
  New Starter Checklist → Emergency rollback
  On-call Rotation → Rolling back
```

The second finding is the one nothing else in Confluence reports.

---

## 1. Register the app — done

Double-click **ЗАПУСК.cmd** in the project folder.

Before it runs, it needs a file called `ТОКЕН.txt` beside it, holding three
lines:

```
FORGE_SITE=your-site.atlassian.net
FORGE_EMAIL=the email you log into Atlassian with
FORGE_API_TOKEN=a token from id.atlassian.com/manage-profile/security/api-tokens
```

That file is in `.gitignore` and never leaves your machine. **Create the token
yourself and do not paste it into the chat** — I will not use a credential that
is shown to me, and a token that has been pasted anywhere should be revoked.

The launcher then does the rest: installs the Forge CLI, logs in, registers the
app, deploys it, and installs it on your Confluence. It asks you to confirm the
five permissions. Every one of them is read-only as far as Confluence is
concerned, and two of them exist so the app can withhold results:

```
read:page:confluence                  page text, which carries the links
read:space:confluence                 space keys, so a finding can name its space
read:content.permission:confluence    may this person read this page?
read:confluence-user                  do you administer this site?
storage:app                           the index
```

The two permission scopes are what let the app *withhold* results. Without the
first it could not tell whether you may see a row, and would have to show
everything or nothing.

When it finishes, tell me. I take it from there.

## 2. First index — done

In Confluence: **Settings → Apps → Backlink Atlas → Rebuild the index now**.

The first build reads every page on the site. Minutes on a small site, longer
on a large one. It runs as a chain of background steps, so the page can be
closed.

## 3. Check it against reality — done

This was the step that mattered most, and it earned its place: it found five
defects the test suite could not, two of which failed in complete silence and
would have shipped a product that reported "no broken links" on a site full of
them. They are described in the commit history.

Still to check before submission: that a page the reader may not open is
counted as withheld rather than named. It needs a second account with narrower
permissions.

## 4. Publish the source — done

`github.com/Wandory/backlink-atlas`, Apache 2.0, public. The listing links to
it for documentation, support, privacy policy and terms.

## 5. The Marketplace listing — **you** for the account parts, me for the rest

You will have to:

- accept the **Marketplace Partner Agreement**, if it is not already accepted
  from the previous app — a legal agreement, and signing one on your behalf is
  not something I do;
- tick the final "I confirm the information is correct" box;
- press **Submit for approval**.

Everything else — name, tagline, summary, long description, categories,
highlights, the images, the support links, the privacy and security
questionnaire — is written out ready to paste in `business/listing.md`, and I
fill the forms in.

## 6. After submission

Atlassian aims to decide in about a week. If they come back with questions I
answer them; if they ask for a change I make it and resubmit.

---

## What is deliberately not in version 1

Written down so it is a decision rather than an oversight.

**External links are not checked.** Doing it would mean declaring egress, and
the whole trust story — "the platform itself will not let this app call out" —
would be gone. If it is added it will be a separate, opt-in setting, declared
plainly.

**Attachments are not checked**, because the app does not ask for permission to
read them.

**A rename is not caught instantly.** An hourly pass re-reads whatever changed.
Renaming a page can break links on other pages nobody touched, and those are
found by the nightly sweep. Every report says when the index was last rebuilt.

## What would make it paid, later

Not now — the free version has to earn reviews first, and taking a feature away
later to sell it back is the one thing `TERMS.md` promises not to do. The
honest candidates, all of them additions:

- external link checking, opt-in, with declared egress
- scheduled reports by email or a page comment
- a site-wide report across all spaces rather than one at a time
- exporting the graph

## The bet

Recorded so it can be checked later rather than rationalised.

The niche was chosen because it is the only branch of the Confluence catalogue
where the leader is weak: Appfire's *Linking for Confluence* has 1,238 installs
and **3.5 stars**, on the old Connect platform, and nothing else in the branch
is above 600. In the neighbouring branches the leaders are strong — *Better
Content Archiving* has 1,196 installs at 4.8 stars over 154 reviews.

It is defensible because Confluence's API genuinely has no inbound-link call,
so the reverse index has to be built and maintained rather than queried. That
is work, and work is what a competitor has to repeat.

If this is wrong, it will be wrong because the market is small rather than
because it is open — a 1,238-install leader may mean few people are looking.
That is the risk being taken, and it is why the marginal cost mattered: this is
the second app through a pipeline that already exists.
