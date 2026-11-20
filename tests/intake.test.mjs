import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzePacket, buildHandoff, recordDecision } from '../app/engine.mjs';
import { listReceipts, MAX_FILE_SIZE, parseHandoff, receiveHandoff, verifyHandoff } from '../app/intake.mjs';

const names = ['fixtures', 'clauses', 'observations'];
const library = Object.fromEntries(await Promise.all(names.map(async name => [
  name, JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url), 'utf8')),
])));

function analysis(id, decisions = []) {
  const fixture = library.fixtures.find(item => item.id === id);
  return analyzePacket(fixture, library.observations[id].text, library.clauses, decisions);
}

function clarifiedExport() {
  let reviewed = analysis('revision');
  const finding = reviewed.findings.find(row => row.fieldKey === 'revision');
  const referral = recordDecision(reviewed, finding.id, {
    action: 'refer', route: finding.route, reason: 'The original enquiry and the drawing show different revisions.',
  });
  reviewed = analysis('revision', referral);
  const decisions = recordDecision(reviewed, finding.id, {
    action: 'resolve', route: finding.route, evidenceRef: reviewed.availableEvidence[0].id,
    reason: 'The customer’s written response confirms the revision to use.',
  });
  return buildHandoff(analysis('revision', decisions));
}

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test('accepts the ordinary clean JSON export with reordered object keys', () => {
  const ready = buildHandoff(analysis('clean'));
  const reordered = Object.fromEntries(Object.entries(ready).reverse());
  assert.deepEqual(verifyHandoff(parseHandoff(JSON.stringify(reordered)), library), ready);
});

test('replays an actual referral and customer clarification before accepting the revised value', () => {
  const verified = verifyHandoff(clarifiedExport(), library);
  assert.equal(verified.fields.find(row => row.key === 'revision').effective, 'B');
  assert.equal(verified.decisions.at(-1).evidenceRef, 'CL-104-02');
});

test('rejects genuine clarification drafts and drafts merely relabelled as ready', () => {
  for (const id of ['missing', 'revision']) {
    const draft = buildHandoff(analysis(id));
    assert.throws(() => verifyHandoff(draft, library), /clarification draft/);
    Object.assign(draft, { status: 'ready', documentType: 'estimating-handoff' });
    assert.throws(() => verifyHandoff(draft, library), /unresolved/);
  }
});

test('rejects edits to quantities, effective fields, evidence, clauses, versions and summaries', () => {
  const clean = buildHandoff(analysis('clean'));
  const mutations = [
    doc => { doc.requestedQuantity += 1; },
    doc => { doc.rfqId = 'OTHER'; },
    doc => { doc.fields[0].effective = 'OTHER'; },
    doc => { doc.evidence[1].text += ' modified'; },
    doc => { doc.clauses[0].revision = 'X'; },
    doc => { doc.evidenceVersion += 'X'; },
    doc => { doc.summary = 'Approved for manufacture'; },
    doc => { doc.extra = true; },
  ];
  for (const alter of mutations) {
    const altered = structuredClone(clean);
    alter(altered);
    assert.throws(() => verifyHandoff(altered, library), /differs/);
  }
});

test('rejects a disappeared, invented or mis-scoped decision', () => {
  const original = clarifiedExport();
  for (const alter of [
    doc => { doc.decisions = []; },
    doc => { doc.decisions[1].evidenceRef = 'invented'; },
    doc => { doc.decisions[0].route = 'Quality'; },
    doc => { doc.decisions[0].at = 'yesterday'; },
    doc => { doc.decisions.reverse(); },
  ]) {
    const altered = structuredClone(original);
    alter(altered);
    assert.throws(() => verifyHandoff(altered, library), /replayed|unresolved/);
  }
});

test('rejects unrecognised versions, unknown packets, malformed and oversized files', () => {
  const sample = buildHandoff(analysis('clean'));
  assert.throws(() => verifyHandoff({ ...sample, schemaVersion: 2 }, library), /version 1/);
  assert.throws(() => verifyHandoff({ ...sample, packetId: 'unlisted' }, library), /outside/);
  assert.throws(() => verifyHandoff(null, library), /version 1/);
  assert.throws(() => parseHandoff('{broken'), /as JSON/);
  assert.throws(() => parseHandoff(' '.repeat(MAX_FILE_SIZE + 1)), /128 KiB/);
  assert.deepEqual(parseHandoff('\uFEFF{}'), {});
});

test('retains the first receipt, ignores unrelated storage and writes no receipt on failed intake', () => {
  const storage = memoryStorage();
  storage.setItem('unrelated-site-key', 'unchanged');
  const clean = buildHandoff(analysis('clean'));
  const when = () => new Date('2026-11-01T12:00:00Z');
  const first = receiveHandoff(clean, library, storage, when);
  assert.equal(first.duplicate, false);
  const repeated = receiveHandoff(clean, library, storage);
  assert.equal(repeated.duplicate, true);
  assert.deepEqual(first.receipt, repeated.receipt);
  assert.throws(() => receiveHandoff({ ...clean, requestedQuantity: -1 }, library, storage), /differs/);
  assert.equal(storage.getItem('unrelated-site-key'), 'unchanged');
  assert.equal(storage.data.size, 2);
  assert.deepEqual(listReceipts(storage, library), [first.receipt]);
});

test('revalidates persisted entries and restores a corrupted receipt from a valid import', () => {
  const storage = memoryStorage();
  const clean = buildHandoff(analysis('clean'));
  const { receipt } = receiveHandoff(clean, library, storage);
  const [key] = storage.data.keys();
  receipt.handoff.requestedQuantity *= 100;
  storage.setItem(key, JSON.stringify(receipt));
  assert.deepEqual(listReceipts(storage, library), []);
  assert.equal(receiveHandoff(clean, library, storage).duplicate, false);
  assert.deepEqual(listReceipts(storage, library)[0].handoff, clean);
});
