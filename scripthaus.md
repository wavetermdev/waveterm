# Prompt Commands

```bash
# @scripthaus command webpack-watch
# @scripthaus cd :playbook
node_modules/.bin/webpack --watch --config webpack.dev.js
```

```bash
# @scripthaus command webpack-build
# @scripthaus cd :playbook
node_modules/.bin/webpack --config webpack.dev.js
```


```bash
# @scripthaus command webpack-electron-watch
# @scripthaus cd :playbook
node_modules/.bin/webpack --watch --config webpack.electron.js
```

```bash
# @scripthaus command webpack-electron-build
# @scripthaus cd :playbook
node_modules/.bin/webpack --config webpack.electron.js
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
# @scripthaus command devserver
# @scripthaus cd :playbook
node_modules/.bin/webpack-dev-server --config webpack.dev.js --host 0.0.0.0
```

```bash
# @scripthaus command webshare-devserver
# @scripthaus cd :playbook
node_modules/.bin/webpack-dev-server --config webpack.share.dev.js --host 127.0.0.1
```

```bash
# @scripthaus command webshare-build
# @scripthaus cd :playbook
node_modules/.bin/webpack --config webpack.share.dev.js
```

```bash
# @scripthaus command webshare-build-prod
# @scripthaus cd :playbook
node_modules/.bin/webpack --config webpack.share.prod.js
```

```bash
# @scripthaus command typecheck
# @scripthaus cd :playbook
node_modules/.bin/tsc --jsx preserve --noEmit --esModuleInterop --target ES5 --experimentalDecorators --downlevelIteration src/sh2.ts
```

```bash
# @scripthaus command typecheck-webshare
# @scripthaus cd :playbook
node_modules/.bin/tsc --jsx preserve --noEmit --esModuleInterop --target ES5 --experimentalDecorators --downlevelIteration src/webshare.ts
```

```bash
# @scripthaus command build-package
# @scripthaus cd :playbook
rm -rf dist/
rm -rf bin/
rm -rf build/
node_modules/.bin/webpack --config webpack.prod.js
node_modules/.bin/webpack --config webpack.electron.prod.js
GO_LDFLAGS="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M')"
(cd ../mshell; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/bin/mshell/mshell-v0.2-darwin.amd64 main-mshell.go)
(cd ../mshell; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/bin/mshell/mshell-v0.2-darwin.arm64 main-mshell.go)
(cd ../mshell; GOOS=linux GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/bin/mshell/mshell-v0.2-linux.amd64 main-mshell.go)
(cd ../mshell; GOOS=linux GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/bin/mshell/mshell-v0.2-linux.arm64 main-mshell.go)
(cd ../sh2-server; GOOS=darwin GOARCH=amd64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/build/prompt-local-server.amd64 ./cmd)
(cd ../sh2-server; GOOS=darwin GOARCH=arm64 go build -ldflags="$GO_LDFLAGS" -o ../sh2/build/prompt-local-server.arm64 ./cmd)
lipo -create -output bin/prompt-local-server build/prompt-local-server.amd64 build/prompt-local-server.arm64
node_modules/.bin/electron-forge make
```

```bash
# @scripthaus command open-electron-package
# @scripthaus cd :playbook
open out/Prompt-darwin-x64/Prompt.app
```

```bash
# @scripthaus command create-dmg
# @scripthaus cd :playbook
DMG_VERSION=$(node -e 'console.log(require("./version.js"))')
DMG_NAME="prompt-macos-x86-${DMG_VERSION}.dmg"
rm *.dmg
/Users/mike/work/gopath/src/github.com/create-dmg/create-dmg/create-dmg \
  --volname "Prompt" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Prompt.app" 200 130 \
  --hide-extension "Prompt.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "out/Prompt-darwin-x64/Prompt.app"
```

```bash
# @scripthaus command create-dmg-m1
# @scripthaus cd :playbook
DMG_VERSION=$(node -e 'console.log(require("./version.js"))')
DMG_NAME="prompt-macos-arm64-${DMG_VERSION}.dmg"
rm *.dmg
../../create-dmg/create-dmg/create-dmg \
  --volname "Prompt" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Prompt.app" 200 130 \
  --hide-extension "Prompt.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "out/Prompt-darwin-arm64/Prompt.app"
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
