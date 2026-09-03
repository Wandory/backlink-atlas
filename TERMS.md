# End user terms — Backlink Atlas

Last updated: 2 September 2026

These terms cover your use of the Backlink Atlas app for Confluence. Installing
or using the app means you accept them. They are deliberately plain; where they
are short it is because there is genuinely little to say, not because something
is hidden.

## 1. What you may do

You may install and use the app on any Atlassian site you administer, for any
purpose, commercial or otherwise.

The app is published under the **Apache License 2.0**, and its source is
public. You may read it, run it, modify it and distribute your own version,
subject to that licence. Nothing in these terms takes away a right the Apache
licence gives you.

## 2. What the app does, and what it does not promise

The app builds an index of the links between your Confluence pages and reports
what it finds: what links to a page, which links no longer land, and which
pages nothing links to. It reads pages. It writes nothing to your site, and it
has no access to anything outside it.

**It is not a guarantee that your links work.** Four limits are worth stating
plainly, because they are the app's own:

- **Links off your site are not checked.** They are listed as external. The app
  declares no external permissions and cannot reach the internet, so it has no
  way to know whether an outside address still answers.
- **Attachments are not checked.** The app does not ask for permission to read
  them and says so rather than guessing.
- **The index is as fresh as the last pass over it.** Editing a page updates
  that page within the hour. Renaming a page can break links on other pages,
  and those are found by the nightly sweep, not immediately. Every report
  states when the index was last rebuilt.
- **It can only see what it is allowed to see**, and so can you. Results are
  filtered to the pages Confluence confirms you may open.

Do not use the app as the only control where a broken link would be dangerous
or where a regulation requires a specific one. It is a report, not a safeguard.

## 3. No warranty

The app is provided **as is**, without warranty of any kind, express or
implied, including but not limited to the warranties of merchantability,
fitness for a particular purpose and non-infringement. This follows the Apache
licence's own disclaimer and it is meant literally.

We do not warrant that the app will be uninterrupted, that it will find every
broken link, or that it is free of defects.

## 4. Liability

To the fullest extent permitted by law, the authors and copyright holders are
not liable for any claim, damages or other liability, whether in an action of
contract, tort or otherwise, arising from or in connection with the app or its
use.

In particular, we are not liable for the consequences of a broken link the app
did not report, or reported late.

## 5. Your data

The app reads the text of your pages in order to find the links in it, and does
not store that text. What it reads, stores and logs is described in full in the
[privacy policy](PRIVACY.md), which forms part of these terms.

Nothing is sent outside your Atlassian environment.

You remain responsible for your Confluence site and the data in it. Your
agreement with Atlassian continues to govern that data.

## 6. Price

The app is currently **free**.

If a paid version is introduced, it will be a separate offering with its own
terms, and it will not remove a capability that this free version already has.
A feature you rely on today will not be taken away and sold back to you.

## 7. Support

Support is provided on a best-effort basis through the public repository and
the contact on the Marketplace listing. There is no contracted response time
for the free app, and it would be dishonest to imply one.

Security reports are treated differently: report them privately and you will
get a reply. See [SECURITY.md](SECURITY.md).

## 8. Ending it

You may uninstall the app at any time, from Confluence's app management. Doing
so removes the app's stored data, which is to say the index. Your pages and
their links are untouched — the app never wrote to them.

We may stop publishing the app. If that happens it will be announced on the
Marketplace listing and in the repository, and because the app is Apache 2.0
and its source is public, you may continue to run your own copy.

## 9. Changes to these terms

Changes will be published in the repository with their date. Material changes
will be noted in the app's release notes. Continuing to use the app after a
change means accepting it; if you do not accept it, uninstall the app.

## 10. Law

These terms are governed by the law of the jurisdiction in which the publisher
resides, without regard to conflict of law rules. Nothing here limits any right
you have under mandatory consumer law in your own country.

## Contact

Raise an issue in the public repository, or use the support contact on the
Marketplace listing.
