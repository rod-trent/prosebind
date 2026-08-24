import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ProsebindClient, type Finding } from './client.js';

/**
 * Drives the real language server through the real Obsidian client.
 *
 * `client.ts` deliberately imports nothing from the Obsidian API, which is what makes
 * this possible: the protocol half can be tested against a live server without an
 * Electron host anywhere in sight. The UI half is covered by `manifest.test.ts`.
 */

const repoRoot = resolve(__dirname, '..', '..', '..');
const EXAMPLE = join(repoRoot, 'examples', 'the-quarry');
const SERVER = join(repoRoot, 'packages', 'lsp', 'dist', 'cli.js');

interface Harness {
  client: ProsebindClient;
  findings: () => Finding[];
  logs: string[];
  waitForFindings: (minimum: number, timeoutMs?: number) => Promise<Finding[]>;
  status: () => string;
}

function harness(overrides: Partial<{ serverPath: string; vaultPath: string }> = {}): Harness {
  let latest: Finding[] = [];
  const logs: string[] = [];
  let state = 'starting';

  const client = new ProsebindClient({
    serverPath: overrides.serverPath ?? SERVER,
    vaultPath: overrides.vaultPath ?? EXAMPLE,
    debounceMs: 10,
    severityFloor: 'note',
    onFindings: (findings) => {
      latest = findings;
    },
    onStatus: (next) => {
      state = next;
    },
    onLog: (message) => logs.push(message),
  });

  return {
    client,
    logs,
    findings: () => latest,
    status: () => state,
    async waitForFindings(minimum, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (latest.length >= minimum) return latest;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`timed out with ${latest.length} findings (wanted ${minimum}); status=${state}`);
    },
  };
}

test('starts the server and receives the worked example findings', async () => {
  const h = harness();
  await h.client.start();
  try {
    assert.equal(h.status(), 'ready');
    const findings = await h.waitForFindings(7);
    assert.ok(findings.length >= 7, `expected at least 7 findings, got ${findings.length}`);

    const checks = new Set(findings.map((f) => f.check));
    assert.ok(checks.has('deceased-active'));
    assert.ok(checks.has('attribute-contradiction'));
    assert.ok(checks.has('name-variant'));
  } finally {
    await h.client.stop();
  }
});

test('maps the severity ladder back to writer-facing names', async () => {
  const h = harness();
  await h.client.start();
  try {
    const findings = await h.waitForFindings(7);
    const severities = new Set(findings.map((f) => f.severity));
    assert.ok(severities.has('contradiction'), 'hard contradictions must survive the round trip');
    assert.ok(severities.has('question'));
    for (const finding of findings) {
      assert.ok(['contradiction', 'question', 'note'].includes(finding.severity));
    }
  } finally {
    await h.client.stop();
  }
});

test('every finding carries a suppression key the sidebar can act on', async () => {
  const h = harness();
  await h.client.start();
  try {
    const findings = await h.waitForFindings(7);
    for (const finding of findings) {
      assert.ok(
        finding.suppressionKey.length > 0,
        `${finding.check} arrived without a suppression key, so "Mark as intentional" would do nothing`,
      );
    }
  } finally {
    await h.client.stop();
  }
});

test('cross-file findings keep their related location', async () => {
  const h = harness();
  await h.client.start();
  try {
    const findings = await h.waitForFindings(7);
    const dead = findings.find((f) => f.check === 'deceased-active');
    assert.ok(dead, 'expected the deceased-active finding');
    assert.ok(dead.related.length > 0, 'it must point at where the death happens');
    assert.match(dead.related[0]!.path, /ch02\.md$/);
  } finally {
    await h.client.stop();
  }
});

test('the claim and its evidence are separated for display', async () => {
  const h = harness();
  await h.client.start();
  try {
    const findings = await h.waitForFindings(7);
    const withDetail = findings.filter((f) => f.detail);
    assert.ok(withDetail.length > 0, 'the server sends evidence; the client must not merge it into the claim');
    for (const finding of withDetail) {
      assert.ok(!finding.message.includes('\n'), 'the headline must be a single line');
    }
  } finally {
    await h.client.stop();
  }
});

test('an edit is reflected without restarting', async () => {
  const h = harness();
  await h.client.start();
  try {
    await h.waitForFindings(7);
    const before = h.findings().length;

    // Remove the misspelling planted in chapter two and confirm the finding clears.
    const ch02 = join(EXAMPLE, 'ch02.md');
    const original = readFileSync(ch02, 'utf8');
    h.client.didChange(ch02, original.split('Elana').join('Elena'), 2);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (!h.findings().some((f) => f.check === 'name-variant')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(
      !h.findings().some((f) => f.check === 'name-variant'),
      'fixing the typo should clear the finding without a restart',
    );
    assert.ok(h.findings().length < before);
  } finally {
    await h.client.stop();
  }
});

test('a missing server is reported rather than hanging', async () => {
  // A client that waits forever on a server that will never answer presents as an
  // editor that has quietly stopped working, which is the worst available outcome.
  const h = harness({ serverPath: 'prosebind-lsp-does-not-exist' });
  await h.client.start();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(h.status(), 'failed');
  await h.client.stop();
});
