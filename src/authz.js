/*
 * Who is allowed to see what.
 *
 * The index is built with the app's own permissions, so it knows about every
 * page on the site. The people reading a report do not have that. Showing
 * someone "this page is linked from HR/Terminations" tells them a page called
 * HR/Terminations exists, and that alone can be the leak.
 *
 * So nothing read out of the index is ever shown until Confluence itself has
 * confirmed, as the person asking, that they may see it. The app does not model
 * Confluence's permissions — space permissions, page restrictions, inherited
 * restrictions, anonymous access — it asks Confluence and believes the answer.
 *
 * The rule, when the answer does not come: a failure to answer is not
 * permission. An error hides the row.
 */

import api, { route } from '@forge/api';

/** The id filter takes at most 250 values in one call. */
const MAX_IDS = 250;

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Which of these page ids the caller may actually see.
 *
 * Asked as the user, so Confluence applies exactly the permissions it would
 * apply if they navigated to the page themselves. Anything it declines to
 * return is treated as not visible.
 *
 * `request` is injected so this can be tested without Forge.
 */
export async function visiblePages(ids, { request = asUserRequest } = {}) {
  const unique = [...new Set(ids.map(String))].filter((id) => /^\d+$/.test(id));
  if (unique.length === 0) return new Map();

  const visible = new Map();

  for (const group of chunk(unique, MAX_IDS)) {
    let response;
    try {
      response = await request(route`/wiki/api/v2/pages?id=${group.join(',')}&limit=${String(group.length)}`);
    } catch {
      // The call failed. That is not permission, so this group stays hidden.
      continue;
    }
    if (!response?.ok) continue;

    let body;
    try { body = await response.json(); } catch { continue; }

    for (const page of body?.results ?? []) {
      visible.set(String(page.id), {
        id: String(page.id),
        title: page.title,
        spaceId: page.spaceId,
        webui: page?._links?.webui ?? '',
      });
    }
  }

  return visible;
}

function asUserRequest(url) {
  return api.asUser().requestConfluence(url, { headers: { Accept: 'application/json' } });
}

/**
 * Keep only the rows whose source page the caller may see, and say how many
 * were withheld.
 *
 * The count is shown rather than hidden. "4 pages link here, and 2 more you do
 * not have access to" is honest and useful; silently showing four is a lie by
 * omission, and showing six is the leak.
 */
export async function filterBySource(rows, options) {
  const visible = await visiblePages(rows.map((r) => r.sourceId), options);
  const allowed = rows.filter((r) => visible.has(String(r.sourceId)));
  return {
    rows: allowed.map((r) => ({ ...r, source: visible.get(String(r.sourceId)) })),
    withheld: rows.length - allowed.length,
  };
}

/**
 * Whether the caller administers this Confluence site.
 *
 * Used only to gate the things that cost the site something — starting a sweep,
 * changing settings — never to gate reading, which is governed by the page
 * permissions above.
 */
export async function isSiteAdmin({ request = asUserRequest } = {}) {
  try {
    const response = await request(route`/wiki/rest/api/user/current`);
    if (!response?.ok) return false;
    const me = await response.json();
    // Confluence reports the operations the current user may perform on the
    // site. Administering is the one that matters here.
    return Boolean(me?.operations?.some?.((op) => op?.operation === 'administer'));
  } catch {
    return false;
  }
}

/**
 * Wrap a resolver so it runs only for a site administrator.
 *
 * Forge resolvers do not authorize anything on their own: any user of the site
 * can invoke any resolver the app exposes. The check has to be here.
 */
export function requireAdmin(check, handler) {
  return async (payload, context) => {
    if (!(await check())) {
      return { error: 'This needs Confluence administrator permission.' };
    }
    return handler(payload, context);
  };
}
