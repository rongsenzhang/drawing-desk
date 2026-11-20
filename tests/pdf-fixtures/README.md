# PDF reader fixtures

These original documents exercise page selection and local rasterisation. They contain fictional stockroom labels. The unencrypted two-page file includes an identifying metadata string so the browser test can check that the outbound request contains only a prepared JPEG.

| File | Expected behaviour |
| --- | --- |
| `workshop-label-pages.pdf` | Page 1 is landscape, contains selectable text and identifies DESK-742 at revision C. Page 2 is portrait, consists entirely of one image and identifies CARD-386 at revision F. A text-layer extractor alone cannot read both pages. |
| `locked-workshop-pages.pdf` | Password-protected copy of the two-page fixture. The reader should explain the restriction and clear any previous preview. The password used only to construct this test fixture is `fixture-only`. |
| `thirty-one-pages.pdf` | Thirty-one blank pages, one above the reader’s documented limit. The reader should decline the file. |
| `interactive-label.pdf` | A single editable text field in a PDF form. The reader should explain that an exported static page image is needed. |

Run the browser test with a local Drawing Desk server and `BASE_URL=http://localhost:8000/ node scripts/pdf-smoke.cjs`. All model requests are intercepted in the test browser.
