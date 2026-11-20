"""Copy the display-only subset from the integrity-pinned Mozilla PDF.js distribution."""
import base64
import hashlib
import io
from pathlib import Path
import sys
import tarfile
from urllib.request import urlopen

VERSION = "6.5.438"
URL = f"https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-{VERSION}.tgz"
DIGEST = "vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA=="
DEST = Path(__file__).resolve().parents[1] / "assets" / "pdf"
FILES = {
    "LICENSE", "legacy/build/pdf.min.mjs", "legacy/build/pdf.worker.min.mjs",
    "wasm/openjpeg.wasm", "wasm/jbig2.wasm", "wasm/qcms_bg.wasm",
    "wasm/openjpeg_nowasm_fallback.js", "wasm/jbig2_nowasm_fallback.js",
}

def selected(path):
    if path in FILES or path.startswith(("standard_fonts/", "cmaps/", "iccs/")):
        return True
    return path.startswith("wasm/LICENSE") and "QUICKJS" not in path

raw = Path(sys.argv[1]).read_bytes() if len(sys.argv) == 2 else urlopen(URL, timeout=60).read()
if base64.b64encode(hashlib.sha512(raw).digest()).decode() != DIGEST:
    raise SystemExit("Unexpected PDF.js archive integrity.")
with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
    for item in archive:
        if not item.isfile() or not item.name.startswith("package/"):
            continue
        name = item.name.removeprefix("package/")
        if not selected(name):
            continue
        dest = DEST / (Path(name).name if name.startswith("legacy/build/") else name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(archive.extractfile(item).read())

# The legacy bundles contain core-js 3.51.0, whose own upstream notice is
# identified inside both bundles. Store a readable copy beside Mozilla's.
core_url = "https://raw.githubusercontent.com/zloirock/core-js/v3.51.0/LICENSE"
core_notice = urlopen(core_url, timeout=30).read()
if hashlib.sha256(core_notice).hexdigest() != "b87653fff2d44426ab5cd4723cee3b1364dc8d35a0acdf098c54689543123bf8":
    raise SystemExit("Unexpected core-js licence content.")
(DEST / "LICENSE-core-js").write_bytes(core_notice)
