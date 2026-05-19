#!/usr/bin/env bash
# Build the plugin container image and save it as a .tar.gz in ./dist
#
# Usage:
#   ./scripts/build.sh                  # uses version from package.json
#   VERSION=0.2.1 ./scripts/build.sh    # override version
#   ENGINE=podman ./scripts/build.sh    # use podman instead of docker

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENGINE="${ENGINE:-docker}"
IMAGE_NAME="${IMAGE_NAME:-hmip-hcu-fusionsolar}"

if [ -z "${VERSION:-}" ]; then
	VERSION=$(node -p "require('./package.json').version")
fi

DIST="$ROOT/dist"
mkdir -p "$DIST"

TAG="${IMAGE_NAME}:${VERSION}"
OUT="$DIST/${IMAGE_NAME}-${VERSION}.tar.gz"

echo "→ Engine:  $ENGINE"
echo "→ Tag:     $TAG"
echo "→ Output:  $OUT"
echo

"$ENGINE" buildx build --platform linux/arm64 -t "$TAG" --load .

echo
echo "→ Saving image to $OUT"
"$ENGINE" save "$TAG" | gzip -9 > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo
echo "✓ Built $SIZE → $OUT"
