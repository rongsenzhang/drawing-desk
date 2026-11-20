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
