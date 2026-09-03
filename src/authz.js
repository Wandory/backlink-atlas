/*
 * Who is allowed to see what.
 *
 * The index is built with the app's own permissions, so it knows about every
 * page on the site. The people reading a report do not have that. Showing
 * someone "this page is linked from HR/Terminations" tells them a page called
 * HR/Terminations exists, and that alone can be the leak.
 *
 * So nothing read out of the index is shown until Confluence itself has
 * confirmed that this particular person may see it. The app does not model
 * Confluence's permissions — space permissions, page restrictions, inherited
 * restrictions, anonymous access — it asks Confluence and believes the answer.
 *
 * The rule, when the answer does not come: a failure to answer is not
 * permission. An error hides the row.
 *
 * Two different mechanisms are used, for a reason worth writing down:
 *
 *   Reading  — Confluence's content permission endpoint, called with the app's
 *              own authority, asking whether a named person may read a named
 *              page. It needs no consent from that person, so the backlinks
 *              panel works for everyone the moment the app is installed.
 *
 *              Forge ships an `authorize()` helper that looks like the right
 *              tool and is documented as the companion to `asApp`. It is not
 *              used here: its implementation calls `asUser()`, so it carries
 *              the same consent prompt, and every reader would meet a "grant
 *              access" screen on an ordinary page. The endpoint underneath is
 *              the same one, so this calls it directly.
 *
 *   Rebuilding — `asUser()`, acting as the caller, because Confluence will not
 *              tell an app what someone else is allowed to do: asked with the
 *              app's own authority it answers 401. Acting as the caller costs
 *              that person a one-time consent, which is why it is asked when
 *              they press the button and never on page load. Nobody meets a
 *              consent screen for reading a report.
 */

import api, { route } from '@forge/api';

/**
 * How many pages are permission-checked for one report.
 *
 * Each check is a request, so this is the real cost of a large backlinks list.
 * Beyond the cap the report says it is showing a sample rather than quietly
 * dropping the rest.
 */
export const MAX_CHECKS = 60;

/** Run promises a few at a time, so sixty checks are not sixty round trips. */
async function inParallel(items, worker, width = 10) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Which of these page ids the caller may read.
 *
 * `check` is injected so this can be tested without Forge. It answers for one
 * page at a time because that is what Confluence's content permission API
 * takes; there is no bulk form of it.
 */
export async function readablePages(ids, { accountId, check = confluenceCanRead } = {}) {
  const unique = [...new Set(ids.map(String))].filter((id) => /^\d+$/.test(id));
  if (unique.length === 0 || !accountId) return { allowed: new Set(), checked: 0, capped: false };

  const considered = unique.slice(0, MAX_CHECKS);
  const verdicts = await inParallel(considered, async (id) => {
    try {
      return [id, await check(id, accountId)];
    } catch {
      // The check failed. That is not permission.
      return [id, false];
    }
  });

  return {
    allowed: new Set(verdicts.filter(([, ok]) => ok).map(([id]) => id)),
    checked: considered.length,
    capped: unique.length > considered.length,
  };
}

async function confluenceCanRead(contentId, accountId) {
  const response = await api.asApp().requestConfluence(
    route`/wiki/rest/api/content/${String(contentId)}/permission/check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        subject: { type: 'user', identifier: String(accountId) },
        operation: 'read',
      }),
    },
  );
  if (!response.ok) return false;
  const verdict = await response.json();
  return Boolean(verdict?.hasPermission);
}

/**
 * Keep only the rows whose source page the caller may read, and say how many
 * were withheld.
 *
 * The count is shown rather than hidden. "4 pages link here, and 2 more you do
 * not have access to" is honest and useful; silently showing four is a lie by
 * omission, and showing six is the leak.
 */
export async function filterBySource(rows, options = {}) {
  const { allowed, capped } = await readablePages(rows.map((r) => r.sourceId), options);
  const permitted = rows.filter((r) => allowed.has(String(r.sourceId)));
  return {
    rows: permitted,
    withheld: rows.length - permitted.length,
    capped,
  };
}

function asUserRequest(url) {
  return api.asUser().requestConfluence(url, { headers: { Accept: 'application/json' } });
}

/**
 * The administrator check, with its reasoning.
 *
 * It says why, not only whether. A flat "you need administrator permission"
 * shown to someone who *is* an administrator is a dead end for them and
 * invisible to us — it looks identical whether the answer is genuinely no, the
 * call was refused, or the app is missing a scope.
 *
 * `accountId` must come from the platform's context and never from the caller's
 * payload. A caller who could name the account being checked could name an
 * administrator's and let themselves through, which is the whole gate gone.
 */
export async function checkSiteAdmin({ request = asUserRequest } = {}) {
  // The operations are not returned unless they are asked for by name. Without
  // the expand this endpoint answers happily and says nothing about
  // permissions, so every caller reads as "not an administrator" — which is
  // safe, and completely useless.
  //
  // A failure here is deliberately not caught. Forge raises a specific error
  // when the caller has not yet granted the app permission to act for them, and
  // catching it would swallow the prompt that asks for exactly that: the button
  // would refuse forever with no way for anyone to fix it.
  const response = await request(route`/wiki/rest/api/user/current?expand=operations`);

  if (!response?.ok) {
    return {
      ok: false,
      reason: `Confluence would not say what you may do (${response?.status ?? 'no response'}).`,
    };
  }

  let user;
  try {
    user = await response.json();
  } catch {
    return { ok: false, reason: 'Confluence answered with something this app could not read.' };
  }

  const operations = user?.operations ?? [];
  // Confluence lists what the person may do, scoped to a target. Administering
  // the application is the one that matters; administering a single space is
  // not the same thing and must not pass.
  const admin = operations.some?.(
    (op) => op?.operation === 'administer' && op?.targetType === 'application',
  );

  if (admin) return { ok: true, reason: 'you administer this Confluence' };
  if (operations.length === 0) {
    return { ok: false, reason: 'Confluence returned no permissions for you at all.' };
  }
  return { ok: false, reason: 'you do not administer this Confluence.' };
}

/** Whether the caller administers this Confluence. */
export async function isSiteAdmin(options) {
  return (await checkSiteAdmin(options)).ok;
}

/**
 * Wrap a resolver so it runs only for a site administrator.
 *
 * Forge resolvers do not authorize anything on their own: any user of the site
 * can invoke any resolver the app exposes. The check has to be here.
 */
export function requireAdmin(check, handler) {
  return async (payload, context) => {
    const verdict = await check();
    const ok = typeof verdict === 'boolean' ? verdict : verdict?.ok;
    if (!ok) {
      const why = typeof verdict === 'object' && verdict?.reason ? ` — ${verdict.reason}` : '';
      return { error: `This needs Confluence administrator permission${why}` };
    }
    return handler(payload, context);
  };
}
