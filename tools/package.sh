#!/usr/bin/env bash
# 打包为可上传 Chrome Web Store / 可分发的最小 zip
# 用法：bash tools/package.sh [输出路径]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/manifest.json" | head -1)"
OUT="${1:-$(dirname "$ROOT")/repo-insight-$VERSION.zip}"

cd "$ROOT"

# 打包前的最小校验
python3 -c "import json,sys; json.load(open('manifest.json')); print('manifest.json 合法')"
for f in background.js popup.js options.js; do
  if command -v node >/dev/null 2>&1; then node --check "$f"; fi
done

rm -f "$OUT"
zip -q -r "$OUT" \
  manifest.json ./*.html ./*.js ./*.css \
  lib _locales icons install.sh install.bat \
  README.md README.en.md CHANGELOG.md LICENSE NOTICE.md TAMPER_NOTICE.txt \
  -x '*.DS_Store' '__MACOSX/*' 'tools/*'

# 打包自检：页面里引用的本地资源必须都在包里（避免漏文件导致装包后功能打不开）
python3 - "$OUT" <<'PY'
import re, sys, zipfile, pathlib

out = sys.argv[1]
root = pathlib.Path(".")
with zipfile.ZipFile(out) as zf:
    entries = {n for n in zf.namelist() if not n.endswith("/")}

missing = []
for html in sorted(root.glob("*.html")):
    text = html.read_text(encoding="utf-8")
    for ref in re.findall(r'(?:src|href)="([^"#]+)"', text):
        if ref.startswith(("http:", "https:", "//")):
            continue
        if ref not in entries:
            missing.append(f"{ref}（被 {html.name} 引用）")

for js in sorted(list(root.glob("*.js")) + list(root.glob("lib/*.js"))):
    text = js.read_text(encoding="utf-8")
    for ref in re.findall(r'from\s+"\./([^"]+)"', text):
        target = (js.parent / ref).resolve().relative_to(root.resolve()).as_posix()
        if target not in entries:
            missing.append(f"{target}（被 {js.name} import）")

if missing:
    print("打包自检失败，以下文件被引用但不在包里：")
    for m in missing:
        print("  -", m)
    sys.exit(1)
print(f"打包自检通过：{len(entries)} 个文件，页面与模块引用齐全")
PY

echo "打包完成（含自检）：$OUT"
unzip -l "$OUT" | tail -3
