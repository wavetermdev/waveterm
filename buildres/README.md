# Building for release

## Build Helper workflow

Our release builds are managed by the "Build Helper" GitHub Action, which is defined 
in [`build-helper.yml`](../.github/workflows/build-helper.yml).

Under the hood, this will call the `build-package` and `build-package-linux` scripts in
[`scripthaus.md`](../scripthaus.md), which will build the Electron codebase using
WebPack and then the `wavesrv` and `mshell` binaries, then it will call `electron-builder`
to generate the distributable app packages. The configuration for `electron-builder`
is [`electron-builder.config.js`](../electron-builder.config.js).

We are working to fully automate the building of release artifacts. For now,
manual steps are still required to sign and notarize the macOS artifacts. The
Linux artifacts do not require additional modification before being published.

## Local signing and notarizing for macOS

The [`prepare-macos.sh`](./prepare-macos.sh) script will download the latest build
artifacts from S3 and sign and notarize the macOS binaries within it. It will then
generate a DMG and a new ZIP archive with the new signed app.

## Uploading release artifacts for distribution

### Upload script

Once the build has been fully validated and is ready to be released, the
[`upload-release.sh`](./upload-release.sh) script is then used to grab the completed
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
