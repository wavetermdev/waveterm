#!/bin/bash
# This script is used to build the universal app for macOS

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

rm -f *.zip *.dmg
ZIP_DIR=$SCRIPT_DIR/zip
rm -rf $ZIP_DIR
mkdir $ZIP_DIR
TEMP_DIR=$SCRIPT_DIR/temp
rm -rf $TEMP_DIR
mkdir $TEMP_DIR
BUILDS_DIR=$SCRIPT_DIR/builds
rm -rf $BUILDS_DIR

# Download the builds zip
aws s3 cp s3://waveterm-github-artifacts/waveterm-builds.zip .
BUILDS_ZIP=waveterm-builds.zip
if ! [ -f $BUILDS_ZIP ]; then
    echo "no $BUILDS_ZIP found";
    exit 1;
fi
echo "unzipping $BUILDS_ZIP"
unzip -q $BUILDS_ZIP -d $BUILDS_DIR
rm $BUILDS_ZIP

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

X64_ZIP=$(find_build $BUILDS_DIR "Wave-darwin-x64-*.zip")
ARM64_ZIP=$(find_build $BUILDS_DIR "Wave-darwin-arm64-*.zip")
set -e

echo "unzipping zip files"
unzip -q $X64_ZIP -d $TEMP_DIR/x64
unzip -q $ARM64_ZIP -d $TEMP_DIR/arm64
rm $ARM64_ZIP $X64_ZIP

# Create universal app and sign and notarize it
TEMP_WAVE_DIR_ARM=$TEMP_DIR/x64/Wave.app
TEMP_WAVE_DIR_X64=$TEMP_DIR/arm64/Wave.app
TEMP_WAVE_DIR_UNIVERSAL=$TEMP_DIR/Wave.app
lipo -create -output $TEMP_DIR/wavesrv $TEMP_WAVE_DIR_X64/Contents/Resources/app/bin/wavesrv $TEMP_WAVE_DIR_ARM/Contents/Resources/app/bin/wavesrv
rm -rf $TEMP_WAVE_DIR_ARM/Contents/Resources/app
mv $TEMP_WAVE_DIR_X64/Contents/Resources/app $TEMP_DIR
cp $TEMP_DIR/wavesrv $TEMP_DIR/app/bin/wavesrv
mkdir $TEMP_WAVE_DIR_ARM/Contents/Resources/app
mkdir $TEMP_WAVE_DIR_X64/Contents/Resources/app
node $SCRIPT_DIR/build-universal.js
rm -rf $TEMP_WAVE_DIR_UNIVERSAL/Contents/Resources/app
mv $TEMP_DIR/app $TEMP_WAVE_DIR_UNIVERSAL/Contents/Resources/app
node $SCRIPT_DIR/osx-sign.js
DEBUG=electron-notarize node $SCRIPT_DIR/osx-notarize.js
echo "universal app creation success (build/sign/notarize)"

UVERSION="$(cat $BUILDS_DIR/version.txt)"
UPACKAGE_NAME="waveterm-macos-universal-${UVERSION}"

echo "creating universal zip"
ditto $TEMP_WAVE_DIR_UNIVERSAL $ZIP_DIR/Wave.app
ZIP_NAME="${UPACKAGE_NAME}.zip"
cd $ZIP_DIR
zip -9yqr $ZIP_NAME Wave.app
mv $ZIP_NAME $BUILDS_DIR/
cd $SCRIPT_DIR

# Expects create-dmg repo to be cloned in the same parent directory as the waveterm repo.
echo "creating universal dmg"
DMG_NAME="${UPACKAGE_NAME}.dmg"
$SCRIPT_DIR/../../create-dmg/create-dmg \
  --volname "WaveTerm" \
  --window-pos 200 120 \
  --window-size 600 300 \
  --icon-size 100 \
  --icon "Wave.app" 200 130 \
  --hide-extension "Wave.app" \
  --app-drop-link 400 125 \
  $DMG_NAME \
  "$TEMP_WAVE_DIR_UNIVERSAL"
echo "success, created $DMG_NAME"
mv $DMG_NAME $BUILDS_DIR/
spctl -a -vvv -t install $TEMP_WAVE_DIR_UNIVERSAL/

rm -rf $TEMP_DIR $ZIP_DIR
