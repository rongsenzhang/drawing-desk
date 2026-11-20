// Paid opt-in evaluation. Only checked-in synthetic scans may be sent by this script.
import { readFile, writeFile, rename, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { apiBase } from '../app/service-config.mjs';
const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const cases = await read('../data/fixtures.json');
const truth = await read('../tests/vision-labels.json');
const labels = {
  partId: 'PART ID',
  revision: 'REVISION',
  material: 'MATERIAL',
  finish: 'FINISH',
  spec: 'SPEC',
};
const save = async (path, obj) => {
  const dest = new URL(path, import.meta.url);
  const temp = new URL(dest.href + '.new');
  await writeFile(temp, JSON.stringify(obj, null, 2) + '\n');
  await rename(temp, dest);
};
const args = new Set(process.argv.slice(2));
const callModel = args.has('--run');
if (!callModel && !args.has('--check') && !args.has('--score')) {
  console.info(
    'Use --check for existing evidence. --run makes three paid requests for the bundled synthetic drawings and writes genuine responses.',
  );
  process.exit(0);
}
const readings = callModel && !args.has('--resume') ? {} : await read('../data/openai-readings.json');
if (callModel) {
  // Keep usable, non-sensitive partial results locally if a later request fails.
  const work = await mkdtemp(join(tmpdir(), 'drawing-desk-model-eval-'));
  for (const packet of cases) {
    const png = await readFile(new URL('../' + packet.scan, import.meta.url));
    const hash = createHash('sha256').update(png).digest('hex');
    if (readings[packet.id]?.inputSha256 === hash && readings[packet.id]?.model === 'gpt-6.2-astra') continue;
    const res = await fetch(apiBase + '/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://rongsenzhang.github.io' },
      signal: AbortSignal.timeout(125000),
      body: JSON.stringify({ image: 'data:image/png;base64,' + png.toString('base64') }),
    });
    const body = await res.json();
    if (
      !res.ok ||
      body.model !== 'gpt-6.2-astra' ||
      !Array.isArray(body.fields) ||
      body.fields.length !== 5
    ) {
      throw new Error(
        'Reader failed for ' +
          packet.id +
          ' (' +
          res.status +
          '): ' +
          (body.error || 'Incomplete result') +
          '. Earlier synthetic results, if any: ' +
          work,
      );
    }
    readings[packet.id] = { ...body, inputSha256: createHash('sha256').update(png).digest('hex') };
    await writeFile(join(work, packet.id + '.json'), JSON.stringify(readings[packet.id]));
    await save('../data/openai-readings.json', readings);
    console.info(packet.id + ': live response received');
  }
}
const recognised = await read('../data/observations.json');
const measurements = [];
for (const packet of cases) {
  const obs = readings[packet.id];
  if (!obs) throw new Error('No recorded model result for ' + packet.id);
  const input = await readFile(new URL('../' + packet.scan, import.meta.url));
  if (obs.inputSha256 !== createHash('sha256').update(input).digest('hex'))
    throw new Error('Image fingerprint mismatch: ' + packet.id);
  for (const [key, label] of Object.entries(labels)) {
    const expected = truth[packet.id].fields[label];
    const row = obs.fields.find((f) => f.key === key);
    const exact =
      expected === null
        ? row?.status === 'missing' && row.value === null
        : row?.status === 'read' && row.value === expected;
    const img = recognised[packet.id];
    const line = img.lines.find(line => line.text.startsWith(label + ':'));
    let boxContainsOcrCentre = null;
    if (expected !== null && line && row?.box) {
      const x = (line.x + line.width/2) * 1000/img.width;
      const y = (line.y + line.height/2) * 1000/img.height;
      const [l,t,r,b] = row.box;
      boxContainsOcrCentre = x >= l && x <= r && y >= t && y <= b;
    }
    measurements.push({
      boxContainsOcrCentre,
      case: packet.id,
      field: key,
      expected,
      observed: row?.value ?? null,
      status: row?.status ?? null,
      exact,
    });
  }
}
const report = {
  model: readings.clean.model,
  originals: cases.length,
  total: measurements.length,
  exact: measurements.filter((x) => x.exact).length,
  located: measurements.filter(x=>x.boxContainsOcrCentre === true).length,
  visible: measurements.filter(x=>x.expected !== null).length,
  observations: measurements,
  scope:
    'Three original synthetic stockroom plate scans from one fixed family. No measure of general drawing accuracy.',
};
console.info(
  JSON.stringify({
    model: report.model,
    originals: report.originals,
    exact: report.exact,
    total: report.total,
  }),
);
if (callModel || args.has('--score')) {
  if (callModel) await save('../data/openai-readings.json', readings);
  await save('../tests/openai-benchmark.json', report);
} else {
  const recorded = await read('../tests/openai-benchmark.json');
  if (JSON.stringify(report) !== JSON.stringify(recorded))
    throw new Error('Recorded report differs; inspect the evidence.');
}
