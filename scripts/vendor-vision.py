"""Refresh the exact redistributable browser OCR binaries and notices."""
import base64
import gzip
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'ocr'
SOURCES = [
    ('https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz',
     'exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA==',
     {'dist/tesseract.esm.min.js': 'tesseract.esm.min.js', 'dist/worker.min.js': 'worker.min.js',
      'dist/tesseract.min.js.LICENSE.txt': 'tesseract.min.js.LICENSE.txt',
      'dist/worker.min.js.LICENSE.txt': 'worker.min.js.LICENSE.txt', 'LICENSE.md': 'LICENSE-tesseract.txt'}),
    ('https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz',
     'WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==',
     {'tesseract-core-lstm.wasm.js': 'tesseract-core-lstm.wasm.js', 'LICENSE': 'LICENSE-core.txt'})
]
MODEL_REPO = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185/'


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for url, digest, members in SOURCES:
        data = fetch(url)
        if base64.b64encode(hashlib.sha512(data).digest()).decode() != digest:
            raise ValueError(f'Package checksum mismatch for {url}')
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            for source, dest in members.items():
                (ROOT / dest).write_bytes(archive.extractfile('package/' + source).read())
    model = fetch(MODEL_REPO + 'eng.traineddata')
    if hashlib.sha256(model).hexdigest() != '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2':
        raise ValueError('Language model checksum mismatch')
    (ROOT / 'eng.traineddata.gz').write_bytes(gzip.compress(model, compresslevel=9, mtime=0))
    (ROOT / 'LICENSE-model.txt').write_bytes(fetch(MODEL_REPO + 'LICENSE'))


if __name__ == '__main__':
    main()
