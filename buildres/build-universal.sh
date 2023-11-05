#!/bin/bash

# assumes we have Wave-darwin-x64-[version].zip and Wave-darwin-arm64-[version].zip in current directory
VERSION=0.5.0
rm -rf temp
mkdir temp
mkdir temp/x64
X64_ZIP="Wave-darwin-x64-$VERSION.zip"
ARM64_ZIP="Wave-darwin-arm64-$VERSION.zip"
if ! [ -f $X64_ZIP ]; then
    echo "no $X64_ZIP found";
    exit 1;
fi
if ! [ -f $ARM64_ZIP ]; then
    echo "no $ARM64_ZIP found"
    exit 1;
fi
echo "unzipping version v$VERSION zip files"
unzip -q $X64_ZIP -d temp/x64
mkdir temp/arm64
unzip -q $ARM64_ZIP -d temp/arm64
lipo -create -output temp/wavesrv temp/x64/Wave.app/Contents/Resources/app/bin/wavesrv temp/arm64/Wave.app/Contents/Resources/app/bin/wavesrv
rm -rf temp/arm64/Wave.app/Contents/Resources/app
mv temp/x64/Wave.app/Contents/Resources/app temp/
mkdir temp/x64/Wave.app/Contents/Resources/app
mkdir temp/arm64/Wave.app/Contents/Resources/app
node build-universal.js
rm -rf temp/Wave.app/Contents/Resources/app
mv temp/app temp/Wave.app/Contents/Resources/app


