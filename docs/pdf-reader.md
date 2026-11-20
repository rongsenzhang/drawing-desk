# PDF page intake

Open **Image reader**, choose a local PDF and select its page. Check the raster preview and rotate it if needed. **Run browser OCR** reads the selected page in this browser. **Send to OpenAI** submits the prepared JPEG of that page for a model reading. Where the model supplies a valid approximate location for its evidence, **Locate on image** marks that region on the preview.

The picker also accepts JPEG, PNG and WebP. The camera controls use the same image review flow. Changing the source, page or rotation discards prior readings and location marks. The original PDF bytes, filename, unselected pages and document metadata are excluded from the model request.

## Supported inputs

The PDF must be static, unencrypted, no larger than 12 MiB and contain 1–30 pages. The worker parses the file locally. The renderer bounds source page dimensions, individual embedded-image size and rendering time, then rasterises one page at a time to at most four million pixels and 2200 pixels per side. The common upload stage flattens it to a white-background JPEG of at most 1 MiB. Password-protected PDFs, detected forms and document scripts are rejected. Annotations are disabled, so save critical review markup into the static drawing content before importing it.

Both readers consume the selected page’s visible raster. Browser OCR receives no embedded text layer. A crowded page, unusual font, restricted embedded image or very large format may therefore need a clearer exported crop. Going back to a different page starts a new review. Missing, uncertain and disagreeing readings remain subject to human verification.

## Implementation and validation

PDF.js 6.5.438 loads on the first PDF selection. Local assets cover the display module, document worker, standard fonts, character maps, colour profile and image decoders. The project serves these assets from the same origin. The script verifies the npm archive integrity, copies only the selected distribution files and brings in the pinned core-js notice for the compatibility bundles. [Mozilla PDF.js release](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438) · [Notices](../THIRD-PARTY-NOTICES.md) · [Vendor script](../scripts/vendor-pdf.py).

To reproduce the vendor directory from the repository root, use Python 3.9 or later.

```sh
python3 scripts/vendor-pdf.py
```

The PDF smoke test selects a genuine two-page synthetic drawing and reads its distinct page identifiers through browser OCR. It checks page changes, the optional evidence overlay, rejected documents and the body of a simulated model request. It was run on desktop Chromium and mobile WebKit emulation. Its service response is a fixture and consumes no OpenAI credit. [Browser smoke script](../scripts/pdf-smoke.cjs) · [Test PDF sources](../tests/pdf-fixtures/README.md).

A separate live check on the published site imported the same two-page document with WebKit in an iPhone 13 profile, selected the raster-only second page, and explicitly sent its preview. The hosted model read all five expected fields, including CARD-386. Only the JPEG page image was transmitted. A physical handset was not used. [Actual response and case result](../tests/openai-pdf-e2e.json) · [Opt-in paid reproduction](../scripts/live-pdf-check.cjs)
