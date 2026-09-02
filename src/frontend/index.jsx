/*
 * Everything a person sees.
 *
 * One resource serves four places — the macro on a page, the byline item, the
 * space report and the site settings — so the first thing this does is work out
 * where it is running and show the right thing.
 *
 * The tone throughout: say what is known, say plainly what is not, and never
 * imply the index is fresher than it is.
 */

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Heading, Stack, Inline, Box, Button, Lozenge, Link, Spinner,
  SectionMessage, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

/** A promise turned into { loading, data, error }, refreshable. */
function useCall(name, payload, deps = []) {
  const [state, setState] = useState({ loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    invoke(name, payload)
      .then((data) => live && setState({ loading: false, data }))
      .catch((error) => live && setState({ loading: false, error: String(error?.message ?? error) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, nonce, ...deps]);

  return [state, () => setNonce((n) => n + 1)];
}

const ago = (seconds) => {
  if (!seconds) return 'never';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const TONE = {
  missing: 'removed',
  anchormissing: 'moved',
  ambiguous: 'new',
};

const HEADLINE = {
  missing: 'Points at a page that is not there',
  anchormissing: 'Points at a heading that is gone',
  ambiguous: 'Points at a title more than one page carries',
};

/* ---------------------------- what links here ---------------------------- */

function Backlinks() {
  const context = useProductContext();
  const pageId = context?.extension?.content?.id;
  const [{ loading, data, error }] = useCall('backlinks', { pageId }, [pageId]);

  if (loading) return <Spinner label="Reading the index" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;

  const rows = data?.rows ?? [];
  const withheld = data?.withheld ?? 0;

  if (rows.length === 0) {
    return (
      <Stack space="space.100">
        <Text>Nothing links to this page.</Text>
        {withheld > 0 && (
          <Text>
            {withheld} {withheld === 1 ? 'page does' : 'pages do'}, but you do not have
            access to {withheld === 1 ? 'it' : 'them'}.
          </Text>
        )}
        <Text>
          If that is a surprise, the index may not have caught up yet — it is rebuilt
          nightly.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack space="space.100">
      <Text>
        <Text as="strong">{rows.length}</Text> {rows.length === 1 ? 'page links' : 'pages link'} here.
      </Text>
      {rows.map((row) => (
        <Inline key={row.key} space="space.100" alignBlock="center">
          <Link href={row.source?.webui ? `/wiki${row.source.webui}` : '#'}>
            {row.source?.title ?? row.sourceTitle ?? `Page ${row.sourceId}`}
          </Link>
          {row.anchors?.length > 0 && (
            <Text>→ {row.anchors.join(', ')}</Text>
          )}
        </Inline>
      ))}
      {withheld > 0 && (
        <Text>
          {withheld} more {withheld === 1 ? 'page links' : 'pages link'} here that you do not
          have access to.
        </Text>
      )}
      {data?.truncated && (
        <SectionMessage appearance="warning">
          <Text>There are more than this app will list at once. The count above is not the total.</Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

/* ---------------------------- the space report --------------------------- */

function SpaceReport() {
  const context = useProductContext();
  const spaceKey = context?.extension?.space?.key;
  const [{ loading, data, error }, again] = useCall('spaceReport', { spaceKey }, [spaceKey]);

  if (loading) return <Spinner label="Reading the index" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;

  const problems = data?.problems ?? [];
  const orphans = data?.orphans ?? [];
  const sweep = data?.sweep ?? {};

  return (
    <Stack space="space.200">
      <Heading as="h2">Link health</Heading>
      <Freshness sweep={sweep} />

      <Inline space="space.100">
        <Button onClick={again}>Refresh</Button>
      </Inline>

      <Heading as="h3">Links that no longer land ({problems.length})</Heading>
      {problems.length === 0 ? (
        <Text>None found in this space.</Text>
      ) : (
        problems.map((row) => (
          <Box key={row.key} padding="space.100">
            <Stack space="space.050">
              <Inline space="space.100" alignBlock="center">
                <Lozenge appearance={TONE[row.state] ?? 'default'}>{HEADLINE[row.state] ?? row.state}</Lozenge>
                <Link href={row.source?.webui ? `/wiki${row.source.webui}` : '#'}>
                  {row.source?.title ?? row.sourceTitle ?? `Page ${row.sourceId}`}
                </Link>
              </Inline>
              <Text>{row.reason}</Text>
            </Stack>
          </Box>
        ))
      )}
      {data?.withheld > 0 && (
        <Text>{data.withheld} more are on pages you do not have access to.</Text>
      )}

      <Heading as="h3">Pages nothing links to ({orphans.length})</Heading>
      {orphans.length === 0 ? (
        <Text>Every page in this space is linked from somewhere.</Text>
      ) : (
        <Stack space="space.050">
          <Text>
            Reachable from the tree, but not from any page's text. Often fine for a
            homepage; usually a sign for anything else.
          </Text>
          {orphans.map((page) => (
            <Text key={page.id}>{page.title}</Text>
          ))}
        </Stack>
      )}
      {data?.orphansTruncated && (
        <Text>More than this app lists at once; the list above is a sample.</Text>
      )}
    </Stack>
  );
}

/* ------------------------------- settings -------------------------------- */

function Freshness({ sweep }) {
  if (sweep.phase === 'failed') {
    return (
      <SectionMessage appearance="error">
        <Text>
          The last sweep stopped before it finished, {ago(sweep.finishedAt)}: {sweep.error}.
          What is below is whatever had been indexed by then, and it is incomplete.
        </Text>
      </SectionMessage>
    );
  }
  if (sweep.phase === 'pages' || sweep.phase === 'resolve') {
    return (
      <SectionMessage appearance="information">
        <Text>
          A sweep is running now — {sweep.pages ?? 0} pages read so far. Until it
          finishes, what is below is from the previous one.
        </Text>
      </SectionMessage>
    );
  }
  if (!sweep.finishedAt) {
    return (
      <SectionMessage appearance="warning">
        <Text>The index has not been built yet. Nothing below means anything until it has.</Text>
      </SectionMessage>
    );
  }
  return <Text>Index last rebuilt {ago(sweep.finishedAt)}.</Text>;
}

function Settings() {
  const [{ loading, data, error }, again] = useCall('status', {});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  if (loading) return <Spinner label="Checking" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;

  const sweep = data?.sweep ?? {};
  const admin = data?.admin;

  const start = async () => {
    setBusy(true);
    setNote('');
    const result = await invoke('runSweep', {});
    setBusy(false);
    setNote(result?.error ?? result?.skipped ?? 'Sweep started.');
    again();
  };

  return (
    <Stack space="space.200">
      <Heading as="h2">Backlink Atlas</Heading>
      <Text>
        Confluence has no reverse index — nothing in its API answers "what links to
        this page". This app builds one by reading pages and keeping the links it
        finds. It stores the connections, not the words.
      </Text>

      <Freshness sweep={sweep} />

      <Stack space="space.050">
        <Text>Pages indexed: {sweep.pages ?? 0}</Text>
        <Text>Links recorded: {sweep.edges ?? 0}</Text>
        <Text>Links that do not land: {sweep.problems ?? 0}</Text>
      </Stack>

      {admin ? (
        <Inline space="space.100" alignBlock="center">
          <Button appearance="primary" onClick={start} isDisabled={busy}>
            {busy ? 'Starting' : 'Rebuild the index now'}
          </Button>
          {note && <Text>{note}</Text>}
        </Inline>
      ) : (
        <Text>Rebuilding the index needs Confluence administrator permission.</Text>
      )}

      <Heading as="h3">What this app can and cannot see</Heading>
      <Stack space="space.050">
        <Text>It reads pages, and nothing else. It never writes to Confluence.</Text>
        <Text>
          It declares no external permissions, so it cannot send anything anywhere —
          the platform would refuse the call.
        </Text>
        <Text>
          Links off this site are recorded but never checked, and are never reported
          as broken.
        </Text>
        <Text>
          Attachments are not checked: this app does not ask for permission to read
          them.
        </Text>
        <Text>
          Everyone sees only the pages they are allowed to see. Where results are
          hidden, the count of hidden ones is shown rather than quietly dropped.
        </Text>
      </Stack>
    </Stack>
  );
}

/* -------------------------------- routing -------------------------------- */

function App() {
  const context = useProductContext();
  const key = context?.moduleKey ?? context?.extension?.type ?? '';

  if (key.includes('space')) return <SpaceReport />;
  if (key.includes('settings')) return <Settings />;
  return <Backlinks />;
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
