#!/bin/bash

# assumes we have Wave-darwin-x64-[version].zip and Wave-darwin-arm64-[version].zip in current directory
VERSION=0.6.1
rm -rf temp
rm -rf builds
mkdir temp
mkdir temp/x64
aws s3 cp s3://waveterm-github-artifacts/waveterm-builds.zip .
BUILDS_ZIP=waveterm-builds.zip
if ! [ -f $BUILDS_ZIP ]; then
    echo "no $BUILDS_ZIP found";
    exit 1;
fi
echo "unzipping $BUILDS_ZIP"
unzip -q $BUILDS_ZIP -d builds
X64_ZIP="builds/Wave-darwin-x64-$VERSION.zip"
ARM64_ZIP="builds/Wave-darwin-arm64-$VERSION.zip"
if ! [ -f $X64_ZIP ]; then
    echo "no $X64_ZIP found";
    exit 1;
fi
if ! [ -f $ARM64_ZIP ]; then
    echo "no $ARM64_ZIP found"
    exit 1;
fi
set -e
echo "unzipping version v$VERSION zip files"
ls -l "$X64_ZIP" "$ARM64_ZIP"
unzip -q $X64_ZIP -d temp/x64
mkdir temp/arm64
unzip -q $ARM64_ZIP -d temp/arm64
lipo -create -output temp/wavesrv temp/x64/Wave.app/Contents/Resources/app/bin/wavesrv temp/arm64/Wave.app/Contents/Resources/app/bin/wavesrv
rm -rf temp/arm64/Wave.app/Contents/Resources/app
mv temp/x64/Wave.app/Contents/Resources/app temp/
cp temp/wavesrv temp/app/bin/wavesrv
mkdir temp/x64/Wave.app/Contents/Resources/app
mkdir temp/arm64/Wave.app/Contents/Resources/app
node build-universal.js
rm -rf temp/Wave.app/Contents/Resources/app
mv temp/app temp/Wave.app/Contents/Resources/app
node osx-sign.js
DEBUG=electron-notarize node osx-notarize.js
echo "universal app creation success (build/sign/notarize)"

UVERSION=$(node -e 'console.log(require("../version.js"))')

echo "creating universal zip"
rm -f *.zip
ZIP_NAME="waveterm-macos-universal-${UVERSION}.zip"
zip -qr $ZIP_NAME temp/Wave.app

echo "creating universal dmg"
rm -f *.dmg
DMG_NAME="waveterm-macos-universal-${UVERSION}.dmg"
../../create-dmg/create-dmg \
  --volname "WaveTerm" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Wave.app" 200 130 \
  --hide-extension "Wave.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "temp/Wave.app"
echo "success, created $DMG_NAME"
mv $DMG_NAME builds/
rm builds/Wave-darwin-*.zip
spctl -a -vvv -t install temp/Wave.app/
