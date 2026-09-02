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
| Code | done — 158 tests, 157 green |
| Security audit | done — no high findings |
| Documentation, privacy policy, terms, security policy | done |
| Listing text, logo, banner, hero, three screenshots | done |
| Niche and competitor analysis | done — `business/NICHE.md` |
| App registered with Atlassian | **you** |
| Deployed and installed on a site | **you**, then me |
| Tested against a real Confluence | **you**, then me |
| Submitted to the Marketplace | **you**, then me |

The one failing test is deliberate. `manifest.yml` still carries a placeholder
app id, and a test fails until it is replaced. It goes green the moment the app
is registered, which is the first step below.

---

## 1. Register the app — **you**

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
three permissions. All three are read-only as far as Confluence is concerned:

```
read:page:confluence     page text, which is what carries the links
read:space:confluence    space keys, so a finding can name its space
storage:app              the index
```

When it finishes, tell me. I take it from there.

## 2. First index — me, once it is installed

In Confluence: **Settings → Apps → Backlink Atlas → Rebuild the index now**.

The first build reads every page on the site. Minutes on a small site, longer
on a large one. It runs as a chain of background steps, so the page can be
closed.

## 3. Check it against reality — me

This is the step that matters most, and it is the one that caught a fatal
mistake in the last product. The plan:

- Create a page, link to it from two others, and confirm the backlink count
  says two.
- Rename a heading that something links to, and confirm the app reports the
  anchor as gone — this is the differentiating feature and it must be right.
- Delete a page and confirm the links to it are reported as missing.
- Confirm a page you have no permission to see is counted as withheld and not
  named.

Anything the app gets wrong here gets fixed before submission. A report that
cries wolf is worse than no report.

## 4. Publish the source — me

A public repository at `github.com/Wandory/backlink-atlas`, Apache 2.0. The
listing links to it for documentation, support, privacy policy and terms, so it
has to exist before the listing is submitted.

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

**A rename is not caught instantly.** Editing a page updates that page at once.
Renaming a page can break links on other pages, and those are found by the
nightly sweep. Every report says when the index was last rebuilt.

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
