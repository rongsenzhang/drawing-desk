import { analyzePacket, recordDecision, searchClauses, buildHandoff } from './engine.mjs';
import { recognizeScan } from './vision.mjs';

const $ = (selector) => document.querySelector(selector);
const escape = (value = '') =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safe = escape;
const dataUrl = (filename) => new URL('../data/' + filename, import.meta.url);
const initial = { source: 'drawing', view: 'compare', markers: true, field: null, search: '' };
const state = {
  ...initial,
  current: 'revision',
  history: {},
  live: {},
  progress: new Map(),
  errors: new Map(),
};
const storeKey = 'drawing-desk:review:v1';
let packets, observations, library, modelReadings, analysis;
let toastTimer;
const selected = () => packets.find((f) => f.id === state.current);
const observation = () => state.live[state.current] || observations[state.current];
const firstQuery = () => analysis.findings.find((f) => f.status !== 'resolved')?.title || 'specification';
const bool = (value) => (value ? 'true' : 'false');

async function loadFile(name) {
  const result = await fetch(dataUrl(name));
  if (!result.ok) throw Error('Could not load ' + name);
  return result.json();
}
function notify(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  toastTimer = setTimeout(() => {
    $('#toast').textContent = '';
  }, 4500);
}
function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(storeKey) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function saveHistory() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(state.history));
  } catch {
    notify('Review saved for this visit. Browser storage is unavailable.');
  }
}
function recompute() {
  const history = state.history[state.current];
  analysis = analyzePacket(selected(), observation().text, library, Array.isArray(history) ? history : []);
}
function choose(id, updateUrl = true) {
  if (!packets.some((p) => p.id === id)) id = 'revision';
  Object.assign(state, initial, { current: id });
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('case', id);
    history.replaceState(null, '', url);
  }
  render();
}
function buttonTabs(key, current, options) {
  return (
    '<div class="tabs" role="group" aria-label="' +
    (key === 'source' ? 'Source document' : 'Review section') +
    '">' +
    options
      .map(
        ([id, label]) =>
          '<button data-' +
          key +
          '="' +
          id +
          '" aria-pressed="' +
          bool(id === current) +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '</div>'
  );
}
function cases() {
  return packets
    .map(
      (p) =>
        '<button class="case" data-case="' +
        safe(p.id) +
        '" aria-pressed="' +
        bool(p.id === state.current) +
        '"><i class="case-icon" aria-hidden="true"></i><span><span class="case-id">' +
        safe(p.rfqId) +
        '</span><strong>' +
        safe(p.title) +
        '</strong></span><span class="case-check" aria-hidden="true">' +
        (p.id === state.current ? '✓' : '') +
        '</span></button>',
    )
    .join('');
}
function position(part, total) {
  return ((Math.max(0, Number(part) || 0) * 100) / Math.max(1, total)).toFixed(3) + '%';
}
function drawingBody() {
  const obs = observation(),
    f = selected();
  const field = analysis.fields.find((x) => x.key === state.field);
  let markers = '';
  if (state.markers) {
    markers = obs.holes
      .map(
        (h) =>
          '<i class="hit" style="left:' +
          position(h.x, obs.width) +
          ';top:' +
          position(h.y, obs.height) +
          ';width:' +
          position(h.r * 2.8, obs.width) +
          ';height:' +
          position(h.r * 2.8, obs.height) +
          '"></i>',
      )
      .join('');
  }
  if (field) {
    const tag = field.label.toUpperCase();
    for (const line of (obs.lines || []).filter((row) => row.text.toUpperCase().startsWith(tag))) {
      markers +=
        '<i class="line-box" style="left:' +
        position(line.x - 5, obs.width) +
        ';top:' +
        position(line.y - 4, obs.height) +
        ';width:' +
        position(line.width + 10, obs.width) +
        ';height:' +
        position(line.height + 8, obs.height) +
        '"></i>';
    }
  }
  return (
    '<div class="drawing-stage"><div class="sheet"><img src="' +
    safe(f.scan) +
    '" alt="Original training scan for ' +
    safe(f.rfqId) +
    ' showing a stockroom plate and its title block. Read the OCR transcript for text."><div aria-hidden="true">' +
    markers +
    '</div></div></div>' +
    '<div class="viewer-foot"><span>' +
    obs.width +
    ' × ' +
    obs.height +
    ' px · PNG</span><a href="' +
    safe(f.scan) +
    '" target="_blank" rel="noopener">Open full-size scan</a></div>'
  );
}
function viewer() {
  const f = selected(),
    obs = observation(),
    isBusy = state.progress.has(f.id);
  let content;
  if (state.source === 'drawing') content = drawingBody();
  if (state.source === 'enquiry') content = '<pre class="doc-text">' + safe(f.rfqText) + '</pre>';
  if (state.source === 'ocr')
    content = '<pre class="doc-text">' + safe(obs.text || '(No text detected)') + '</pre>';
  return (
    '<section class="panel" aria-labelledby="source-title"><div class="panel-head"><div class="stack"><p class="doc-id">' +
    safe(f.rfqId) +
    ' / SOURCE FILES</p><h2 id="source-title">Source viewer</h2></div><span class="mini">2 documents</span></div>' +
    buttonTabs('source', state.source, [
      ['drawing', 'Drawing'],
      ['enquiry', 'Enquiry'],
      ['ocr', 'OCR transcript'],
    ]) +
    content +
    '<div class="control-row"><button class="secondary" data-run ' +
    (isBusy ? 'disabled' : '') +
    '>' +
    (isBusy ? 'Recognising…' : 'Rerun recognition') +
    '</button><label><input id="markers" type="checkbox" ' +
    (state.markers ? 'checked' : '') +
    '>Mark detected holes (' +
    obs.holes.length +
    ')</label></div>' +
    '<p id="ocr-status" class="obs-note" aria-live="polite">' +
    safe(
      state.errors.get(f.id) ||
        (isBusy
          ? 'Reading this scan…'
          : state.live[f.id]
            ? 'Live OCR completed in this browser.'
            : 'Showing a saved reading from the same OCR model.'),
    ) +
    '</p>' +
    (fieldNote() ? '<div class="viewer-actions">' + fieldNote() + '</div>' : '') +
    '<div class="viewer-actions"><a class="button" href="upload.html?sample=' +
    safe(f.id) +
    '">Read with OpenAI</a><p class="subtext">Compare this scan with an independent model reading or <a href="scan-lab.html">try a changed scan</a>.</p></div></section>'
  );
}
function fieldNote() {
  const field = analysis.fields.find((f) => f.key === state.field);
  if (!field) return '';
  return (
    '<strong>' +
    safe(field.label) +
    ' evidence</strong>' +
    field.evidence
      .map(
        (e) =>
          '<p class="subtext"><span class="small-code">' +
          safe(e.source) +
          '</span> · ' +
          safe(e.text) +
          '</p>',
      )
      .join('')
  );
}
function comparison() {
  const rows = analysis.fields
    .map((f) => {
      const disputed = ['missing', 'conflict', 'resolved'].includes(f.status);
      const cell = (v) =>
        '<span><code class="' +
        (disputed ? 'discrep' : '') +
        '">' +
        safe(v || 'Not found') +
        '</code></span>';
      return (
        '<div class="field-grid field-row"><span><button data-field="' +
        safe(f.key) +
        '" class="field-lookup" title="Locate source evidence">' +
        safe(f.label) +
        '</button></span>' +
        cell(f.request) +
        cell(f.drawing) +
        '</div>' +
        (f.status === 'resolved'
          ? '<p class="effective">Effective value ' +
            safe(f.effective) +
            ' · ' +
            safe(f.effectiveSource) +
            '</p>'
          : '')
      );
    })
    .join('');
  return (
    '<div class="notice ' +
    analysis.status +
    '">' +
    safe(analysis.summary) +
    '</div><div class="field-grid field-head"><span>Field</span><span>Enquiry</span><span>Drawing OCR</span></div>' +
    rows +
    '<p class="mini">Select a field to locate its source evidence.</p>' +
    modelReference() +
    analysis.findings.map(findingCard).join('')
  );
}
function findingCard(f) {
  const action = f.allowedActions?.[0];
  const docs = analysis.availableEvidence.filter((d) => d.findingId === f.id);
  const actionTitle = action === 'resolve' ? 'Record clarification' : 'Refer to ' + f.route;
  const referenceInput =
    action === 'resolve'
      ? '<label>Customer response<select required name="evidenceRef"><option value="">Choose a response</option>' +
        docs
          .map((d) => '<option value="' + safe(d.id) + '">' + safe(d.id + ' · ' + d.title) + '</option>')
          .join('') +
        '</select></label>'
      : '';
  const form = action
    ? '<form class="reason-form" data-finding="' +
      safe(f.id) +
      '" data-action="' +
      safe(action) +
      '">' +
      referenceInput +
      '<label>Review note<textarea name="reason" required minlength="10" maxlength="1000" placeholder="' +
      (action === 'refer'
        ? 'Explain what the reviewer needs to verify.'
        : 'Explain which evidence supports the decision.') +
      '"></textarea></label><button class="primary" type="submit">' +
      safe(actionTitle) +
      '</button><p class="err" role="alert"></p></form>'
    : '';
  return (
    '<article class="exception ' +
    safe(f.status) +
    '"><span class="label">' +
    safe(f.status + ' · ' + f.route) +
    '</span><h3>' +
    safe(f.title) +
    '</h3><p>' +
    safe(f.detail) +
    '</p>' +
    '<details><summary>View supporting evidence</summary>' +
    f.evidence
      .map(
        (e) =>
          '<div class="evidence-item"><span class="mini">' +
          safe(e.source + ' · ' + e.documentId) +
          '</span><p>' +
          safe(e.text) +
          '</p></div>',
      )
      .join('') +
    '</details>' +
    (f.status === 'referred' && docs.length
      ? docs
          .map(
            (d) =>
              '<div class="evidence-item"><strong>' +
              safe(d.id + ' · Customer response') +
              '</strong><p>' +
              safe(d.text) +
              '</p></div>',
          )
          .join('')
      : '') +
    (f.status === 'referred' && !docs.length
      ? '<p><strong>Awaiting a source document.</strong> This sample contains no customer response for this finding.</p>'
      : '') +
    (f.status === 'resolved' ? '<p><strong>Decision</strong> · ' + safe(f.decision.reason) + '</p>' : '') +
    form +
    '</article>'
  );
}
function referenceItems() {
  const query = state.search,
    active = query.trim();
  const found = active ? searchClauses(query, library) : library;
  return found.length
    ? found
        .map(
          (c) =>
            '<article class="ref-item"><span class="mini">' +
            safe(c.id + ' / Revision ' + c.revision + ' / ' + c.status) +
            '</span><h3>' +
            safe(c.title) +
            '</h3><p>' +
            safe(c.text) +
            '</p></article>',
        )
        .join('')
    : '<p class="empty">No matching clause in the sample library.</p>';
}
function referenceView() {
  return (
    '<label class="search-label" for="clause-search">Search the synthetic reference library</label><input class="ref-input" id="clause-search" type="search" placeholder="Try revision, finish or WS-12" value="' +
    safe(state.search) +
    '"><div id="ref-results">' +
    referenceItems() +
    '</div>'
  );
}
function logView() {
  const events = analysis.decisions
    .map(
      (d) =>
        '<article class="audit-item"><span class="mini">' +
        safe(new Date(d.at).toLocaleString()) +
        '</span><h3>' +
        safe(d.action === 'refer' ? 'Referred to ' + d.route : 'Clarification recorded') +
        '</h3><p>' +
        safe(d.reason) +
        '</p>' +
        (d.evidenceRef ? '<p class="small-code">' + safe(d.evidenceRef) + '</p>' : '') +
        '</article>',
    )
    .join('');
  return (
    '<h3>Review log</h3>' +
    (events || '<p class="empty">No decisions recorded for this packet.</p>') +
    (analysis.ignoredDecisions
      ? '<p class="notice">Earlier decisions did not match the current evidence and have been excluded.</p>'
      : '') +
    (events || analysis.ignoredDecisions
      ? '<details><summary>Restart this practice packet</summary><p class="subtext">Clear this packet’s saved review decisions on this browser.</p><button class="secondary" data-restart>Clear this packet’s log</button></details>'
      : '')
  );
}
function modelReference() {
  const reading = selected().modelReading;
  if (!reading)
    return '<p class="mini">This packet uses the recorded OCR reading. Choose Read with OpenAI for a live second read.</p>';
  return (
    '<details class="source-detail"><summary>OpenAI cross-check · ' +
    safe(reading.model) +
    '</summary><p class="mini">Separate reading of the original scan · ' +
    safe(reading.readAt) +
    '</p>' +
    analysis.fields
      .map(
        (f) =>
          '<p class="subtext"><strong>' +
          safe(f.label) +
          '</strong> · ' +
          safe(f.modelCheck.value ?? 'No value') +
          ' · ' +
          safe(f.modelCheck.status) +
          (f.modelCheck.evidence ? ' · ' + safe(f.modelCheck.evidence) : '') +
          '</p>',
      )
      .join('') +
    '</details>'
  );
}
function review() {
  const text =
    state.view === 'compare' ? comparison() : state.view === 'reference' ? referenceView() : logView();
  return (
    '<section class="panel" aria-labelledby="review-title"><div class="panel-head"><div class="stack"><p class="doc-id">QTY ' +
    safe(analysis.requestedQuantity ?? '—') +
    ' / ' +
    safe(analysis.rfqId) +
    '</p><h2 id="review-title">Evidence review</h2></div><span class="tag ' +
    analysis.status +
    '">' +
    (analysis.handoffAllowed ? 'Ready for estimating' : 'On hold') +
    '</span></div>' +
    buttonTabs('view', state.view, [
      ['compare', 'Requirements'],
      ['reference', 'References'],
      ['log', 'Review log'],
    ]) +
    '<div class="tabbody">' +
    text +
    '</div></section>'
  );
}
function transfer() {
  const ready = analysis.handoffAllowed;
  return (
    '<section class="handoff" aria-labelledby="export-title"><div><h2 id="export-title">' +
    (ready ? 'Estimating handoff' : 'Clarification draft') +
    '</h2><p>' +
    (ready
      ? 'Send the checked requirements and their source trail to the sample inbox.'
      : 'The draft carries the open findings. Estimating intake stays on hold.') +
    '</p></div><div class="actions"><button class="secondary" data-download>Download JSON</button><button class="primary" data-transfer>Open in inbox</button></div></section>'
  );
}
function render() {
  recompute();
  $('#cases').innerHTML = cases();
  $('#board').innerHTML = '<div class="board-grid">' + viewer() + review() + '</div>' + transfer();
}
function download() {
  const doc = buildHandoff(analysis);
  const link = document.createElement('a'),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' }),
    );
  link.href = url;
  link.download = analysis.rfqId + '-' + doc.documentType + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function runOcr() {
  const f = selected();
  if (state.progress.size) {
    notify('Recognition is already running.');
    return;
  }
  state.progress.set(f.id, 0);
  state.errors.delete(f.id);
  render();
  try {
    const reading = await recognizeScan(f.scan, {
      onProgress: (p) => {
        state.progress.set(f.id, p);
        if (state.current === f.id)
          $('#ocr-status').textContent = 'Reading the title block… ' + Math.round(100 * p) + '%';
      },
    });
    state.live[f.id] = reading;
  } catch {
    state.errors.set(
      f.id,
      'Live recognition could not finish. The previous OCR reading is still available. Check your connection and retry.',
    );
  } finally {
    state.progress.delete(f.id);
    if (state.current === f.id) {
      render();
      notify(state.errors.has(f.id) ? 'Recognition could not finish.' : 'Live recognition complete.');
    }
  }
}
function guideEvents() {
  document.querySelector('[data-guide]').addEventListener('click', () => $('#guide').showModal());
  $('#guide').addEventListener('click', (e) => {
    if (e.target === $('#guide') || e.target.closest('[data-close]')) $('#guide').close();
  });
}
guideEvents();
try {
  [packets, observations, library, modelReadings] = await Promise.all(
    ['fixtures.json', 'observations.json', 'clauses.json', 'openai-readings.json'].map(loadFile),
  );
  packets = packets.map((f) => ({ ...f, modelReading: modelReadings[f.id] || null }));
  state.history = readHistory();
  choose(new URL(location.href).searchParams.get('case'), false);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.case) {
      choose(btn.dataset.case);
      $('#cases [aria-pressed="true"]').focus({ preventScroll: true });
      return;
    }
    if (btn.dataset.source) {
      state.source = btn.dataset.source;
      render();
      document.querySelector('[data-source="' + state.source + '"]').focus({ preventScroll: true });
    }
    if (btn.dataset.view) {
      state.view = btn.dataset.view;
      if (state.view === 'reference' && !state.search) state.search = firstQuery();
      render();
      document.querySelector('[data-view="' + state.view + '"]').focus({ preventScroll: true });
    }
    if (btn.dataset.field) {
      state.field = btn.dataset.field;
      state.source = 'drawing';
      render();
      const panel = $('#source-title').closest('.panel');
      if (matchMedia('(max-width: 750px)').matches) panel.scrollIntoView({ block: 'start' });
      notify('Located ' + analysis.fields.find((f) => f.key === state.field).label + ' source evidence.');
    }
    if (btn.hasAttribute('data-restart')) {
      const saved = readHistory();
      state.history = { ...saved, [state.current]: [] };
      saveHistory();
      state.view = 'compare';
      render();
      notify('This practice packet has been reset.');
    }
    if (btn.hasAttribute('data-run')) runOcr();
    if (btn.hasAttribute('data-download')) download();
    if (btn.hasAttribute('data-transfer')) {
      try {
        sessionStorage.setItem('drawing-desk:transfer:v1', JSON.stringify(buildHandoff(analysis)));
        location.assign('inbox.html');
      } catch {
        notify('Download the JSON and import it from the estimating inbox.');
      }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'markers') {
      state.markers = e.target.checked;
      render();
      $('#markers').focus({ preventScroll: true });
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'clause-search') {
      state.search = e.target.value;
      $('#ref-results').innerHTML = referenceItems();
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-finding]');
    if (!form) return;
    e.preventDefault();
    const values = new FormData(form);
    try {
      const latest = readHistory();
      if (latest[state.current]?.length > (state.history[state.current]?.length || 0))
        state.history[state.current] = latest[state.current];
      state.history = { ...latest, ...state.history };
      recompute();
      const issue = analysis.findings.find((f) => f.id === form.dataset.finding);
      state.history[state.current] = recordDecision(analysis, issue.id, {
        action: form.dataset.action,
        route: issue.route,
        reason: String(values.get('reason') ?? ''),
        evidenceRef: String(values.get('evidenceRef') ?? ''),
      });
      saveHistory();
      render();
      notify(form.dataset.action === 'resolve' ? 'Clarification recorded.' : 'Referral recorded.');
    } catch (error) {
      form.querySelector('.err').textContent = error.message;
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === storeKey) {
      state.history = readHistory();
      render();
    }
  });
} catch (error) {
  $('#board').innerHTML =
    '<p class="notice">The workspace could not load its sample files. Reload the page to try again.</p>';
  console.error(error);
}
