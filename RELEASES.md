# Building for release

## Step-by-step guide

1. Go to the [Actions tab](https://github.com/wavetermdev/thenextwave/actions) and select "Bump Version" from the left sidebar.
2. Click on "Run workflow". You will see two options:
   - "SemVer Bump": This defaults to `none`. Adjust this if you want to increment the version number according to semantic versioning rules (`patch`, `minor`, `major`).
   - "Is Prerelease": This defaults to `true`. If set to `true`, a `-beta.X` version will be appended to the end of the version. If one is already present and the base SemVer is not being incremented, the `-beta` version will be incremented (i.e. `0.1.13-beta.0` to `0.1.13-beta.1`).
3. After "Bump Version" a "Build Helper" run will kick off automatically for the new version. When this completes, it will generate a draft GitHub Release with all the built artifacts.
4. Review the artifacts in the release and test them locally.
5. When you are confident that the build is good, edit the GitHub Release to add a changelog and release summary and publish the release.
6. The new version will be published to our release feed automatically when the GitHub Release is published. If the build is a prerelease, it will only release to users subscribed to the `beta` channel. If it is a general release, it will be released to all users.

## Details

### Bump Version workflow

All releases start by first bumping the package version and creating a new Git tag. We have a workflow set up to automate this.

To run it, trigger a new run of the [Bump Version workflow](https://github.com/wavetermdev/thenextwave/actions/workflows/bump-version.yml). When triggering the run, you will be prompted to select a version bump type, either `none`, `patch`, `minor`, or `major`, and whether the version is prerelease or not. This determines how much the version number is incremented.

See [`version.cjs`](../../version.cjs) for more details on how this works.

Once the tag has been created, a new [Build Helper](#build-helper-workflow) run will be automatically queued to generate the artifacts.

### Build Helper workflow

Our release builds are managed by the [Build Helper workflow](https://github.com/wavetermdev/thenextwave/actions/workflows/build-helper.yml).

Under the hood, this will call the `package` task in [`Taskfile.yml`](../../Taskfile.yml), which will build the `wavesrv` and `wsh` binaries, then the frontend and Electron codebases using Vite, then it will call `electron-builder` to generate the distributable app packages. The configuration for `electron-builder` is defined in [`electron-builder.config.cjs`](../../electron-builder.config.cjs).

This will also sign and notarize the macOS app package.

Once a build is complete, it will be placed in `s3://waveterm-github-artifacts/staging-w2/<version>`. It can be downloaded for testing using the `artifacts:download:*` task. When you are ready to publish the artifacts to the public release feed, use the `artifacts:publish:*` task to directly copy the artifacts from the staging bucket to the releases bucket.

You will need to configure an AWS CLI profile with write permissions for the S3 buckets in order for the script to work. You should invoke the tasks as follows:

```bash
task artifacts:<download or publish>:<version> -- --profile <aws-profile>
```

### Automatic updates

Thanks to [`electron-updater`](https://www.electron.build/auto-update.html), we are able to provide automatic app updates for macOS, Linux, and Windows, as long as the app was distributed as a DMG, AppImage, RPM, or DEB file (all Windows targets support auto updates).

With each release, YAML files will be produced that point to the newest release for the current channel. These also include file sizes and checksums to aid in validating the packages. The app will check these files in our S3 bucket every hour to see if a new version is available.

#### Update channels

We utilize update channels to roll out beta and stable releases. These are determined based on the package versioning [described above](#bump-version-workflow). Users can select their update channel using the `autoupdate:channel` setting in Wave. See [here](https://www.electron.build/tutorials/release-using-channels.html) for more information.

#### Homebrew

Homebrew is automatically bumped when new artifacts are published.

#### Linux

We do not currently submit the Linux packages to any of the package repositories. We are working on addressing this in the near future.

### `electron-build` configuration

Most of our configuration is fairly standard. The main exception to this is that we exclude our Go binaries from the ASAR archive that Electron generates. ASAR files cannot be executed by NodeJS because they are not seen as files and therefore cannot be executed via a Shell command. More information can be found [here](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive).

We also exclude most of our `node_modules` from packaging, as Vite handles packaging of any dependencies for us. The one exception is `monaco-editor`.
