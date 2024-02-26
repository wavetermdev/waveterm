#!/bin/bash
# This script is used to upload signed and notarized releases to S3 and update the Electron auto-update release feeds.

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

BUILDS_DIR=$SCRIPT_DIR/builds
TEMP2_DIR=$SCRIPT_DIR/temp2

# Copy the builds to the temp2 directory
echo "Copying builds to temp2"
rm -rf $TEMP2_DIR
mkdir -p $TEMP2_DIR
cp -r $BUILDS_DIR/* $TEMP2_DIR

UVERSION=$(cat $TEMP2_DIR/version.txt)

if [ -z "$UVERSION" ]; then
    echo "version.txt is empty"
    exit 1
fi

# Find the DMG file
echo "Finding DMG"
DMG=$(find $TEMP2_DIR -type f -iname "*.dmg")
# Ensure there is only one
NUM_DMGS=$(echo $DMG | wc -l)
if [ "0" -eq "$NUM_DMGS" ]; then
    echo "no DMG found in $TEMP2_DIR"
    exit 1
elif [ "1" -lt "$NUM_DMGS" ]; then
    echo "multiple DMGs found in $TEMP2_DIR"
    exit 1
fi

# Find the Mac zip
echo "Finding Mac zip"
MAC_ZIP=$(find $TEMP2_DIR -type f -iname "*mac*.zip")
# Ensure there is only one
NUM_MAC_ZIPS=$(echo $MAC_ZIP | wc -l)
if [ "0" -eq "$NUM_MAC_ZIPS" ]; then
    echo "no Mac zip found in $TEMP2_DIR"
    exit 1
elif [ "1" -lt "$NUM_MAC_ZIPS" ]; then
    echo "multiple Mac zips found in $TEMP2_DIR"
    exit 1
fi

# Find the Linux zips
echo "Finding Linux zips"
LINUX_ZIPS=$(find $TEMP2_DIR -type f -iname "*linux*.zip")
# Ensure there is at least one
NUM_LINUX_ZIPS=$(echo $LINUX_ZIPS | wc -l)
if [ "0" -eq "$NUM_LINUX_ZIPS" ]; then
    echo "no Linux zips found in $TEMP2_DIR"
    exit 1
fi

# Upload the DMG
echo "Uploading DMG"
DMG_NAME=$(basename $DMG)
aws s3 cp $DMG s3://waveterm-test-autoupdate/$DMG_NAME

# Upload the Linux zips
echo "Uploading Linux zips"
for LINUX_ZIP in $LINUX_ZIPS; do
    LINUX_ZIP_NAME=$(basename $LINUX_ZIP)
    aws s3 cp $LINUX_ZIP s3://waveterm-test-autoupdate/$LINUX_ZIP_NAME
done

# Upload the autoupdate Mac zip
echo "Uploading Mac zip"
MAC_ZIP_NAME=$(basename $MAC_ZIP)
aws s3 cp $MAC_ZIP s3://waveterm-test-autoupdate/autoupdate/$MAC_ZIP_NAME

# Update the autoupdate feeds
echo "Updating autoupdate feeds"
RELEASES_CONTENTS="{\"name\": \"$UVERSION\", \"notes\": \"\", \"url\": \"https://waveterm-test-autoupdate.s3.us-west-2.amazonaws.com/autoupdate/$MAC_ZIP_NAME\"}"
aws s3 cp - s3://waveterm-test-autoupdate/autoupdate/darwin/arm64/RELEASES.json <<< $RELEASES_CONTENTS
aws s3 cp - s3://waveterm-test-autoupdate/autoupdate/darwin/x64/RELEASES.json <<< $RELEASES_CONTENTS

# Clean up
echo "Cleaning up"
rm -rf $TEMP2_DIR
