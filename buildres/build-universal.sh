# assumes we have Wave-darwin-x64-[version].zip and Wave-darwin-arm64-[version].zip in current directory
VERSION=0.5.0
rm -rf temp
mkdir temp
mkdir temp/x64
unzip "Wave-darwin-x64-$VERSION.zip" -d temp/x64
mkdir temp/arm64
unzip "Wave-darwin-arm64-$VERSION.zip" -d temp/arm64
lipo -create -output temp/wavesrv temp/x64/Wave.app/Contents/Resources/app/bin/wavesrv temp/arm64/Wave.app/Contents/Resources/app/bin/wavesrv
rm -rf temp/arm64/Wave.app/Contents/Resources/app
mv temp/x64/Wave.app/Contents/Resources/app temp/
mkdir temp/x64/Wave.app/Contents/Resources/app
mkdir temp/arm64/Wave.app/Contents/Resources/app
node build-universal.js
rm -rf temp/Wave.app/Contents/Resources/app
mv temp/app temp/Wave.app/Contents/Resources/app


