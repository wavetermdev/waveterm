# Building for release

## Build Helper workflow

Our release builds are managed by the "Build Helper" GitHub Action, which is defined
in [`build-helper.yml`](../.github/workflows/build-helper.yml).

Under the hood, this will call the `build-package` and `build-package-linux` scripts in
[`scripthaus.md`](../scripthaus.md), which will build the Electron codebase using
WebPack and then the `wavesrv` and `mshell` binaries, then it will call `electron-builder`
to generate the distributable app packages. The configuration for `electron-builder`
is [`electron-builder.config.js`](../electron-builder.config.js).

This will also sign and notarize the macOS app package.

Once a build is complete, it will be placed in `s3://waveterm-github-artifacts/staging/<version>`.
It can be downloaded for testing using the [`download-staged-artifact.sh`](./download-staged-artifact.sh)
script. When you are ready to publish the artifacts to the public release feed, use the
[`publish-from-staging.sh`](./publish-from-staging.sh) script to directly copy the artifacts from
the staging bucket to the releases bucket.

## Local signing and notarizing for macOS (Deprecated)

The [`prepare-macos.sh`](./deprecated/prepare-macos.sh) script will download the latest build
artifacts from S3 and sign and notarize the macOS binaries within it. It will then
generate a DMG and a new ZIP archive with the new signed app.

This will call a few different JS scripts to perform more complicated operations.
[`osx-sign.js`](./deprecated/osx-sign.js) and [`osx-notarize.js`](./deprecated/osx-notarize.js) call
underlying Electron APIs to sign and notarize the package.
[`update-latest-mac.js`](./deprecated/update-latest-mac.js) will then update the `latest-mac.yml`
file with the SHA512 checksum and file size of the new signed and notarized installer. This
is important for the `electron-updater` auto-update mechanism to then find and validate new releases.

## Uploading release artifacts for distribution (Deprecated)

### Upload script

Once the build has been fully validated and is ready to be released, the
[`upload-release.sh`](./deprecated/upload-release.sh) script is then used to grab the completed
artifacts and upload them to the `dl.waveterm.dev` S3 bucket for distribution.

### Homebrew

Homebrew currently requires a manual bump of the version, but now that we have auto-updates,
we should add our cask to the list of apps that can be automatically bumped.

### Linux

We do not currently submit the Linux packages to any of the package repositories. We
are working on addressing this in the near future.

## `electron-build` configuration

Most of our configuration is fairly standard. The main exception to this is that we exclude
our Go binaries from the ASAR archive that Electron generates. ASAR files cannot be executed
by NodeJS because they are not seen as files and therefore cannot be executed via a Shell
command. More information can be found
[here](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive).

We also exclude most of our `node_modules` from packaging, as WebPack handles packaging
of any dependencies for us. The one exception is `monaco-editor`.

## Automatic updates

Thanks to `electron-updater`, we are able to provide automatic app updates for macOS and Linux,
as long as the app was distributed as a DMG, AppImage, RPM, or DEB file.

With each release, `latest-mac.yml` and `latest-linux.yml` files will be produced that point to the
newest release. These also include file sizes and checksums to aid in validating the packages. The app
will check these files in our S3 bucket every hour to see if a new version is available.
