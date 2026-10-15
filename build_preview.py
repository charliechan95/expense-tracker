#!/usr/bin/env python3
"""Build the single-file in-chat preview of the expense tracker.

Inlines style.css + all JS into index.html. Preview-only transform: db.js's
storage shim is replaced with pure in-memory storage (the chat platform
rejects localStorage/sessionStorage/IndexedDB in widgets). The shipped app
is unaffected.
"""
import pathlib

ROOT = pathlib.Path(__file__).parent

html = (ROOT / "index.html").read_text()
css = (ROOT / "style.css").read_text()
db = (ROOT / "db.js").read_text()

shim_start = db.index("/* Storage shim:")
shim_end = db.index("})();", shim_start) + len("})();")
pure_mem = """/* Preview build: pure in-memory storage (no browser storage APIs), so the
   live in-chat preview runs anywhere. Data lasts for this session only.
   The shipped app uses browser storage via a safe shim instead. */
const _memStore = Object.create(null);
const storage = {
  getItem: (k) => (k in _memStore ? _memStore[k] : null),
  setItem: (k, v) => { _memStore[k] = String(v); },
  removeItem: (k) => { delete _memStore[k]; },
};"""
db_preview = db[:shim_start] + pure_mem + db[shim_end:]
db_preview = db_preview.replace("localStorage-backed", "browser-backed")
assert "localStorage" not in db_preview
assert "sessionStorage" not in db_preview and "indexedDB" not in db_preview

def inline_js(src: str) -> str:
    return src.replace("</script>", "<\\/script>")

html = html.replace(
    '<link rel="stylesheet" href="style.css">',
    "<style>\n" + css + "\n</style>",
)
parts = {
    "db.js": db_preview,
    "categorize.js": (ROOT / "categorize.js").read_text(),
    "importers.js": (ROOT / "importers.js").read_text(),
    "config.js": (ROOT / "config.js").read_text(),
    "sb.js": (ROOT / "sb.js").read_text(),
    "sync.js": (ROOT / "sync.js").read_text(),
    "app.js": (ROOT / "app.js").read_text(),
}
for name, src in parts.items():
    tag = f'<script src="{name}"></script>'
    assert tag in html, f"missing script tag: {name}"
    html = html.replace(tag, "<script>\n" + inline_js(src) + "\n</script>")

assert "localStorage" not in html
# i18n.js ships unmodified, inlined after the no-real-storage check above:
# every localStorage access in it sits inside try/catch and degrades to the
# default language where browser storage is unavailable (chat widgets).
i18n_src = (ROOT / "i18n.js").read_text()
i18n_tag = '<script src="i18n.js"></script>'
assert i18n_tag in html, "missing script tag: i18n.js"
html = html.replace(i18n_tag, "<script>\n" + inline_js(i18n_src) + "\n</script>")
out = ROOT / "in-chat-preview.html"
out.write_text(html)
print(f"wrote {out} ({len(html)} bytes)")
