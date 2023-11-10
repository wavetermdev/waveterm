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
WAVETERM_DEV=1 PCLOUD_ENDPOINT="https://ot2e112zx5.execute-api.us-west-2.amazonaws.com/dev" node_modules/.bin/electron dist-dev/emain.js
```

```bash
# @scripthaus command typecheck
# @scripthaus cd :playbook
node_modules/.bin/tsc --jsx preserve --noEmit --esModuleInterop --target ES5 --experimentalDecorators --downlevelIteration src/index.ts src/types/custom.d.ts
```

```bash
# @scripthaus command build-package
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --env prod
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
(cd waveshell; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go)
(cd waveshell; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go)
(cd wavesrv; CGO_ENABLED=1 go build -ldflags="$GO_LDFLAGS" -o ../bin/wavesrv ./cmd)
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
(cd waveshell; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go)
(cd waveshell; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go)
(cd wavesrv; CGO_ENABLED=1 go build -ldflags="$GO_LDFLAGS" -o ../bin/wavesrv ./cmd)
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
CGO_ENABLED=1 go build -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M')" -o ../bin/wavesrv ./cmd
```

```bash
# @scripthaus command build-waveshell
cd waveshell
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell-v0.3-darwin.amd64 main-waveshell.go
```

```bash
# @scripthaus command fullbuild-waveshell
set -e
cd waveshell
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o ~/.mshell/mshell-v0.2 main-waveshell.go
GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go
GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go
GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go
GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go
```

```bash
# @scripthaus command build-backend
# @scripthaus cd :playbook
echo building waveshell
scripthaus run fullbuild-waveshell
echo building wavesrv
scripthaus run build-wavesrv
```
