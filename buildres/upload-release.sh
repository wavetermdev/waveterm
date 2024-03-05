#!/bin/bash
# This script is used to upload signed and notarized releases to S3 and update the Electron auto-update release feeds.

# Gets the directory of the script
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

BUILDS_DIR=$SCRIPT_DIR/builds
TEMP2_DIR=$SCRIPT_DIR/temp2

AUTOUPDATE_RELEASE_PATH="waveterm-test-autoupdate/autoupdate"

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

# Remove files we don't want to upload
rm $TEMP2_DIR/version.txt
rm $TEMP2_DIR/*.zip.blockmap
rm $TEMP2_DIR/builder-debug.yml

# Upload the artifacts
echo "Uploading build artifacts"
aws s3 cp $TEMP2_DIR/ s3://$AUTOUPDATE_RELEASE_PATH/ --recursive

# Clean up
echo "Cleaning up"
rm -rf $TEMP2_DIR
