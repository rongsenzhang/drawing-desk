# Third-party notices

Drawing Desk distributes the following browser software and language model in `assets/ocr/`. The workshop sheets and RFQs were created for the demo. The English OCR weights are an existing pretrained model.

| Distribution | Files shipped | Licence and provenance |
| --- | --- | --- |
| Tesseract.js 7.0.0 | Browser ES module and worker bundle | [Apache 2.0 licence](assets/ocr/LICENSE-tesseract.txt) · [Upstream release](https://github.com/naptha/tesseract.js/tree/v7.0.0) |
| Tesseract.js-core 7.0.0 | Non-SIMD LSTM core with embedded WebAssembly | [Apache 2.0 licence](assets/ocr/LICENSE-core.txt) · [Upstream release](https://github.com/naptha/tesseract.js-core/tree/v7.0.0) |
| Tesseract tessdata_fast 4.1.0 | English recognition weights, gzip-compressed for transport | [Apache 2.0 licence](assets/ocr/LICENSE-model.txt) · [Exact model revision](https://github.com/tesseract-ocr/tessdata_fast/tree/65727574dfcd264acbb0c3e07860e4e9e9b22185) |

The browser bundles retain their published attribution files. [Client notices](assets/ocr/tesseract.min.js.LICENSE.txt) · [Worker notices](assets/ocr/worker.min.js.LICENSE.txt). The following additional notices accompany code in the published worker and core. Versions for the JavaScript packages follow the [upstream dependency lock](https://github.com/naptha/tesseract.js/blob/v7.0.0/package-lock.json).

## Native and runtime components

The upstream WebAssembly build references the component revisions in its [pinned dependency tree](https://github.com/naptha/tesseract.js-core/tree/v7.0.0/third_party). Redistributed notices are available for [Tesseract C++](assets/ocr/notices/tesseract-cpp.txt), [Leptonica](assets/ocr/notices/leptonica.txt), [giflib](assets/ocr/notices/giflib.txt), [Independent JPEG Group](assets/ocr/notices/libjpeg.txt), [libpng](assets/ocr/notices/libpng.txt), [libtiff](assets/ocr/notices/libtiff.txt), [libwebp](assets/ocr/notices/libwebp.txt), [openlibm](assets/ocr/notices/openlibm.txt) and [zlib](assets/ocr/notices/zlib.txt). The Independent JPEG Group software is included in the upstream build. Emscripten 4.0.15 supplies the compilation runtime. [Emscripten copyright and licences](https://github.com/emscripten-core/emscripten/blob/4.0.15/LICENSE)

## JavaScript components

The browser bundles include attribution for [buffer](assets/ocr/notices/buffer.txt), [ieee754](assets/ocr/notices/ieee754.txt), [regenerator-runtime](assets/ocr/notices/regenerator-runtime.txt) and [zlib.js](assets/ocr/notices/zlibjs.txt). The following upstream package notices cover other bundled modules.

### base64-js 1.5.1

```text
The MIT License (MIT)

Copyright (c) 2014 Jameson Little

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### bmp-js 0.1.0

```text
The MIT License (MIT)

Copyright (c) 2014 @丝刀口

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### idb-keyval 6.2.1

```text
Copyright 2016, Jake Archibald

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### is-url 1.2.4

```text
MIT LICENSE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### wasm-feature-detect 1.8.0

Distributed under the [Apache 2.0 licence](assets/ocr/LICENSE-tesseract.txt). [Published package](https://www.npmjs.com/package/wasm-feature-detect/v/1.8.0)

### Additional WebP patent grant

```text
Additional IP Rights Grant (Patents)
------------------------------------

"These implementations" means the copyrightable works that implement the WebM
codecs distributed by Google as part of the WebM Project.

Google hereby grants to you a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable (except as stated in this section) patent license to
make, have made, use, offer to sell, sell, import, transfer, and otherwise
run, modify and propagate the contents of these implementations of WebM, where
such license applies only to those patent claims, both currently owned by
Google and acquired in the future, licensable by Google that are necessarily
infringed by these implementations of WebM. This grant does not include claims
that would be infringed only as a consequence of further modification of these
implementations. If you or your agent or exclusive licensee institute or order
or agree to the institution of patent litigation or any other patent
enforcement activity against any entity (including a cross-claim or
counterclaim in a lawsuit) alleging that any of these implementations of WebM
or any code incorporated within any of these implementations of WebM
constitute direct or contributory patent infringement, or inducement of
patent infringement, then any patent rights granted to you under this License
for these implementations of WebM shall terminate as of the date such
litigation is filed.
```
