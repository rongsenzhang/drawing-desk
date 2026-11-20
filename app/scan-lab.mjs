import { analyzePacket } from './engine.mjs';
import { recognizeScan } from './vision.mjs';

const byId = (id) => document.getElementById(id);
const form = byId('experiments');
const controls = form.querySelector('fieldset');
const runButton = byId('run');
const status = byId('activity');
const modeDescription = {
  original: 'Original matched drawing',
  'spec-erased': 'Specification line erased',
  'downsample-60': 'Downsampled to 60% in both directions',
};

let fixture, catalogue, originalReading, originalReview, originalImage;

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('The sample data could not be loaded.');
  return response.json();
}

function modifyScan(mode) {
  const scale = mode === 'downsample-60' ? 0.6 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(originalImage.naturalWidth * scale);
  canvas.height = Math.round(originalImage.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
  if (mode === 'spec-erased') {
    // Paint over the reference line in the image, keeping the input RFQ untouched.
    ctx.fillStyle = '#f9f8f2';
    ctx.fillRect(776, 411, 375, 50);
  }
  return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

function showGate(element, review) {
  element.textContent = review.handoffAllowed ? 'Ready for estimating' : 'Held for clarification';
  element.className = review.handoffAllowed ? 'ready' : 'held';
}

function showLiveResults(observation) {
  const review = analyzePacket(fixture, observation.text, catalogue);
  showGate(byId('live-gate'), review);
  const changedFields = review.fields.flatMap((field) => {
    const previous = originalReview.fields.find((row) => row.key === field.key);
    if (field.drawing === previous.drawing && field.status === previous.status) return [];
    return [
      field.label +
        ' changed from ' +
        (previous.drawing || 'unread') +
        ' to ' +
        (field.drawing || 'unread') +
        '.',
    ];
  });
  const issues = review.findings.map((finding) => finding.title + '.');
  byId('field-change').textContent = [
    ...(changedFields.length ? changedFields : ['All parsed drawing fields match the recorded original.']),
    ...issues,
  ].join(' ');
  byId('rings').textContent =
    'Detected rings in the plate view · Original ' +
    originalReading.holes.length +
    ' / live ' +
    observation.holes.length;
  byId('live-text').textContent = observation.text || 'No text recognised.';
}

async function run() {
  const mode = new FormData(form).get('mode');
  controls.disabled = true;
  runButton.disabled = true;
  const output = byId('live-text');
  const gate = byId('live-gate');
  gate.className = '';
  gate.textContent = 'Checking…';
  output.textContent = 'Reading the selected pixels…';
  byId('field-change').textContent = '';
  byId('rings').textContent = '';
  status.textContent = 'Loading the local recognition model…';
  try {
    const input = modifyScan(mode);
    byId('scan').src = input.url;
    byId('scan').alt = modeDescription[mode] + ' of a stockroom identification plate';
    byId('caption').textContent =
      modeDescription[mode] + ' · ' + input.width + ' × ' + input.height + ' px';
    const obs = await recognizeScan(input.url, {
      onProgress: (fraction) => {
        status.textContent = 'Reading scan · ' + Math.round(fraction * 100) + '%';
      },
    });
    showLiveResults(obs);
    status.textContent = 'Live reading complete.';
  } catch {
    gate.textContent = 'Reading unavailable';
    output.textContent = 'A live transcript could not be read.';
    status.textContent = 'Check the connection and retry the reading.';
  } finally {
    controls.disabled = false;
    runButton.disabled = false;
  }
}

async function initialize() {
  const [fixtures, observations, clauses] = await Promise.all([
    readJson('data/fixtures.json'),
    readJson('data/observations.json'),
    readJson('data/clauses.json'),
  ]);
  fixture = fixtures.find((record) => record.id === 'clean');
  originalReading = observations[fixture.id];
  catalogue = clauses;
  originalReview = analyzePacket(fixture, originalReading.text, catalogue);
  byId('baseline-text').textContent = originalReading.text;
  showGate(byId('baseline-gate'), originalReview);
  originalImage = new Image();
  originalImage.src = fixture.scan;
  await originalImage.decode();
  controls.disabled = false;
  await run();
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});
controls.addEventListener('change', run);
initialize().catch(() => {
  status.textContent = 'The sample could not be opened. Reload this page to try again.';
});
