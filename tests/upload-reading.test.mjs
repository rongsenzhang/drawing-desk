import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareField, imageHeader, keys, localFields, modelReading } from '../app/upload-reading.mjs';

const field = (text, key) => localFields(text).find(f => f.key === key);
const response = fields => ({ model: 'test-vision', readAt: '2026-11-20T12:30:00Z', fields });
const bytes = raw => Uint8Array.from(raw).buffer;

test('reads PNG, JPEG and three WebP headers before decode', () => {
  const image = readFileSync(new URL('../assets/scans/clean.png', import.meta.url));
  assert.deepEqual(imageHeader(image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)),
    { width: 1200, height: 720, type: 'image/png' });
  assert.deepEqual(imageHeader(bytes([255,216,255,224,0,4,0,0,255,192,0,7,8,0,5,0,7,255,217])),
    { width: 7, height: 5, type: 'image/jpeg' });
  const webp = Buffer.alloc(32); webp.write('RIFF'); webp.write('WEBP', 8);
  const parse = () => imageHeader(webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength));
  webp.write('VP8X', 12); webp[24] = 6; webp[27] = 4;
  assert.deepEqual(parse(), { width: 7, height: 5, type: 'image/webp' });
  webp.fill(0, 20); webp.write('VP8L', 12); webp[20] = 47; webp[21] = 6; webp[23] = 1;
  assert.deepEqual(parse(), { width: 7, height: 5, type: 'image/webp' });
  webp.fill(0, 20); webp.write('VP8 ', 12); webp.set([157,1,42,7,0,5,0], 23);
  assert.deepEqual(parse(), { width: 7, height: 5, type: 'image/webp' });
});

test('file content and dimensions bound allocation independent of external MIME and extension', () => {
  for (const b of [new ArrayBuffer(0), bytes([255,216,255,224,255,255]), new TextEncoder().encode('%PDF-1.7').buffer,
    new TextEncoder().encode('<svg width="10" height="10">').buffer]) assert.throws(() => imageHeader(b), /readable JPEG/);
  const oversized = new Uint8Array(24);
  oversized.set([137,80,78,71,13,10,26,10], 0); oversized.set([73,72,68,82], 12);
  const d = new DataView(oversized.buffer);
  d.setUint32(16, 22001); d.setUint32(20, 1); assert.throws(() => imageHeader(oversized.buffer), /too large/);
  d.setUint32(16, 9000); d.setUint32(20, 9000); assert.throws(() => imageHeader(oversized.buffer), /too large/);
});

test('whole-page label interpretation handles aliases, multiple columns, line splits, and disagreements', () => {
  assert.equal(field('P/N=WORK-3 | REV. B', 'partId').value, 'WORK-3');
  assert.equal(field('P/N=WORK-3 | REV. B', 'revision').value, 'B');
  assert.equal(field('FINISH:\nMATT', 'finish').value, 'MATT');
  assert.equal(field('PART ID:   REVISION: A', 'partId').status, 'missing');
  assert.equal(field('PART ID:   REVISION: A', 'revision').value, 'A');
  assert.equal(field('REVISION: A  REVISION: B', 'revision').status, 'uncertain');
  assert.equal(field('MATERIAL: TBD', 'material').status, 'missing');
  assert.equal(field('Specification: WS-44', 'spec').evidence, 'Specification: WS-44');
});

test('unreturned fields and unsupported evidence stay visible for review', () => {
  const output = modelReading(response([{ key: 'partId', status: 'read', value: 'P-1', evidence: ' PART ID P-1 ' },
    { key: 'revision', status: 'read', value: 'A', evidence: null }]));
  assert.deepEqual(output.fields.map(f => f.key), keys.map(k => k[0]));
  assert.equal(output.fields[0].evidence, 'PART ID P-1');
  assert.equal(output.fields[1].status, 'uncertain');
  assert.equal(output.fields[2].status, 'missing');
  for (const invalid of [null, {}, { ...response([]), readAt: 'not a timestamp' },
    response([{ key: 'revision', status: 'read', value: {}, evidence: 'Revision: 3' }]),
    response([{ key: 'revision', status: 'missing', value: null, evidence: null }, { key: 'revision' }])]) {
    assert.throws(() => modelReading(invalid));
  }
});

test('compares values and presence separately, retaining the human review gate', () => {
  const r = { value: 'A', status: 'read' };
  assert.equal(compareField(r, { value: 'a', status: 'read' })[0], 'match');
  assert.equal(compareField(r, { value: 'B', status: 'read' })[0], 'disagreement');
  assert.equal(compareField(r, { status: 'missing' })[0], 'disagreement');
  assert.equal(compareField({ status: 'uncertain' }, r)[0], 'review');
  assert.equal(compareField({ status: 'missing' }, { status: 'missing' })[0], 'review');
  assert.equal(compareField(null, r)[0], 'pending');
});
