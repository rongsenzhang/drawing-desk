import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../service/worker.mjs';

const origin = 'https://rongsenzhang.github.io';
const host = 'https://reader.example';
const keys = ['partId', 'revision', 'material', 'finish', 'spec'];
const fixtureImage = 'data:image/png;base64,' +
  (await readFile(new URL('../assets/scans/clean.png', import.meta.url))).toString('base64');
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z';
const migration = await readFile(new URL('../service/schema.sql', import.meta.url), 'utf8');
const makeFields = () => Object.fromEntries(keys.map((key, i) => [key,
  i === 0 ? { status: 'read', value: 'ABC-001', evidence: 'PART ID ABC-001', box: [10, 20, 300, 90] } :
    { status: 'missing', value: null, evidence: null, box: null }]));
function complete(fields = makeFields()) {
  return Response.json({ status: 'completed', output: [{ type: 'reasoning' },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(fields) }] }] });
}

// The Worker runs its original SQL against an isolated SQLite database per
// test. The adapter supplies D1's batch/prepare API and transaction boundary.
function testDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  return {
    sqlite,
    prepare(sql) {
      return { sql, args: [], bind(...args) { return { sql, args }; },
        async first() { return sqlite.prepare(sql).get(); } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, args }) => {
          const statement = sqlite.prepare(sql);
          const parameters = Object.fromEntries(args.map((v, i) => ['?' + (i + 1), v]));
          if (sql.startsWith('SELECT')) return { success: true, results: statement.all(parameters), meta: { changes: 0 } };
          return { success: true, results: [], meta: { changes: Number(statement.run(parameters).changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK'); throw error;
      }
    },
  };
}

function setup({ fetcher, env = {}, clock } = {}) {
  const calls = [];
  const bindings = { OPENAI_API_KEY: 'test-secret-marker', DB: testDb(), ...env };
  const worker = createWorker({ now: clock || (() => Date.UTC(2026, 10, 20, 12)),
    fetcher: async (url, init) => { calls.push({ url, init }); return fetcher ? fetcher(url, init) : complete(); } });
  const route = (path, init = {}) => worker.fetch(new Request(host + path, init), bindings);
  const scan = (body = { image: fixtureImage }, headers = {}) => route('/api/read', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { bindings, calls, route, scan };
}

test('health reports only availability flags and does not call the model', async () => {
  const app = setup();
  for (const [key, database, expected] of [['configured', true, true], ['', true, false], ['configured', false, false]]) {
    app.bindings.OPENAI_API_KEY = key;
    app.bindings.DB = database ? testDb() : undefined;
    const result = await app.route('/api/health', { headers: { Origin: origin } });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { model: 'gpt-6.2-astra', configured: Boolean(key), quotaConfigured: database, ready: expected });
  }
  assert.equal(app.calls.length, 0);
});

test('accepted scans use the real Responses request shape with one image and a fixed schema', async () => {
  const app = setup();
  for (const image of [fixtureImage, jpeg]) {
    const response = await app.scan({ image });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result.fields.map(field => field.key), keys);
    assert.deepEqual(result.fields[0].box, [10, 20, 300, 90]);
    assert.equal(result.fields[0].value, 'ABC-001');
    const { url, init } = app.calls.at(-1);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer test-secret-marker');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-6.2-astra');
    assert.equal(body.reasoning.effort, 'high');
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.input, [{ role: 'user', content: [{ type: 'input_image', image_url: image, detail: 'high' }] }]);
    assert.deepEqual(body.text.format.schema.required, keys);
    assert.equal(body.text.format.strict, true);
  }
});

test('CORS allows the deployment and configured Pages origin, rejects other origins and methods', async () => {
  const app = setup({ env: { ALLOWED_ORIGIN: 'https://portfolio.example' } });
  const preflight = async (site, method = 'POST') => app.route('/api/read', { method: 'OPTIONS', headers: {
    Origin: site, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type' } });
  for (const site of [host, 'https://portfolio.example']) assert.equal((await preflight(site)).status, 204);
  for (const site of [origin, 'null', 'https://portfolio.example.attacker.example']) {
    const response = await preflight(site);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await preflight(host, 'DELETE')).status, 405);
  assert.equal((await app.route('/api/read')).status, 405);
  assert.equal((await app.route('/unknown')).status, 404);
  assert.equal(app.calls.length, 0);
});

test('rejects remote URLs, mismatched magic, invalid dimensions, prompts, malformed requests and oversize bodies before reserving', async () => {
  const app = setup();
  const badPng = Buffer.from(fixtureImage.split(',')[1], 'base64'); badPng.writeUInt32BE(10000, 16);
  for (const image of ['https://example.org/doc.png', fixtureImage.replace('image/png', 'image/jpeg'), 'data:image/png;base64,AAAA',
    'data:image/png;base64,' + badPng.toString('base64'), 'data:image/jpeg;base64,?-?']) {
    assert.equal((await app.scan({ image })).status, 400);
  }
  assert.equal((await app.scan({ image: fixtureImage, prompt: 'injected' })).status, 400);
  assert.equal((await app.scan({ image: fixtureImage }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await app.scan({ image: 'x'.repeat(5 * 1024 * 1024) })).status, 413);
  assert.equal((await app.route('/api/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal(app.calls.length, 0);
  assert.equal(app.bindings.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM scan_reservations').get().n, 0);
});

test('availability and quota configuration errors stop all outbound calls', async () => {
  for (const env of [{ OPENAI_API_KEY: '' }, { DB: undefined }, { DB: { async batch() { throw Error('secret details'); } } },
    { GLOBAL_DAILY_LIMIT: 'unlimited' }, { CLIENT_WINDOW_LIMIT: 2000 }]) {
    const app = setup({ env });
    const response = await app.scan();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /test-secret|secret details/);
    assert.equal(app.calls.length, 0);
  }
});

test('atomic reservations enforce both limits for concurrent valid requests and expire at their documented boundaries', async () => {
  let time = Date.UTC(2026, 10, 20, 12);
  const app = setup({ env: { GLOBAL_DAILY_LIMIT: 3, CLIENT_WINDOW_LIMIT: 1 }, clock: () => time });
  const run = ip => app.scan({ image: jpeg }, { 'CF-Connecting-IP': ip });
  const same = await Promise.all(Array.from({ length: 9 }, () => run('198.51.100.1')));
  assert.equal(same.filter(r => r.status === 200).length, 1);
  assert.equal(same.filter(r => r.status === 429).length, 8);
  assert.equal(same.find(r => r.status === 429).headers.get('Retry-After'), '600');
  time += 600000;
  assert.equal((await run('198.51.100.1')).status, 200);
  const different = await Promise.all(['2','3','4'].map(ip => run('198.51.100.' + ip)));
  assert.equal(different.filter(r => r.status === 200).length, 1);
  assert.equal(different.filter(r => r.status === 429).length, 2);
  assert.equal(app.calls.length, 3);
  const stored = app.bindings.DB.sqlite.prepare('SELECT * FROM scan_reservations').all();
  assert.equal(stored.length, 3);
  assert.ok(stored.every(row => /^[a-f0-9]{64}$/.test(row.client_hash)));
  time += 86400000;
  assert.equal((await run('198.51.100.1')).status, 200);
  assert.equal(app.bindings.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM scan_reservations').get().n, 1);
});

test('four simultaneous clients cannot overspend one remaining daily reservation', async () => {
  const app = setup({ env: { GLOBAL_DAILY_LIMIT: 1, CLIENT_WINDOW_LIMIT: 5 } });
  const responses = await Promise.all([1, 2, 3, 4].map(i => app.scan({ image: jpeg }, { 'CF-Connecting-IP': '192.0.2.' + i })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 429, 429, 429]);
  assert.equal(app.calls.length, 1);
});

test('incomplete, refused, malformed and contradictory model results never become valid readings', async () => {
  const invalid = [
    () => Response.json({ status: 'incomplete', output: [] }),
    () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }),
    () => complete({ revision: { value: 'B' } }),
    () => { const fields = makeFields(); fields.partId.box = [1002, 300, 500, 2000]; return complete(fields); },
    () => { const fields = makeFields(); fields.finish.value = 'inferred'; return complete(fields); },
  ];
  for (const fetcher of invalid) assert.equal((await setup({ fetcher }).scan()).status, 502);
  const app = setup({ fetcher: () => { const f = makeFields(); f.partId.evidence = 'unrelated'; return complete(f); } });
  const { fields } = await (await app.scan()).json();
  assert.equal(fields[0].status, 'uncertain'); assert.equal(fields[0].value, null);
  const noLocation = setup({ fetcher: () => { const f = makeFields(); f.partId.box = null; return complete(f); } });
  const unlocated = (await (await noLocation.scan()).json()).fields[0];
  assert.equal(unlocated.status, 'uncertain'); assert.equal(unlocated.value, null);
});

test('upstream errors are sanitised, timeouts surfaced and failed upstream attempts keep their reservation', async () => {
  const app = setup({ env: { CLIENT_WINDOW_LIMIT: 1 }, fetcher: () => new Response('test-secret-marker', { status: 401 }) });
  const result = await app.scan();
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /test-secret-marker|api\.openai/);
  assert.equal((await app.scan()).status, 429);
  const network = setup({ fetcher: () => { throw Error('test-secret-marker'); } });
  assert.equal((await network.scan()).status, 502);
  const timeout = setup({ fetcher: () => { throw new DOMException('private detail', 'TimeoutError'); } });
  assert.equal((await timeout.scan()).status, 504);
  for (const [upstream, expected] of [[403,503], [429,503], [500,502], [504,504]]) {
    const failed = setup({ fetcher: () => new Response('private upstream diagnostics', { status: upstream }) });
    const res = await failed.scan();
    assert.equal(res.status, expected);
    assert.doesNotMatch(await res.text(), /private upstream/);
  }
});
