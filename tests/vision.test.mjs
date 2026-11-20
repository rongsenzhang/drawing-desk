import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const observations = await read('../data/observations.json');
const labels = await read('./vision-labels.json');
const bench = await read('./vision-benchmark.json');

for (const [id, expected] of Object.entries(labels)) {
  test(id + ': recorded pixel observations, line locations and missing fields agree with the annotated sheet', () => {
    const obs = observations[id];
    const lines = obs.text.split('\n');
    assert.equal(obs.lines.length, lines.length);
    assert.equal(lines.length, Object.values(expected.fields).filter(Boolean).length);
    for (const [key, value] of Object.entries(expected.fields)) {
      const observed = lines.filter(s => s.startsWith(key + ':'));
      assert.deepEqual(observed, value ? [key + ': ' + value] : []);
    }
    for (const [i, line] of obs.lines.entries()) {
      assert.equal(line.text, lines[i]);
      assert.ok(line.confidence >= 0 && line.confidence <= 100);
      assert.ok(line.width > 0 && line.height > 0);
      assert.ok(line.x >= obs.ocrRegion.x && line.y >= obs.ocrRegion.y);
      assert.ok(line.x + line.width <= obs.ocrRegion.x + obs.ocrRegion.width);
      assert.ok(line.y + line.height <= obs.ocrRegion.y + obs.ocrRegion.height);
    }
    assert.deepEqual(obs.holes.map(({x,y}) => [x,y]), expected.centres);
  });
}

test('live benchmark records same-origin inference, raw field results and shape matches in six conditions', () => {
  const conditions = ['original','shifted','downsample-60','spec-erased','hole-erased','unseen-id'];
  assert.deepEqual(bench.externalRequests, []);
  assert.equal(bench.cases.length, 18);
  for (const id of Object.keys(labels)) {
    const rows = bench.cases.filter(row => row.id === id);
    assert.deepEqual(rows.map(row => row.variant), conditions);
    for (const row of rows) {
      assert.equal(row.fieldMatches.length, 5);
      assert.equal(row.extraCentres, 0);
      assert.equal(row.matchedCentres, row.referenceCentres);
      const baselineCount = labels[id].centres.length;
      assert.equal(row.referenceCentres, row.variant === 'hole-erased' ? baselineCount - 1 : baselineCount);
      if (row.variant !== 'downsample-60') assert.ok(row.fieldMatches.every(f => f.exact));
    }
  }
});
