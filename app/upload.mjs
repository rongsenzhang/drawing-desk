import { apiBase } from './service-config.mjs';
import { keys, localFields, modelReading, compareField, imageHeader, maxInputBytes, maxOutputBytes } from './upload-reading.mjs';

const el = id => document.getElementById(id);
const state = {
  version: 0, original: null, name: '', rotation: 0, prepared: null, url: '', local: null, remote: null,
  localJob: null, remoteJob: null, camera: null, cameraEpoch: 0, cameraPending: false, preparing: false,
  pdf: null, pdfLoad: null, pageRender: null, page: 1, located: null,
};
const set = (id, text) => { el(id).textContent = text; };
const httpMessage = status => ({
  400: 'The service could not read this image. Try a clear photo of one page.',
  401: 'The hosted OpenAI service is unavailable. You can still run browser OCR.',
  403: 'The hosted OpenAI service could not authorise this request. You can still use browser OCR.',
  404: 'The OpenAI image service is unavailable at this address. Browser OCR is available.',
  413: 'The image exceeded the service size limit. Try cropping it to one drawing.',
  415: 'The service could not accept this image format. Select a JPEG, PNG or WebP.',
  429: 'The demo has reached a usage limit. Try later or use browser OCR.',
  502: 'The model could not return a usable reading. Try later or use browser OCR.',
  503: 'The hosted OpenAI service is unavailable. Try later or use browser OCR.',
  504: 'The image service timed out. Try later or use browser OCR.',
})[status] || 'The OpenAI request failed. Try later or use browser OCR.';

function syncControls() {
  const ready = Boolean(state.prepared) && !state.preparing;
  el('run-local').disabled = !ready || Boolean(state.localJob);
  el('run-model').disabled = !ready || Boolean(state.remoteJob);
  el('rotate').disabled = !ready;
  el('clear').disabled = !state.original && !state.preparing;
  el('camera-start').disabled = Boolean(state.camera) || state.cameraPending;
}

function stopCamera() {
  state.cameraEpoch++; state.cameraPending = false;
  state.camera?.getTracks().forEach(track => track.stop());
  state.camera = null;
  el('camera-video').srcObject = null;
  el('camera-shot').disabled = true;
  el('live-camera').hidden = true;
  syncControls();
}

function discardReadings() {
  state.version++;
  state.remoteJob?.abort();
  state.localJob?.abort();
  state.remoteJob = null; state.localJob = null;
  state.local = null; state.remote = null; state.prepared = null;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = '';
  el('preview').removeAttribute('src'); el('preview').hidden = true; el('preview-frame').hidden = true; el('empty-image').hidden = false;
  hideBox();
  set('results', ''); set('source-summary', ''); set('local-status', ''); set('model-status', '');
  set('transcript', 'Run browser OCR to view the source text.');
  syncControls();
}

function drawImage(source, width, height, rotation = 0, scale = 1) {
  const canvas = document.createElement('canvas');
  const turn = rotation % 2 === 1;
  canvas.width = Math.max(1, Math.round((turn ? height : width) * scale));
  canvas.height = Math.max(1, Math.round((turn ? width : height) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not open an image canvas.');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rotation * Math.PI / 2);
  const w = turn ? canvas.height : canvas.width, h = turn ? canvas.width : canvas.height;
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return canvas;
}

const jpeg = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob(result => {
  if (result && result.type === 'image/jpeg') resolve(result);
  else reject(new Error('This browser could not prepare a JPEG preview.'));
}, 'image/jpeg', quality));

function closePdf() {
  state.pdfLoad?.abort(); state.pageRender?.abort(); state.pdf?.destroy();
  state.pdfLoad = null; state.pageRender = null; state.pdf = null; state.page = 1;
  el('pdf-controls').hidden = true; el('pdf-page').replaceChildren(); set('pdf-count', '');
}

async function presentRaster(source, width, height, rotation, name, version) {
  let scale = Math.min(1, 2200 / Math.max(width, height)), canvas, blob;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (version !== state.version) return;
    canvas = drawImage(source, width, height, rotation, scale);
    blob = await jpeg(canvas, attempt ? .73 : .87);
    if (blob.size <= maxOutputBytes) break;
    scale *= .75;
  }
  if (blob.size > maxOutputBytes) throw new Error('The prepared image still exceeds 1 MiB. Crop to the relevant area and retry.');
  if (version !== state.version) return;
  state.prepared = blob; state.url = URL.createObjectURL(blob);
  const preview = el('preview'); preview.src = state.url; preview.hidden = false;
  el('empty-image').hidden = true; el('preview-frame').hidden = false;
  set('file-caption', `${name} · ${canvas.width} × ${canvas.height} px · prepared JPEG · ${Math.ceil(blob.size / 1024)} KiB`);
  set('local-status', 'Ready for local reading.'); set('model-status', 'Ready to send when you choose.');
}

async function selectPage(number, rotation = 0) {
  if (!state.pdf) return;
  const pdf = state.pdf;
  state.pageRender?.abort();
  const controller = new AbortController(); state.pageRender = controller;
  discardReadings(); set('image-error', ''); state.preparing = true; state.rotation = rotation; state.page = number;
  const version = state.version;
  set('file-caption', 'Rendering the selected PDF page on this device…'); syncControls();
  let canvas;
  try {
    canvas = await pdf.render(number, controller.signal);
    if (state.version !== version) return;
    await presentRaster(canvas, canvas.width, canvas.height, rotation, `${state.name} · page ${number} of ${pdf.count}`, version);
  } catch (error) {
    if (state.version !== version) return;
    set('file-caption', 'No PDF page ready.'); set('image-error', /PDF page|too long|1 MiB/.test(error.message) ? error.message : 'This PDF page could not be rendered. Choose another page or export it as an image.');
  } finally {
    if (canvas) canvas.width = canvas.height = 1;
    if (state.version === version) { state.preparing = false; state.pageRender = null; syncControls(); }
  }
}

async function prepare(file, name, rotation = 0) {
  closePdf(); stopCamera(); set('camera-status', ''); set('image-error', ''); discardReadings();
  state.original = file; state.name = name; state.rotation = rotation; state.preparing = true;
  const version = state.version;
  set('file-caption', 'Preparing the image on this device…'); syncControls();
  let sourceUrl;
  try {
    if (!file?.size || file.size > maxInputBytes) throw new Error('Choose a non-empty file no bigger than 12 MiB.');
    const data = await file.arrayBuffer();
    if (version !== state.version) return;
    const beginsPdf = String.fromCharCode(...new Uint8Array(data, 0, Math.min(5, data.byteLength))) === '%PDF-';
    if (beginsPdf || file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
      if (!beginsPdf) throw new Error('This PDF has an unsupported file header. Choose a readable PDF or an image.');
      const ctrl = new AbortController(); state.pdfLoad = ctrl;
      const {openPdf} = await import('./upload-pdf.mjs');
      if (version !== state.version) return;
      const pdf = await openPdf(data, ctrl.signal);
      if (state.version !== version) { pdf.destroy(); return; }
      state.pdf = pdf; state.pdfLoad = null;
      const select = el('pdf-page');
      for (let n = 1; n <= pdf.count; n++) select.add(new Option('Page ' + n, String(n)));
      set('pdf-count', pdf.count + (pdf.count === 1 ? ' page' : ' pages'));
      el('pdf-controls').hidden = false;
      await selectPage(1); return;
    }
    imageHeader(data);
    const source = new Image();
    sourceUrl = URL.createObjectURL(file); source.src = sourceUrl;
    await source.decode();
    if (version !== state.version) return;
    const width = source.naturalWidth, height = source.naturalHeight;
    if (!width || !height || width * height > 50000000 || Math.max(width, height) > 20000) throw new Error('This image exceeds the supported pixel dimensions.');
    await presentRaster(source, width, height, rotation, name, version);
  } catch (error) {
    if (version !== state.version) return;
    state.original = null;
    set('file-caption', 'No image selected.');
    set('image-error', error instanceof DOMException ? 'The image could not be decoded. Choose a clear JPEG, PNG or WebP.' : error.message);
  } finally {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (version === state.version) { state.preparing = false; syncControls(); }
  }
}

function clearImage() {
  closePdf(); stopCamera(); state.original = null; state.preparing = false; discardReadings();
  el('image-file').value = ''; el('camera-file').value = '';
  set('file-caption', 'No image selected.'); set('image-error', ''); set('camera-status', '');
}

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function readValue(field) {
  if (!field) return 'Awaiting reading';
  if (field.status === 'missing') return 'Missing';
  if (field.status === 'uncertain') return field.value ? `Uncertain · ${field.value}` : 'Uncertain';
  return field.value;
}
function hideBox() {
  state.located = null; el('model-box').hidden = true; el('box-caption').hidden = true; set('box-caption', '');
}
function positionBox() {
  if (!state.located || el('preview').hidden) return;
  const [left, top, right, bottom] = state.located;
  const image = el('preview').getBoundingClientRect(), frame = el('preview-frame').getBoundingClientRect();
  const marker = el('model-box');
  Object.assign(marker.style, {
    left: image.left - frame.left + image.width * left / 1000 + 'px', top: image.top - frame.top + image.height * top / 1000 + 'px',
    width: image.width * (right - left) / 1000 + 'px', height: image.height * (bottom - top) / 1000 + 'px',
  });
  marker.hidden = false;
}
function locateField(label, field) {
  state.located = field.box; positionBox(); el('box-caption').hidden = false;
  set('box-caption', 'Approximate OpenAI location for ' + label + '. Verify the highlighted area against the original.');
  el('preview-frame').scrollIntoView({block: 'center'});
}
function renderResults() {
  const container = el('results');
  container.replaceChildren();
  if (!state.local && !state.remote) { set('source-summary', ''); el('source-summary').classList.remove('disagreements'); return; }
  const disagreements = [], reviews = [];
  for (const [key, label] of keys) {
    const a = state.local?.fields.find(f => f.key === key), b = state.remote?.fields.find(f => f.key === key);
    const [status, message] = compareField(a, b);
    if (status === 'disagreement') disagreements.push(label);
    if (status === 'review') reviews.push(label);
    const row = element('article', undefined, 'read-row');
    row.dataset.field = key; row.dataset.state = status;
    row.append(element('h3', label), element('p', message, 'read-outcome ' + status));
    const dl = element('dl');
    for (const [title, value] of [['Browser OCR', readValue(a)], ['OpenAI', readValue(b)],
      ['OCR source line', a?.evidence], ['Model evidence', b?.evidence]]) {
      if (value) dl.append(element('dt', title), element('dd', value));
    }
    row.append(dl);
    if (b?.box) {
      const locate = element('button', 'Locate on image', 'text-button');
      locate.type = 'button'; locate.dataset.locate = key;
      locate.setAttribute('aria-label', 'Locate ' + label + ' on image');
      locate.addEventListener('click', () => locateField(label, b)); row.append(locate);
    }
    container.append(row);
  }
  const lines = [];
  if (disagreements.length) lines.push('Disagreements: ' + disagreements.join(', ') + '.');
  if (reviews.length) lines.push('Missing or uncertain: ' + reviews.join(', ') + '.');
  if (state.local && state.remote && !disagreements.length && !reviews.length) lines.push('The readers agree on all five fields.');
  if (state.remote) lines.push('OpenAI model ' + state.remote.model + ' · ' + state.remote.readAt + '.');
  if (state.local) lines.push('Browser OCR · Tesseract English · ' + state.local.readAt + '.');
  el('source-summary').classList.toggle('disagreements', disagreements.length > 0);
  set('source-summary', lines.join(' '));
}

async function recognizeAll(blob, signal) {
  const { default: tess } = await import('../assets/ocr/tesseract.esm.min.js');
  signal.throwIfAborted();
  const asset = name => new URL('../assets/ocr/' + name, import.meta.url).href;
  let worker, fail;
  const failure = new Promise((_, reject) => { fail = reject; });
  const abort = () => fail(new Error('Browser OCR cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => fail(new Error('Browser OCR timed out. Try a clearer, smaller crop.')), 90000);
  let finished = false;
  try {
    return await Promise.race([failure, (async () => {
      worker = await tess.createWorker('eng', tess.OEM.LSTM_ONLY, {
        workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-lstm.wasm.js'), langPath: asset(''),
        workerBlobURL: false, cacheMethod: 'none', errorHandler: detail => fail(new Error(String(detail))),
        logger: e => {
          if (!signal.aborted && !finished && e.status === 'recognizing text') set('local-status', 'Reading the whole image… ' + Math.round(e.progress * 100) + '%');
        },
      });
      if (finished || signal.aborted) { await worker.terminate(); return ''; }
      await worker.setParameters({ tessedit_pageseg_mode: tess.PSM.SPARSE_TEXT, user_defined_dpi: '200' });
      const { data } = await worker.recognize(blob, {}, { text: true });
      return data.text.trim();
    })()]);
  } finally {
    finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort);
    if (worker) await worker.terminate();
  }
}

async function readLocal() {
  if (!state.prepared || state.localJob) return;
  const version = state.version, controller = new AbortController();
  state.localJob = controller; state.local = null; renderResults();
  set('local-status', 'Starting the local English reader…'); set('transcript', 'Reading…'); syncControls();
  try {
    const text = await recognizeAll(state.prepared, controller.signal);
    if (version !== state.version) return;
    state.local = { fields: localFields(text), readAt: new Date().toISOString() };
    set('transcript', text || 'No legible text was found.'); set('local-status', text ? 'Browser OCR completed.' : 'Browser OCR completed. No legible text was found.');
  } catch {
    if (version !== state.version) return;
    set('local-status', 'Browser OCR could not finish. Check your connection, or try a clearer crop and rerun.');
    set('transcript', 'No completed OCR transcript is available.');
  } finally {
    if (version === state.version) { state.localJob = null; renderResults(); syncControls(); }
  }
}

const dataURL = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('The prepared image could not be read.')); reader.readAsDataURL(blob);
});
async function sendModel() {
  if (!state.prepared || state.remoteJob) return;
  if (!state.local && !state.localJob) void readLocal();
  if (!apiBase) { set('model-status', 'The hosted OpenAI service is unavailable. Browser OCR can still run.'); return; }
  const version = state.version, controller = new AbortController();
  state.remoteJob = controller; state.remote = null; hideBox(); renderResults(); syncControls();
  set('model-status', 'Sending the prepared image to OpenAI…');
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const image = await dataURL(state.prepared);
    if (version !== state.version) return;
    const res = await fetch(apiBase.replace(/\/$/, '') + '/api/read', {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal: controller.signal,
    });
    if (!res.ok) throw new Error(httpMessage(res.status));
    const reading = modelReading(await res.json());
    if (version !== state.version) return;
    state.remote = reading;
    set('model-status', 'OpenAI reading completed. Verify the proposed values against the preview.');
  } catch (error) {
    if (version !== state.version) return;
    const message = error.name === 'AbortError' ? httpMessage(504)
      : error instanceof TypeError ? 'The image service could not be reached. Check your connection or use browser OCR.'
      : error instanceof SyntaxError ? 'The image service returned an unreadable response. Try later.' : error.message;
    set('model-status', message);
  } finally {
    clearTimeout(timeout);
    if (version === state.version) { state.remoteJob = null; renderResults(); syncControls(); }
  }
}

async function openCamera() {
  stopCamera(); set('image-error', ''); el('live-camera').hidden = false;
  state.cameraPending = true; syncControls(); const epoch = state.cameraEpoch;
  set('camera-status', 'Waiting for camera access…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2200 }, height: { ideal: 1660 } },
    });
    if (epoch !== state.cameraEpoch) { stream.getTracks().forEach(t => t.stop()); return; }
    state.camera = stream;
    const video = el('camera-video'); video.srcObject = stream;
    await video.play();
    if (epoch !== state.cameraEpoch) return;
    el('camera-shot').disabled = !video.videoWidth;
    set('camera-status', 'Frame one page, keep the text upright and choose Use this frame.');
  } catch {
    if (epoch !== state.cameraEpoch) return;
    stopCamera(); set('camera-status', 'Live camera unavailable. Use Take a photo on your phone or choose a saved image.');
  } finally {
    if (epoch === state.cameraEpoch) { state.cameraPending = false; syncControls(); }
  }
}

async function capture() {
  const video = el('camera-video'), epoch = state.cameraEpoch;
  if (!state.camera || !video.videoWidth) return;
  el('camera-shot').disabled = true;
  try {
    const scale = Math.min(1, 2200 / Math.max(video.videoWidth, video.videoHeight));
    const frame = await jpeg(drawImage(video, video.videoWidth, video.videoHeight, 0, scale), .9);
    if (epoch === state.cameraEpoch) await prepare(frame, 'Camera photo');
  } catch {
    if (epoch === state.cameraEpoch) { stopCamera(); set('camera-status', 'The camera frame could not be read. Choose a saved image.'); }
  }
}

for (const id of ['image-file', 'camera-file']) el(id).addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) { void prepare(file, file.name || 'Camera photo'); event.target.value = ''; }
});
el('pdf-page').addEventListener('change', e => { void selectPage(Number(e.target.value)); });
el('rotate').addEventListener('click', () => {
  const next = (state.rotation + 1) % 4;
  if (state.pdf) void selectPage(state.page, next);
  else if (state.original) void prepare(state.original, state.name, next);
});
el('clear').addEventListener('click', clearImage);
el('camera-start').addEventListener('click', openCamera);
el('camera-stop').addEventListener('click', () => { stopCamera(); set('camera-status', 'Camera closed.'); });
el('camera-shot').addEventListener('click', capture);
el('camera-video').addEventListener('loadeddata', () => { if (state.camera) el('camera-shot').disabled = !el('camera-video').videoWidth; });
el('run-local').addEventListener('click', readLocal);
el('run-model').addEventListener('click', sendModel);
new ResizeObserver(positionBox).observe(el('preview'));
window.addEventListener('pagehide', clearImage);
document.addEventListener('visibilitychange', () => { if (document.hidden && (state.camera || state.cameraPending)) { stopCamera(); set('camera-status', 'Camera closed.'); } });
const sample = new URL(location.href).searchParams.get('sample');
if (['revision', 'clean', 'missing'].includes(sample)) {
  const version = state.version;
  try {
    const res = await fetch(new URL('../assets/scans/' + sample + '.png', import.meta.url));
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    if (version === state.version) await prepare(blob, 'Sample drawing · ' + sample);
  } catch { if (version === state.version) set('image-error', 'The sample could not be loaded. Choose a saved image to continue.'); }
}
