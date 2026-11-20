import { listReceipts, MAX_FILE_SIZE, parseHandoff, receiveHandoff, TRANSFER_KEY } from './intake.mjs';

const form = document.querySelector('#intake-form');
const selector = document.querySelector('#handoff-file');
const submit = document.querySelector('#import-button');
const feedback = document.querySelector('#feedback');
const receipts = document.querySelector('#receipts');
const receiptCount = document.querySelector('#receipt-count');
let library;
let storage;
let transient = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function announce(text, kind = '') {
  feedback.textContent = text;
  feedback.className = kind === 'error' ? 'notice' : kind === 'success' ? 'notice ready' : 'subtext';
}

function configureStorage() {
  try {
    const persistent = window.localStorage;
    persistent.getItem('drawing-desk:estimating-inbox:v1:clean');
    return persistent;
  } catch {
    transient = true;
    const data = new Map();
    return {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
  }
}

function receivedEntry({ handoff, receivedAt }) {
  const entry = element('article', undefined, 'entry');
  const title = element('h3', handoff.rfqId);
  const timestamp = element('time', new Date(receivedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  timestamp.dateTime = receivedAt;
  const received = element('p', 'Received ', 'subtext');
  received.append(timestamp);
  const detail = element('details', undefined, 'source-detail');
  detail.append(element('summary', 'Review accepted evidence'));
  const fieldList = element('ul');
  for (const field of handoff.fields) {
    fieldList.append(element('li', field.label + ' · ' + field.effective + ' (' + field.effectiveSource + ')'));
  }
  detail.append(fieldList);
  if (handoff.decisions.length) {
    detail.append(element('h4', 'Reviewer decisions'));
    const audit = element('ol');
    for (const event of handoff.decisions) {
      const evidence = event.evidenceRef ? ' · ' + event.evidenceRef : '';
      audit.append(element('li', event.route + ' · ' + event.action + evidence + ' — ' + event.reason));
    }
    detail.append(audit);
  }
  entry.append(title, element('p', handoff.partName + ' · Quantity ' + handoff.requestedQuantity), received, detail);
  return entry;
}

function refreshReceipts() {
  const accepted = listReceipts(storage, library);
  receiptCount.textContent = String(accepted.length);
  receipts.replaceChildren(...accepted.map(receivedEntry));
  if (!accepted.length) receipts.append(element('p', 'Your first accepted handoff will appear here.', 'empty'));
}

async function accept(document) {
  let result;
  try {
    const save = () => receiveHandoff(document, library, storage);
    // Two tabs may import the same packet at once. Keep the first receipt.
    result = navigator.locks && !transient
      ? await navigator.locks.request('drawing-desk:estimating-inbox:v1', save)
      : save();
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.name === 'SecurityError') {
      throw new Error('The browser could not store this receipt. Free some browser storage or allow site storage, then retry.');
    }
    throw error;
  }
  refreshReceipts();
  const id = result.receipt.handoff.rfqId;
  let message = result.duplicate ? id + ' is already in the inbox. The original receipt was retained.'
    : id + ' accepted for estimating. Its source evidence and review history were checked.';
  if (transient) message += ' Browser storage is unavailable, so this receipt lasts for this visit.';
  announce(message, 'success');
}

async function loadLibrary() {
  const files = ['fixtures', 'observations', 'clauses', 'openai-readings'];
  const entries = await Promise.all(files.map(async name => {
    const response = await fetch(new URL('../data/' + name + '.json', import.meta.url));
    if (!response.ok) throw new Error('The ' + name + ' library could not be loaded.');
    return [name, await response.json()];
  }));
  const loaded = Object.fromEntries(entries);
  loaded.fixtures = loaded.fixtures.map(f => ({...f, modelReading: loaded['openai-readings'][f.id] || null}));
  return loaded;
}

async function receiveTransfer() {
  let transfer;
  try {
    transfer = sessionStorage.getItem(TRANSFER_KEY);
    if (transfer !== null) sessionStorage.removeItem(TRANSFER_KEY);
  } catch {
    announce('Direct transfer is unavailable in this browser. Import a downloaded handoff file instead.');
    return;
  }
  if (transfer === null) return;
  try {
    await accept(parseHandoff(transfer));
  } catch (error) {
    announce(error.message, 'error');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const file = selector.files[0];
  if (!file || !library) return;
  submit.disabled = true;
  try {
    if (file.size > MAX_FILE_SIZE) throw new Error('Choose a Drawing Desk JSON export smaller than 128 KiB.');
    await accept(parseHandoff(await file.text()));
    form.reset();
  } catch (error) {
    announce(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

try {
  library = await loadLibrary();
  storage = configureStorage();
  refreshReceipts();
  submit.disabled = false;
  announce(transient ? 'Browser storage is unavailable. Accepted handoffs will last for this visit.' : '');
  await receiveTransfer();
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith('drawing-desk:estimating-inbox:v1:')) refreshReceipts();
  });
} catch (error) {
  announce(error.message + ' Reload the page to try again.', 'error');
}
