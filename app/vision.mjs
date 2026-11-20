// Geometry is calibrated to the training sheet template. Positions are in source pixels.
const template = {
  width: 1200,
  height: 720,
  plateView: {x: 98, y: 205, width: 588, height: 302},
  titleFields: {x: 776, y: 233, width: 375, height: 228}
};

function scaledRegion(region, width, height) {
  return {
    x: Math.round(region.x * width / template.width),
    y: Math.round(region.y * height / template.height),
    width: Math.round(region.width * width / template.width),
    height: Math.round(region.height * height / template.height)
  };
}

function ringsInRegion(image, region, scale) {
  const {width, height, data} = image;
  const marked = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const rings = [];

  function isInk(index) {
    return data[index * 4] < 130 && data[index * 4 + 1] < 130 && data[index * 4 + 2] < 130;
  }

  for (let start = 0; start < marked.length; start++) {
    if (marked[start] || !isInk(start)) continue;
    let head = 0, tail = 1;
    let left = width, right = -1, top = height, bottom = -1;
    marked[start] = 1;
    queue[0] = start;
    while (head < tail) {
      const pixel = queue[head++];
      const y = Math.floor(pixel / width), x = pixel % width;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const step of [-width, width, -1, 1]) {
        if ((step === -1 && x === 0) || (step === 1 && x === width - 1)) continue;
        const next = pixel + step;
        if (next >= 0 && next < marked.length && !marked[next] && isInk(next)) {
          marked[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    const w = right - left + 1, h = bottom - top + 1;
    if (w < 15 * scale || w > 35 * scale || Math.abs(w - h) > 0.16 * w) continue;
    const x = (left + right) / 2, y = (top + bottom) / 2, r = (w + h) / 4;
    // Exclude the fixed central inscription, which contains letter-shaped loops.
    if (x > width * 0.25 && x < width * 0.76 && y > height * 0.29 && y < height * 0.70) continue;
    const density = tail / (w * h);
    if (density < 0.12 || density > 0.5) continue;
    let annulusPixels = 0;
    for (let i = 0; i < tail; i++) {
      const radius = Math.hypot(queue[i] % width - x, Math.floor(queue[i] / width) - y);
      if (radius > 0.63 * r && radius < 1.12 * r) annulusPixels++;
    }
    if (annulusPixels / tail > 0.95) {
      rings.push({x: x + region.x, y: y + region.y, r: Math.round(r * 10) / 10});
    }
  }
  return rings.sort((a, b) => a.y - b.y || a.x - b.x);
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function collectLines(blocks, crop) {
  return (blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph =>
    paragraph.lines.map(line => ({
      text: line.text.trim(),
      confidence: line.confidence,
      x: crop.x + line.bbox.x0,
      y: crop.y + line.bbox.y0,
      width: line.bbox.x1 - line.bbox.x0,
      height: line.bbox.y1 - line.bbox.y0
    }))
  ));
}

/** Recognise one original training sheet, using assets served from this site. */
export async function recognizeScan(url, {onProgress = () => {}} = {}) {
  const source = new Image();
  source.src = url;
  await source.decode();
  const {naturalWidth: width, naturalHeight: height} = source;
  const region = scaledRegion(template.plateView, width, height);
  const ocrRegion = scaledRegion(template.titleFields, width, height);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(source, 0, 0);
  const ink = ctx.getImageData(region.x, region.y, region.width, region.height);
  const holes = ringsInRegion(ink, region, width / template.width);
  const crop = makeCanvas(ocrRegion.width, ocrRegion.height);
  crop.getContext('2d').drawImage(canvas, ocrRegion.x, ocrRegion.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const {default: tesseract} = await import('../assets/ocr/tesseract.esm.min.js');
  const asset = name => new URL('../assets/ocr/' + name, import.meta.url).href;
  // Language-loading failures are reported through Tesseract's error callback.
  // Forward them to the caller so the analyst can retry or use the recorded reading.
  const worker = await new Promise((resolve, reject) => {
    tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
      workerPath: asset('worker.min.js'),
      corePath: asset('tesseract-core-lstm.wasm.js'),
      langPath: asset(''),
      workerBlobURL: false,
      cacheMethod: 'none',
      errorHandler: detail => reject(new Error(String(detail))),
      logger: event => {
        if (event.status === 'recognizing text') onProgress(0.25 + event.progress * 0.75);
        if (event.status === 'loading language traineddata') onProgress(event.progress * 0.20);
      }
    }).then(resolve, reject);
  });
  try {
    await worker.setParameters({tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK, user_defined_dpi: '200'});
    const {data} = await worker.recognize(crop, {}, {text: true, blocks: true});
    onProgress(1);
    return {
      text: data.text.trim(), confidence: data.confidence, holes,
      lines: collectLines(data.blocks, ocrRegion),
      width, height, region, ocrRegion
    };
  } finally {
    await worker.terminate();
  }
}
