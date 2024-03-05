#!/bin/bash
# This script is used to sign and notarize the universal app for macOS

# Gets the directory of the script
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# Remove old files and dirs, create new ones
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

# Finds a file in a directory matching a filename pattern. Ensures there is exactly one match.
find_file() 
{
    local FILE_DIR=$1
    local FILE_PATTERN=$2
    local FILE_PATH=$(find $FILE_DIR -type f -iname "$FILE_PATTERN")
    local NUM_MATCHES=$(echo $FILE_PATH | wc -l)
    if [ "0" -eq "$NUM_MATCHES" ]; then
        echo "no $FILE_PATTERN found in $FILE_DIR"
        exit 1
    elif [ "1" -lt "$NUM_MATCHES" ]; then
        echo "multiple $FILE_PATTERN found in $FILE_DIR"
        exit 1
    fi
    echo $FILE_PATH
}

# Unzip Mac build
MAC_ZIP=$(find_file $BUILDS_DIR "Wave-darwin-universal-*.zip")
unzip -q $MAC_ZIP -d $TEMP_DIR

# Sign and notarize the app
node $SCRIPT_DIR/osx-sign.js
DEBUG=electron-notarize node $SCRIPT_DIR/osx-notarize.js

# Zip and move
echo "creating universal zip"
ZIP_NAME=$(basename $MAC_ZIP)
TEMP_WAVE_DIR_UNIVERSAL=$TEMP_DIR/Wave.app
ditto $TEMP_WAVE_DIR_UNIVERSAL $ZIP_DIR/Wave.app
cd $ZIP_DIR
zip -9yqr $ZIP_NAME Wave.app
mv $ZIP_NAME $BUILDS_DIR/
cd $SCRIPT_DIR

# Create a dmg
# Expects create-dmg repo to be cloned in the same parent directory as the waveterm repo.
echo "creating universal dmg"
DMG_NAME=$(echo $ZIP_NAME | sed 's/\.zip/\.dmg/')
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

# Update latest-mac.yml
echo "updating latest-mac.yml"
LATEST_MAC_YML=$BUILDS_DIR/latest-mac.yml
node $SCRIPT_DIR/update-latest-mac.js $MAC_ZIP $LATEST_MAC_YML

# Clean up
rm -rf $TEMP_DIR $ZIP_DIR