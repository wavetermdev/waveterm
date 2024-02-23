#!/bin/bash

# assumes we have Wave-darwin-x64-[version].zip and Wave-darwin-arm64-[version].zip in current directory
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
BUILDS_DIR=./builds
unzip -q $BUILDS_ZIP -d $BUILDS_DIR
X64_ZIP=Wave-darwin-x64-*.zip
ARM64_ZIP=Wave-darwin-arm64-*.zip

# Ensure we have exactly one of each build
find_build() 
{
    local BUILD_DIR=$1
    local BUILD_PATTERN=$2
    local BUILD_PATH=$(find $BUILD_DIR -type f -iname "$BUILD_PATTERN")
    local NUM_MATCHES=$(echo $BUILD_PATH | wc -l)
    if [ "0" -eq "$NUM_MATCHES" ]; then
        echo "no $BUILD_NAME found in $BUILD_DIR"
        exit 1
    elif [ "1" -lt "$NUM_MATCHES" ]; then
        echo "multiple $BUILD_NAME found in $BUILD_DIR"
        exit 1
    fi
    echo $BUILD_PATH
}

X64_ZIP=$(find_build $BUILDS_DIR $X64_ZIP)
ARM64_ZIP=$(find_build $BUILDS_DIR $ARM64_ZIP)
set -e

echo "unzipping zip files"
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
rm -rf zip
mkdir zip
ditto temp/Wave.app zip/Wave.app
ZIP_NAME="waveterm-macos-universal-${UVERSION}.zip"
cd zip
zip -9yqr $ZIP_NAME Wave.app
mv $ZIP_NAME ..
cd ..

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
