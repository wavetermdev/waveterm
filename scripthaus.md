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
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
(cd waveshell; CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go)
(cd wavesrv; CGO_ENABLED=1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M')" -o ../bin/wavesrv ./cmd)
node_modules/.bin/electron-forge make
```

```bash
# @scripthaus command build-package-linux
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --env prod
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
(cd waveshell; CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go)
(cd waveshell; CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go)
# adds -extldflags=-static, *only* on linux (macos does not support fully static binaries) to avoid a glibc dependency
(cd wavesrv; CGO_ENABLED=1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-linkmode 'external' -extldflags=-static $GO_LDFLAGS" -o ../bin/wavesrv ./cmd)
node_modules/.bin/electron-forge make
```

```bash
# @scripthaus command open-electron-package
# @scripthaus cd :playbook
open out/Wave-darwin-x64/Wave.app
```

```bash
# @scripthaus command build-wavesrv
cd wavesrv
CGO_ENABLED=1 go build -tags "osusergo,netgo,sqlite_omit_load_extension" -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M')" -o ../bin/wavesrv ./cmd
```

```bash
# @scripthaus command fullbuild-waveshell
set -e
cd waveshell
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go
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
