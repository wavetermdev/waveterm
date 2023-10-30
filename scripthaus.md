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
PROMPT_DEV=1 PCLOUD_ENDPOINT="https://ot2e112zx5.execute-api.us-west-2.amazonaws.com/dev" node_modules/.bin/electron dist-dev/emain.js
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
(cd wavesrv; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../build/wavesrv.amd64 ./cmd)
(cd wavesrv; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../build/wavesrv.arm64 ./cmd)
lipo -create -output bin/wavesrv build/wavesrv.amd64 build/wavesrv.arm64
node_modules/.bin/electron-forge make
```

```bash
# @scripthaus command build-package-linux
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --config webpack.prod.js
node_modules/.bin/webpack --config webpack.electron.prod.js
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
(cd waveshell; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.amd64 main-waveshell.go)
(cd waveshell; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-darwin.arm64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.amd64 main-waveshell.go)
(cd waveshell; GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../bin/mshell/mshell-v0.3-linux.arm64 main-waveshell.go)
(cd wavesrv; go build -ldflags="$GO_LDFLAGS" -o ../bin/wavesrv ./cmd)
node_modules/.bin/electron-forge make
```

```bash
# @scripthaus command open-electron-package
# @scripthaus cd :playbook
open out/Wave-darwin-x64/Wave.app
```

```bash
# @scripthaus command create-dmg
# @scripthaus cd :playbook
DMG_VERSION=$(node -e 'console.log(require("./version.js"))')
DMG_NAME="waveterm-macos-x86-${DMG_VERSION}.dmg"
rm *.dmg
/Users/mike/work/gopath/src/github.com/create-dmg/create-dmg/create-dmg \
  --volname "WaveTerm" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Wave.app" 200 130 \
  --hide-extension "Wave.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "out/Wave-darwin-x64/Wave.app"
```

```bash
# @scripthaus command create-dmg-m1
# @scripthaus cd :playbook
DMG_VERSION=$(node -e 'console.log(require("./version.js"))')
DMG_NAME="waveterm-macos-arm64-${DMG_VERSION}.dmg"
rm *.dmg
/Users/sawka/work/gopath/src/github.com/create-dmg/create-dmg/create-dmg \
  --volname "WaveTerm" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Wave.app" 200 130 \
  --hide-extension "Wave.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "out/Wave-darwin-arm64/Wave.app"
```

```bash
# @scripthaus command sync-webshare-dev
# @scripthaus cd :playbook
# no-cache for dev
aws --profile prompt-s3 s3 sync webshare/static s3://prompt-devshare-static/static --cache-control 'no-cache'
aws --profile prompt-s3 s3 sync webshare/dist-dev s3://prompt-devshare-static/dist-dev --cache-control 'no-cache'
```

```bash
# @scripthaus command sync-webshare
# @scripthaus cd :playbook
# no-cache for dev
aws --profile prompt-s3 s3 sync webshare/static s3://prompt-share-static/static --cache-control 'no-cache'
aws --profile prompt-s3 s3 sync webshare/dist s3://prompt-share-static/dist --cache-control 'no-cache'
```

```bash
# @scripthaus command build-wavesrv
cd wavesrv
go build -ldflags "-X main.BuildTime=$(date +'%Y%m%d%H%M')" -o bin/wavesrv ./cmd
```

```bash
# @scripthaus command build-waveshell
cd waveshell
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.3-darwin.amd64 main-waveshell.go
```

```bash
# @scripthaus command fullbuild-waveshell
set -e
cd waveshell
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
go build -ldflags="$GO_LDFLAGS" -o ~/.mshell/mshell-v0.2 main-waveshell.go
GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.3-linux.amd64 main-waveshell.go
GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.3-linux.arm64 main-waveshell.go
GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.3-darwin.amd64 main-waveshell.go
GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o bin/mshell-v0.3-darwin.arm64 main-waveshell.go
```

```bash
# @scripthaus command build-backend
# @scripthaus cd :playbook
echo building waveshell
scripthaus run fullbuild-waveshell
echo building wavesrv
scripthaus run build-wavesrv
```
