// Display layer only. No interactive viewer, annotation layer, forms or script sandbox.
const asset = name => new URL('../assets/pdf/' + name, import.meta.url).href;
const pageLimit = 30;

function bounded(task, signal, cancel, seconds) {
  let timer, abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => { cancel(); reject(new Error('PDF operation cancelled.')); };
    timer = setTimeout(() => {
      cancel();
      reject(new Error('This PDF took too long to render. Export the selected page as an image.'));
    }, seconds * 1000);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([task, interrupted]).finally(() => {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
  });
}

export async function openPdf(bytes, signal) {
  const pdfjs = await import('../assets/pdf/pdf.min.mjs');
  signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.mjs');
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes), cMapUrl: asset('cmaps/'), cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'), wasmUrl: asset('wasm/'), iccUrl: asset('iccs/'),
    useWorkerFetch: true, useSystemFonts: false, enableXfa: false, stopAtErrors: true,
    maxImageSize: 25000000, canvasMaxAreaInBytes: 16 * 1024 * 1024,
    disableAutoFetch: true, disableStream: true, disableRange: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let closed = false;
  const destroy = () => {
    if (!closed) { closed = true; void loading.destroy().catch(() => {}); }
  };
  try {
    const doc = await bounded(loading.promise, signal, destroy, 20);
    if (!Number.isInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > pageLimit) throw new Error('Choose a PDF with 1 to 30 pages.');
    const { info } = await bounded(doc.getMetadata(), signal, destroy, 10);
    if (info.EncryptFilterName) throw new Error('Encrypted PDFs are unsupported. Use an authorised, unencrypted copy or export a page image.');
    if (info.IsAcroFormPresent || info.IsXFAPresent) throw new Error('Interactive PDF forms are unsupported. Export the required page as a static image.');
    if (await bounded(doc.hasJSActions(), signal, destroy, 10)) throw new Error('This interactive PDF is unsupported. Export a static page image.');
    return {
      count: doc.numPages, destroy,
      async render(number, abortSignal) {
        if (!Number.isSafeInteger(number) || number < 1 || number > doc.numPages) throw new Error('Choose a page from this PDF.');
        const page = await bounded(doc.getPage(number), abortSignal, () => {}, 15);
        abortSignal.throwIfAborted();
        const base = page.getViewport({ scale: 1 });
        if (![base.width, base.height].every(v => Number.isFinite(v) && v >= 1 && v <= 14400)) throw new Error('This PDF page has unsupported dimensions. Export a page image.');
        const scale = Math.min(3, 2200 / Math.max(base.width, base.height), Math.sqrt(4000000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
        const job = page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' });
        try {
          await bounded(job.promise, abortSignal, () => job.cancel(), 25);
          return canvas;
        } catch (error) {
          canvas.width = canvas.height = 1;
          throw error;
        } finally {
          page.cleanup();
        }
      },
    };
  } catch (error) {
    destroy();
    if (error.name === 'PasswordException') throw new Error('Encrypted or password-protected PDFs are unsupported. Choose an authorised, unencrypted copy.');
    if (/^Choose a PDF|^Interactive PDF|^Encrypted PDFs|^This (interactive )?PDF/.test(error.message)) throw error;
    throw new Error('The PDF is damaged or unsupported. Choose a readable PDF, JPEG, PNG or WebP.');
  }
}
