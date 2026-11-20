import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzePacket, buildHandoff, recordDecision, searchClauses } from '../app/engine.mjs';

const load = f => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const clauses = load('../data/clauses.json');
const [revision, clean, missing] = load('../data/fixtures.json');
// These independent transcription fixtures exercise the interpretation layer.
// The separate browser validation performs recognition on the actual raster images.
const ocr = {
  revision: 'PART ID: PL-104\nREVISION: B\nMATERIAL: ALUMINIUM\nFINISH: NATURAL\nSPEC: WS-12',
  clean: 'PART ID: PL-208\nREVISION: A\nMATERIAL: ACRYLIC\nFINISH: MATTE\nSPEC: WS-12',
  missing: 'PART ID: PL-312\nREVISION: C\nMATERIAL: ACRYLIC\nFINISH: MATTE',
};
const analyse = (f, text = ocr[f.id], events = [], refs = clauses) => analyzePacket(f, text, refs, events);
const refer = { action: 'refer', route: 'Engineering', reason: 'The request and drawing revisions disagree.' };
const resolve = { action: 'resolve', route: 'Engineering', reason: 'Checked the customer reply against this enquiry and drawing.', evidenceRef: 'CL-104-02' };
const revisionIssue = 'field-revision';
function handleRevision() {
  const base = analyse(revision);
  const referral = recordDecision(base, revisionIssue, refer);
  const changes = recordDecision(analyse(revision, undefined, referral), revisionIssue, resolve);
  return analyse(revision, undefined, changes);
}

test('matched baseline retains all five observations plus ordered quantity and linked reference', () => {
  const result = analyse(clean);
  assert.equal(result.status, 'ready'); assert.equal(result.handoffAllowed, true);
  assert.equal(result.requestedQuantity, 12); assert.equal(result.counts.matched, 5);
  assert.equal(result.findings.length, 0); assert.deepEqual(result.clauses.map(c => c.id), ['WS-12']);
  assert.equal(result.fields.find(f => f.key === 'material').effective, 'ACRYLIC');
});

test('revisions are compared against separate RFQ and drawing, with routing evidence', () => {
  const result = analyse(revision);
  assert.equal(result.status, 'held');
  assert.equal(result.counts.findings, 1);
  const finding = result.findings[0];
  assert.equal(finding.id, revisionIssue); assert.equal(finding.route, 'Engineering');
  assert.deepEqual(finding.evidence.map(e => e.source), ['RFQ', 'Drawing OCR', 'Reference clause']);
  assert.deepEqual(finding.allowedActions, ['refer']);
  assert.equal(result.fields.find(f => f.key === 'revision').effective, '');
});

test('a missing drawing reference cannot be inferred from RFQ or search, even after referral', () => {
  const base = analyse(missing);
  assert.equal(base.findings.length, 1);
  assert.equal(base.findings[0].id, 'field-spec');
  assert.equal(base.fields.find(f => f.key === 'spec').drawing, '');
  assert.ok(searchClauses('WS-12', clauses).length);
  const referral = recordDecision(base, 'field-spec', { ...refer, route: 'Quality' });
  const held = analyse(missing, undefined, referral);
  assert.equal(held.status, 'held'); assert.deepEqual(held.findings[0].allowedActions, []);
  assert.throws(() => recordDecision(held, 'field-spec', { ...resolve, route: 'Quality' }), /controlled clarification/);
});

test('the parser handles colon-less or split label/value lines, casing and repeated whitespace', () => {
  const spaced = 'part   ID  PL-208\r\nrevision: \r\nA\r\nMaterial = acrylic\rFINISH   Matte\nSPEC: ws-12';
  assert.equal(analyse(clean, spaced).status, 'ready');
});

test('blank text, one missing source and duplicate contradictory readings produce holds', () => {
  assert.equal(analyse(clean, '').counts.unresolved, 5);
  const empty = analyse({ ...clean, rfqText: '' });
  assert.equal(empty.counts.unresolved, 6); assert.equal(empty.requestedQuantity, null);
  const duplicate = analyse(clean, ocr.clean + '\nFINISH: GLOSS');
  assert.equal(duplicate.findings[0].id, 'field-finish');
  assert.equal(duplicate.fields.find(f => f.key === 'finish').drawing, 'MATTE | GLOSS');
  assert.equal(analyse(clean, ocr.clean + '\nFINISH: matte').status, 'ready');
  const placeholders = analyse({ ...clean, rfqText: clean.rfqText.replace('MATTE', 'TBD') }, ocr.clean.replace('MATTE', 'TBD'));
  assert.equal(placeholders.status, 'held');
  assert.equal(placeholders.fields.find(f => f.key === 'finish').status, 'missing');
  assert.equal(placeholders.fields.find(f => f.key === 'finish').drawing, 'TBD');
  assert.equal(analyse(clean, ocr.clean.replace('ACRYLIC', '???')).fields.find(f => f.key === 'material').status, 'missing');
});

test('quantity must be one positive safe whole number in the original request', () => {
  for (const quantity of ['0', '-3', '1.5', '12 pcs', '9007199254740992', '12\nQuantity: 14']) {
    const out = analyse({ ...clean, rfqText: clean.rfqText.replace('QUANTITY: 12', 'QUANTITY: ' + quantity) });
    assert.equal(out.requestedQuantity, null); assert.equal(out.findings[0].id, 'request-quantity');
  }
});

test('retired, missing and wrong-purpose references block aligned source labels', () => {
  for (const id of ['WS-11', 'NO-REF', 'DC-03']) {
    const packet = { ...clean, rfqText: clean.rfqText.replace('WS-12', id) };
    const out = analyse(packet, ocr.clean.replace('WS-12', id));
    assert.equal(out.status, 'held');
    assert.equal(out.findings[0].id, 'spec-reference');
    assert.equal(out.fields.find(f => f.key === 'spec').effective, '');
  }
});

test('resolution requires a prior referral, the proper route, a recorded reason and a specific source', () => {
  const base = analyse(revision);
  assert.throws(() => recordDecision(base, revisionIssue, resolve), /Refer this finding/);
  assert.throws(() => recordDecision(base, revisionIssue, { ...refer, route: 'Quality' }), /Engineering/);
  assert.throws(() => recordDecision(base, revisionIssue, { ...refer, reason: 'ok' }), /reason/i);
  assert.throws(() => recordDecision(base, revisionIssue, { ...refer, evidenceRef: 'CL-104-02' }), /referral/);
  assert.throws(() => recordDecision(base, 'field-spec', refer), /does not belong/);
  const referred = analyse(revision, undefined, recordDecision(base, revisionIssue, refer));
  assert.equal(referred.status, 'held'); assert.equal(referred.findings[0].status, 'referred');
  assert.throws(() => recordDecision(referred, revisionIssue, refer), /Only an open/);
  assert.throws(() => recordDecision(referred, revisionIssue, { ...resolve, evidenceRef: 'WS-12' }), /controlled clarification/);
});

test('controlled confirmation releases the estimating handoff and preserves original evidence', () => {
  const out = handleRevision(); const field = out.fields.find(f => f.key === 'revision');
  assert.equal(out.status, 'ready'); assert.equal(out.findings[0].status, 'resolved');
  assert.deepEqual([field.request, field.drawing, field.effective, field.effectiveSource], ['A', 'B', 'B', 'CL-104-02']);
  assert.deepEqual(out.decisions.map(e => e.action), ['refer', 'resolve']);
  assert.equal(out.findings[0].evidence.at(-1).documentId, 'CL-104-02');
  assert.deepEqual(out.findings[0].allowedActions, []);
  assert.throws(() => { field.request = 'B'; }, TypeError);
  assert.throws(() => { out.decisions.push({}); }, TypeError);
  const handoff = buildHandoff(out);
  assert.equal(handoff.schema, 'drawing-desk/handoff'); assert.equal(handoff.schemaVersion, 1);
  assert.equal(handoff.packetId, 'revision'); assert.equal(handoff.documentType, 'estimating-handoff');
  assert.equal(handoff.evidence.find(e => e.source === 'RFQ').text, revision.rfqText);
  assert.equal(handoff.evidence.find(e => e.source === 'Drawing OCR').text, ocr.revision);
  handoff.fields[0].request = ''; assert.ok(out.fields[0].request);
  assert.equal(buildHandoff(analyse(revision)).documentType, 'clarification-draft');
});

test('wrong case, stale RFQ, changed OCR/library, out-of-order, invalid date and replay duplicates cannot recreate an old resolution', () => {
  const history = handleRevision().decisions;
  assert.equal(analyse(clean, undefined, history).ignoredDecisions, 2);
  const addedNote = { ...revision, rfqText: revision.rfqText + '\nNew customer note.' };
  assert.equal(analyse(addedNote, undefined, history).status, 'held');
  assert.equal(analyse(revision, ocr.revision + '\nREVISION B', history).ignoredDecisions, 2);
  const changedRefs = clauses.map(c => c.id === 'DC-03' ? { ...c, revision: '2' } : c);
  assert.equal(analyse(revision, undefined, history, changedRefs).ignoredDecisions, 2);
  assert.equal(analyse(revision, undefined, history.slice().reverse()).status, 'held');
  assert.equal(analyse(revision, undefined, [{ ...history[0], at: 'invalid' }, history[1]]).ignoredDecisions, 2);
  assert.equal(analyse(revision, undefined, [history[0], { ...history[1], at: '2020-01-02T12:34:56.000Z' }]).status, 'held');
  assert.equal(analyse(revision, undefined, [...history, ...history]).ignoredDecisions, 2);
  assert.equal(analyse(revision, undefined, [null]).ignoredDecisions, 1);
});

test('misbound, duplicated or unsupported clarification records cannot satisfy the review', () => {
  const c = revision.clarifications[0];
  for (const docs of [[{ ...c, rfqId: 'RFQ-208' }], [{ ...c, partId: 'PL-312' }],
    [{ ...c, value: 'Z' }], [{ ...c, route: 'Quality' }], [c, c], []]) {
    assert.deepEqual(analyse({ ...revision, clarifications: docs }).availableEvidence, []);
  }
  assert.deepEqual(analyse(revision, undefined, [], clauses.filter(c => c.id !== 'DC-03')).availableEvidence, []);
});

test('retrieval ranks matching terms, allows retired records, observes limits and abstains with no match', () => {
  assert.equal(searchClauses('WS-12', clauses, 1)[0].id, 'WS-12');
  assert.equal(searchClauses('WS-11', clauses, 1)[0].status, 'retired');
  assert.equal(searchClauses('reference missing specification', clauses, 1)[0].id, 'QR-05');
  assert.deepEqual(searchClauses('and for the', clauses), []);
  assert.deepEqual(searchClauses('unobtainium', clauses), []);
  assert.deepEqual(searchClauses('material', clauses, 0), []);
});

test('schema errors and invalid API arguments are rejected explicitly', () => {
  assert.throws(() => analyzePacket({}, '', clauses), TypeError);
  assert.throws(() => analyzePacket(revision, 42, clauses), TypeError);
  assert.throws(() => analyzePacket(revision, '', clauses, {}), TypeError);
  assert.throws(() => searchClauses({}, clauses), TypeError);
  assert.throws(() => searchClauses('x', clauses, -1), TypeError);
  assert.throws(() => searchClauses('x', [...clauses, clauses[0]]), TypeError);
  assert.throws(() => buildHandoff(null), TypeError);
});

test('the recorded browser OCR observations produce the three expected packet dispositions', () => {
  const observations = load('../data/observations.json');
  for (const [fixture, expectedFindings] of [[revision, ['field-revision']], [clean, []], [missing, ['field-spec']]]) {
    const observed = analyse(fixture, observations[fixture.id].text);
    assert.deepEqual(observed.findings.map(f => f.id), expectedFindings);
    assert.equal(observed.status, expectedFindings.length ? 'held' : 'ready');
  }
});
