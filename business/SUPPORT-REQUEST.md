# Support request — Marketplace management console will not save

Ready to send to Atlassian Marketplace partner support. Everything below has
been reproduced rather than assumed.

---

**Subject:** App listing forms silently fail to save — app 1106524273

**Partner:** Illia Sharan (vendor 1004534073)
**App:** Backlink Atlas for Confluence — `io.github.wandory.backlinkatlas`, id `1106524273`
**Forge app id:** `2beb7dcf-6bc6-4c40-8861-f5df230cf96c`

No form in the management console for this app saves anything. There is no
error message, no validation warning, and no request leaves the browser.

## What fails

| Page | What was entered | Result |
|---|---|---|
| `/manage/apps/1106524273/details` | tagline, summary, both categories, all four keywords, logo, banner, "stores personal data: No" | Save produces nothing; every field is empty again after a reload |
| `/manage/apps/1106524273/privacy-and-security` | eleven questionnaire answers and the security policy URL | "Save and preview" produces nothing; blank after a reload |
| `/manage/apps/1106524273/versions/2001000/details` | release summary | Save produces nothing; the previous value returns after a reload |

Two fields on the Details page *are* populated — the data security statement
and the support ticketing URL — but those arrived from the developer console's
distribution details, not from saving this form.

## What was checked before writing

- `form.checkValidity()` returns **true**; `form.querySelectorAll(':invalid')`
  is **empty**.
- The Save button is present, `type="submit"`, and **not disabled**.
- Its React props carry an `onClick`, and the form carries an `onSubmit`.
- Save was triggered five different ways: a real mouse click on the visible
  button, a programmatic `.click()`, `form.requestSubmit(button)`, dispatching
  a `submit` event, and invoking the React `onClick` handler directly. All five
  behave identically — nothing happens.
- **No network request is issued** on any of them.
- The same is true of ordinary navigation: clicking the version number link or
  the "Create app" button does not navigate. Loading the same URLs directly
  works, and the pages render correctly.
- A hard reload does not change any of this.
- The vendor profile is complete: name, postal address, contact email.

## Console errors, present on every load including after a hard reload

```
Unable to retrieve the configuration value for marketplace-store-onetrust-settings

@atlassiansox/feature-flag-web-client@8.4.0 - Feature flag service returned 401,
"Invalid apiKey=[1f5d5f93-c052-4372-bc81-a99b00e04bc0]".
This request will not be retried until the user data has been changed.

[Apollo GraphQL]: Operation "GetProductLifecycleJobs" failed
```

The failing feature-flag client and the failing GraphQL operation look like the
most probable cause: if the console's data layer is in a failed state, a
mutation would never be issued, which is exactly the behaviour observed.

## Context

The same partner account submitted a different app, Devlink Watch, on
2 September 2026 without trouble, so the account itself has worked recently.
This app was created on 3 September and has never successfully saved anything.

The app itself is finished: released to production, installed on a live site,
and eligible for Runs on Atlassian. Only the listing content is blocked.

## What is needed

Either a fix so the console saves, or another route to set the listing content
for this app.
