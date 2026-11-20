# Drawing recognition

Open any case and run recognition to read a synthetic drawing from its pixels. The first view displays a previous observation of the same PNG. Both paths use the same recogniser. The three original sheets show identification plates for a training stockroom. The system uses the title block and an unscaled front view. Each sheet was drawn specifically for this demonstration.

## Recognition and evidence

The browser crops the title block, launches a local worker and runs the English Tesseract LSTM recogniser. The returned observation preserves raw text, line bounding boxes, line confidence and a summary confidence score. Each box uses the drawing’s native coordinates measured from the top left. Tesseract confidence is an engine score on a 0–100 scale. It has not been calibrated as a probability that a requirement is correct.

The object detector reads the front-view pixels. It groups neighbouring dark pixels and filters the components for ring size, aspect ratio, density and distance from the centre. A template mask excludes the central inscription, where round letters resemble holes. The detector returns an approximate centre and radius per visible ring. It does not infer physical dimensions. Both algorithms assume the upright workshop template. Drawings with rotated layouts, leaders crossing the rings or unfamiliar title blocks require a different detection and evaluation strategy.

The OCR client, worker, non-SIMD WebAssembly LSTM core and English language model download on demand, about 5.7 MiB before HTTP compression. All requests go to the same origin. The browser terminates the worker after each run. The stored observations in `data/observations.json` are actual Chromium outputs. There is no manual correction step between inference and this file.

## Measured results

The live benchmark ran 18 recognitions in Chrome 157.0.8103.80. Three original drawings share the same layout. The five perturbations allow direct checks on pixel sensitivity and missing evidence. The evaluation reads separate, manually specified field and centre labels. Field comparisons are case-sensitive and retain punctuation. A missing expected field counts as correct if no matching label is observed. Each reference centre can match at most one detection, within a radius of three source pixels.

| Input condition | Exact field decisions | Ring centres matched | Extra centres |
| --- | --- | --- | --- |
| Original sheets | 15/15 | 9/9 | 0 |
| Shift five pixels right and four up | 15/15 | 9/9 | 0 |
| Resize to 60% of original width and height | 14/15 | 9/9 | 0 |
| Erase the specification line | 15/15 | 9/9 | 0 |
| Erase one actual ring per sheet | 15/15 | 6/6 | 0 |
| Replace the first line with previously unseen part ID PL-541 | 15/15 | 9/9 | 0 |
| **All inputs** | **89/90** | **51/51** | **0** |

On the reduced-resolution PL-104 sheet the recogniser returned `ALUMINIUM,` with a trailing comma. The raw comparison correctly scores that observation as an error. These fixtures test repeatability and a few controlled changes. They are correlated variants of one template. Industrial generalisation, performance on real RFQs and business time savings remain unmeasured.

## Reproduce

From the repository root, `node --test tests/vision.test.mjs` checks the recorded outputs and benchmark consistency without downloads. For fresh inference, provide Playwright (tested with version 1.62.1) and Chromium. Run `node scripts/benchmark-vision.cjs`. Set `CHROME_PATH` to a desktop Chromium executable when using an existing browser. The script starts and closes its own loopback server, serves the app below the project path, rejects requests to external hosts and runs all cases through the production module. Add `--write` to update both `data/observations.json` and `tests/vision-benchmark.json` after reviewing changes.

To recreate the PNG files, install Pillow 13.0.0 and run `python scripts/generate-scans.py`. The image generator uses Pillow's built-in scalable font. To restore the vendored OCR binaries, run `python scripts/vendor-vision.py`. It verifies the pinned package archives and the uncompressed model before writing them.

## Third-party software

Tesseract.js and its WebAssembly core are version 7.0.0. The English language data comes from tessdata_fast 4.1.0, commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`. The three distributions use the Apache 2.0 licence. Licence files, bundled-script attribution and upstream component notices are in [the OCR asset directory](../assets/ocr/). [Tesseract.js](https://github.com/naptha/tesseract.js/tree/v7.0.0) · [Tesseract.js core](https://github.com/naptha/tesseract.js-core/tree/v7.0.0) · [English training data](https://github.com/tesseract-ocr/tessdata_fast/tree/65727574dfcd264acbb0c3e07860e4e9e9b22185)
