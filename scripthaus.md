# WaveTerm Commands

```bash
# @scripthaus command webpack-watch
# @scripthaus cd :playbook
node_modules/.bin/webpack --env dev --watch
```

```bash
# @scripthaus command webpack-build
# @scripthaus cd :playbook
node_modules/.bin/webpack --env dev
```

```bash
# @scripthaus command webpack-build-prod
# @scripthaus cd :playbook
node_modules/.bin/webpack --env prod
```

```bash
# @scripthaus command electron-rebuild
# @scripthaus cd :playbook
node_modules/.bin/electron-rebuild
```

```bash
# @scripthaus command electron
# @scripthaus cd :playbook
WAVETERM_DEV=1 PCLOUD_ENDPOINT="https://ot2e112zx5.execute-api.us-west-2.amazonaws.com/dev" PCLOUD_WS_ENDPOINT="wss://5lfzlg5crl.execute-api.us-west-2.amazonaws.com/dev/" node_modules/.bin/electron dist-dev/emain.js
```

```bash
# @scripthaus command typecheck
# @scripthaus cd :playbook
node_modules/.bin/tsc --noEmit
```

```bash
# @scripthaus command build-package
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --env prod
WAVESRV_VERSION=$(node -e 'console.log(require("./version.js"))')
WAVESHELL_VERSION=v0.4
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
function buildWaveShell {
    (cd waveshell; CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-$WAVESHELL_VERSION-$1.$2 main-waveshell.go)
}
function buildWaveSrv {
    (cd wavesrv; CGO_ENABLED=1 GOARCH=$1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.WaveVersion=$WAVESRV_VERSION" -o ../bin/wavesrv.$1 ./cmd)
}
buildWaveShell darwin amd64
buildWaveShell darwin arm64
buildWaveShell linux amd64
buildWaveShell linux arm64
buildWaveSrv arm64
buildWaveSrv amd64
yarn run electron-builder -c electron-builder.config.js -m -p never
```

```bash
# @scripthaus command build-package-linux
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --env prod
WAVESRV_VERSION=$(node -e 'console.log(require("./version.js"))')
WAVESHELL_VERSION=v0.4
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
function buildWaveShell {
    (cd waveshell; CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-$WAVESHELL_VERSION-$1.$2 main-waveshell.go)
}
function buildWaveSrv {
    # adds -extldflags=-static, *only* on linux (macos does not support fully static binaries) to avoid a glibc dependency
    (cd wavesrv; CGO_ENABLED=1 GOARCH=$1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-linkmode 'external' -extldflags=-static $GO_LDFLAGS -X main.WaveVersion=$WAVESRV_VERSION" -o ../bin/wavesrv.$1 ./cmd)
}
buildWaveShell darwin amd64
buildWaveShell darwin arm64
buildWaveShell linux amd64
buildWaveShell linux arm64
buildWaveSrv $GOARCH
yarn run electron-builder -c electron-builder.config.js -l -p never
```

```bash
# @scripthaus command build-wavesrv
WAVESRV_VERSION=$(node -e 'console.log(require("./version.js"))')
cd wavesrv
CGO_ENABLED=1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.WaveVersion=$WAVESRV_VERSION" -o ../bin/wavesrv.$GOARCH ./cmd
```

```bash
# @scripthaus command fullbuild-waveshell
set -e
cd waveshell
WAVESHELL_VERSION=v0.4
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
function buildWaveShell {
    (cd waveshell; CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-$WAVESHELL_VERSION-$1.$2 main-waveshell.go)
}
buildWaveShell darwin amd64
buildWaveShell darwin arm64
buildWaveShell linux amd64
buildWaveShell linux arm64
```

```bash
# @scripthaus command build-backend
# @scripthaus cd :playbook
echo building waveshell
scripthaus run fullbuild-waveshell
echo building wavesrv
scripthaus run build-wavesrv
```

```bash
# @scripthaus command generate-license-disclaimers
DISCLAIMER_DIR="./acknowledgements"
DISCLAIMER_OUTPUT_DIR="$DISCLAIMER_DIR/disclaimers"
if [ -d "$DISCLAIMER_OUTPUT_DIR" ]; then
    rm -rf "$DISCLAIMER_OUTPUT_DIR"
fi
mkdir "$DISCLAIMER_OUTPUT_DIR"
go run github.com/google/go-licenses@latest report ./wavesrv/... ./waveshell/... --template "$DISCLAIMER_DIR/go_licenses_report.tpl" --ignore github.com/wavetermdev/waveterm > "$DISCLAIMER_OUTPUT_DIR/backend.md"
yarn licenses generate-disclaimer > "$DISCLAIMER_OUTPUT_DIR/frontend.md"
```
