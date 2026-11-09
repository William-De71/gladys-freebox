#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Generated illustrations of the widgets, in the four languages:
#   docs/assets/widgets.<lang>.png   the three Freebox cards: the box at a
#                                    glance, the call log and the devices of
#                                    the network
#
# They are NOT screenshots of a running Gladys: the contents come from the
# integration's own code (gen.mjs, on a made-up Freebox and home network), and render.js
# draws them the way the Gladys front does (same slots, order and class names
# as front/src/components/boxs/external-widget, the official theme, the area
# chart options of front/src/components/boxs/chart). Light theme: the dark
# mode of Gladys greys the colored badges out.
#
# Needs: Node, Chrome or Chromium (CHROME=/path/to/chrome, or the Playwright
# one), ImageMagick and Python 3 with Pillow. Run from the repository root:
#   docs/illustrations/render.sh
# -----------------------------------------------------------------------------
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
here="$repo/docs/illustrations"
out="$repo/docs/assets"
# The Gladys front the styles are taken from (master on 2026-11-09, Gladys 5).
gladys_ref="52fd526a77b6df7e9e9e60bc7408a40418e127c3"
gladys_raw="https://raw.githubusercontent.com/GladysAssistant/Gladys/${gladys_ref}/front/src"

chrome="${CHROME:-$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -n1)}"
if [ ! -x "$chrome" ]; then
  echo "Chrome not found: set CHROME=/path/to/chrome" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/index.html" "$here/render.js" "$work/"

# The official theme and ApexCharts, as the Gladys front bundles them.
mkdir -p "$work/vendor/theme" "$work/vendor/apexcharts"
(cd "$work/vendor" && npm pack -s @gladysassistant/theme-optimized@2.1.0 apexcharts@3.54.1 >/dev/null)
tar xzf "$work"/vendor/gladysassistant-theme-optimized-*.tgz -C "$work/vendor/theme"
tar xzf "$work"/vendor/apexcharts-*.tgz -C "$work/vendor/apexcharts"

# The widget styles are a CSS module: its class names are used as they are,
# except `.badge`, which the theme also defines (renamed `.wbadge`).
curl -fsS "$gladys_raw/components/boxs/external-widget/style.css" |
  sed -E 's/:global\(([^)]*)\)/\1/g; s/\.badge([^A-Za-z])/.wbadge\1/g' >"$work/widget.css"
curl -fsS "$gladys_raw/style/dark-mode.css" -o "$work/dark-mode.css"
# The "Horizon" glass theme of the Gladys 5 dashboard: glass cards, the
# uppercase card title and the default scene behind them.
curl -fsS "$gladys_raw/routes/dashboard/style.css" |
  sed -E 's/:global\(([^)]*)\)/\1/g' >"$work/horizon.css"

node "$here/gen.mjs" "$repo" "$work/contents.json"
locales="$work/vendor/apexcharts/package/dist/locales"
{
  printf 'window.APEX_LOCALES=['
  for language in fr en de es; do cat "$locales/$language.json"; printf ','; done
  printf '];\nwindow.DATA='
  cat "$work/contents.json"
  printf ';\n'
} >"$work/data.js"

shot() {
  local file="$1" size="$2" query="$3"
  "$chrome" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --allow-file-access-from-files --virtual-time-budget=4000 \
    --window-size="$size" --force-device-scale-factor=1.5 \
    --screenshot="$file" "file://$work/index.html?$query" >/dev/null 2>&1
  magick "$file" -fuzz 2% -trim +repage -shave 2x2 +repage "$file"
}

for language in en fr de es; do
  shot "$out/widgets.$language.png" 880,1800 "lang=$language&cards=box,calls,network"
done

# libimagequant keeps the small colored dots and the scene gradient; a
# median-cut palette would grey them out. Truecolor when Pillow lacks it.
python3 -I - "$out" <<'PY'
import glob
import sys
from PIL import Image, features

for path in glob.glob(f"{sys.argv[1]}/widgets.*.png"):
    image = Image.open(path).convert("RGB")
    if features.check_feature("libimagequant"):
        image = image.quantize(
            colors=256, method=Image.Quantize.LIBIMAGEQUANT, dither=Image.Dither.FLOYDSTEINBERG
        )
    image.save(path, optimize=True)
PY
ls -l "$out"/widgets.*.png
