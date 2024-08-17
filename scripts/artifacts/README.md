# Building for release

## Build Helper workflow

Our release builds are managed by the "Build Helper" GitHub Action, which is defined
in [`build-helper.yml`](../../.github/workflows/build-helper.yml).

Under the hood, this will call the `package` task in
[`Taskfile.yml`](../../Taskfile.yml), which will build the Electron codebase using
WebPack and then the `wavesrv` and `mshell` binaries, then it will call `electron-builder`
to generate the distributable app packages. The configuration for `electron-builder`
is [`electron-builder.config.cjs`](../../electron-builder.config.cjs).

This will also sign and notarize the macOS app package.

Once a build is complete, it will be placed in `s3://waveterm-github-artifacts/staging-w2/<version>`.
It can be downloaded for testing using the [`download-staged-artifact.sh`](./download-staged-artifact.sh)
script. When you are ready to publish the artifacts to the public release feed, use the
[`publish-from-staging.sh`](./publish-from-staging.sh) script to directly copy the artifacts from
the staging bucket to the releases bucket.

You will need to configure an AWS CLI profile with write permissions for the S3 buckets in order for the script to work. You should invoke the script as follows:

```bash
<script> <version> <aws-profile-name>
```

## Automatic updates

Thanks to `electron-updater`, we are able to provide automatic app updates for macOS and Linux,
as long as the app was distributed as a DMG, AppImage, RPM, or DEB file.

With each release, `latest-mac.yml`, `latest-linux.yml`, and `latest-linux-arm64.yml` files will be produced that point to the
newest release. These also include file sizes and checksums to aid in validating the packages. The app
will check these files in our S3 bucket every hour to see if a new version is available.

### Homebrew

Homebrew is automatically bumped when new artifacts are published.

### Linux

We do not currently submit the Linux packages to any of the package repositories. We
are working on addressing this in the near future.

## `electron-build` configuration

Most of our configuration is fairly standard. The main exception to this is that we exclude
our Go binaries from the ASAR archive that Electron generates. ASAR files cannot be executed
by NodeJS because they are not seen as files and therefore cannot be executed via a Shell
command. More information can be found
[here](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive).

We also exclude most of our `node_modules` from packaging, as Vite handles packaging
of any dependencies for us. The one exception is `monaco-editor`.
