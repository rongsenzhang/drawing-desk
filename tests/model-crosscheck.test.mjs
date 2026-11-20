import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzePacket } from '../app/engine.mjs';
import { crossCheckField } from '../app/model-crosscheck.mjs';
const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url)));
const packet = (await json('../data/fixtures.json')).find((item) => item.id === 'clean');
const sampleText = (await json('../data/observations.json')).clean.text;
const clauses = await json('../data/clauses.json');
const source = analyzePacket({ ...packet, modelReading: null }, sampleText, clauses);
const reading = {
  model: 'test-fixture',
  readAt: '2026-11-20T00:00:00Z',
  fields: source.fields.map((f) => ({
    key: f.key,
    value: f.drawing,
    evidence: f.label + ': ' + f.drawing,
    status: 'read',
    box: [200, 100, 400, 200],
  })),
};

test('a separately located reading corroborates OCR without erasing either original source', () => {
  const r = analyzePacket({ ...packet, modelReading: reading }, sampleText, clauses);
  assert.equal(r.status, 'ready');
  assert.ok(
    r.fields.every((f) => f.modelCheck.status === 'agrees' && f.evidence.at(-1).source === 'OpenAI vision'),
  );
});
test('a disagreement holds even when enquiry and OCR match', () => {
  const other = structuredClone(reading);
  other.fields[1].value = 'X';
  const r = analyzePacket({ ...packet, modelReading: other }, sampleText, clauses);
  assert.equal(r.status, 'held');
  assert.equal(r.findings[0].id, 'vision-revision');
  assert.equal(r.fields[1].effective, '');
});
test('absent locator, unreadable field, duplicate observation and unsupported quote each defer', () => {
  for (const patch of [{ box: null }, { status: 'uncertain' }, { evidence: 'Cannot locate line' }]) {
    const other = structuredClone(reading);
    Object.assign(other.fields[0], patch);
    assert.equal(crossCheckField(other, source.fields[0], source.fields[0].drawing).status, 'review');
  }
  const more = structuredClone(reading);
  more.fields.push({ ...more.fields[0] });
  assert.equal(crossCheckField(more, source.fields[0], source.fields[0].drawing).status, 'review');
});

test('recorded OpenAI readings agree with the located original fields and preserve the missing-spec hold', async () => {
  const fixtures = await json('../data/fixtures.json');
  const readings = await json('../data/openai-readings.json');
  const ocr = await json('../data/observations.json');
  for (const fixture of fixtures) {
    const r = analyzePacket({...fixture, modelReading:readings[fixture.id], ocrGeometry:ocr[fixture.id]}, ocr[fixture.id].text, clauses);
    for (const item of r.fields) {
      if (fixture.id === 'missing' && item.key === 'spec') assert.equal(item.modelCheck.status,'both-missing');
      else {
        assert.equal(item.modelCheck.status,'agrees');
        assert.equal(item.modelCheck.containsOcrCentre,true);
      }
    }
    assert.equal(r.handoffAllowed,fixture.id==='clean');
  }
});

test('a matching value with a misplaced model evidence box blocks the handoff', async () => {
  const originals = await json('../data/openai-readings.json');
  const geometry = (await json('../data/observations.json')).clean;
  const changed = structuredClone(originals.clean);
  changed.fields.find(f=>f.key==='material').box=[1,1,10,10];
  const result = analyzePacket({...packet,modelReading:changed,ocrGeometry:geometry}, sampleText, clauses);
  assert.equal(result.handoffAllowed,false);
  assert.equal(result.fields.find(f=>f.key==='material').modelCheck.containsOcrCentre,false);
  assert.ok(result.findings.some(f=>f.id==='vision-material'));
});
