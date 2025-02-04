# Building for release

## Step-by-step guide

1. Go to the [Actions tab](https://github.com/wavetermdev/waveterm/actions) and select "Bump Version" from the left sidebar.
2. Click on "Run workflow".
   - You will see two options:
     - "SemVer Bump": This defaults to `none`. Adjust this if you want to increment the version number according to semantic versioning rules (`patch`, `minor`, `major`).
     - "Is Prerelease": This defaults to `true`. If set to `true`, a `-beta.X` version will be appended to the end of the version. If one is already present and the base SemVer is not being incremented, the `-beta` version will be incremented (i.e. `0.11.1-beta.0` to `0.11.1-beta.1`). If set to `false`, the `-beta.X` suffix will be removed from the version number. If one was not already present, it will remain absent.
   - Some examples:
     - If you are creating a new prerelease following an official release, you would set "SemVer Bump" to to the expected version bump (`patch`, `minor`, or `major`) and "Is Prerelease" to `true`.
     - If you are bumping an existing prerelease to a new prerelease under the same version, you would set "SemVer Bump" to `none` and "Is Prerelease" to `true`.
     - If you are promoting a prerelease version to an official release, you would set "SemVer Bump" to `none` and "Is Prerelease" to `false`.
3. After "Bump Version" a "Build Helper" run will kick off automatically for the new version. When this completes, it will generate a [draft GitHub Release](https://github.com/wavetermdev/waveterm/releases) with all the built artifacts.
4. Review the artifacts in the release and test them locally.
5. When you are confident that the build is good, edit the GitHub Release to add a changelog and release summary and publish the release.
6. The new version will be published to our release feed automatically when the GitHub Release is published. If the build is a prerelease, it will only release to users subscribed to the `beta` channel. If it is a general release, it will be released to all users.

## Details

### Bump Version workflow

All releases start by first bumping the package version and creating a new Git tag. We have a workflow set up to automate this.

To run it, trigger a new run of the [Bump Version workflow](https://github.com/wavetermdev/waveterm/actions/workflows/bump-version.yml). When triggering the run, you will be prompted to select a version bump type, either `none`, `patch`, `minor`, or `major`, and whether the version is prerelease or not. This determines how much the version number is incremented.

See [`version.cjs`](./version.cjs) for more details on how this works.

Once the tag has been created, a new [Build Helper](#build-helper-workflow) run will be automatically queued to generate the artifacts.

### Build Helper workflow

Our release builds are managed by the [Build Helper workflow](https://github.com/wavetermdev/waveterm/actions/workflows/build-helper.yml).

Under the hood, this will call the `package` task in [`Taskfile.yml`](./Taskfile.yml), which will build the `wavesrv` and `wsh` binaries, then the frontend and Electron codebases using Vite, then it will call `electron-builder` to generate the distributable app packages. The configuration for `electron-builder` is defined in [`electron-builder.config.cjs`](./electron-builder.config.cjs).

This will also sign and notarize the macOS app packages and sign the Windows packages.

Once a build is complete, the artifacts will be placed in `s3://waveterm-github-artifacts/staging-w2/<version>`. A new draft release will be created on GitHub and the artifacts will be uploaded there too.

### Testing new releases

The [Build Helper workflow](https://github.com/wavetermdev/waveterm/actions/workflows/build-helper.yml). creates a draft release on GitHub once it completes. You can find this on the [Releases page](https://github.com/wavetermdev/waveterm/releases) of the repo. You can use this to download the build artifacts for testing.

You can also use the `artifacts:download` task in the [`Taskfile.yml`](./Taskfile.yml) to download all the artifacts for a build. You will need to configure an AWS CLI profile with write permissions for the S3 buckets in order for the script to work. You should invoke the tasks as follows:

```bash
task artifacts:download:<version> -- --profile <aws-profile>
```

### Publishing a release

Once you have validated that the new release is ready, navigate to the [Releases page](https://github.com/wavetermdev/waveterm/releases) and click on the draft release for the version that is ready. Click the pencil button in the top right corner to edit the draft. Use this opportunity to adjust the release notes as needed. When you are ready to publish, scroll all the way to the bottom of the release editor and click Publish. This will kick off the [Publish Release workflow](https://github.com/wavetermdev/waveterm/actions/workflows/publish-release.yml), at which point all further tasks are automated and hands-off.

### Automatic updates

Thanks to [`electron-updater`](https://www.electron.build/auto-update.html), we are able to provide automatic app updates for macOS, Linux, and Windows, as long as the app was distributed as a DMG, AppImage, RPM, or DEB file (all Windows targets support auto updates).

With each release, YAML files will be produced that point to the newest release for the current channel. These also include file sizes and checksums to aid in validating the packages. The app will check these files in our S3 bucket every hour to see if a new version is available.

#### Update channels

We utilize update channels to roll out beta and stable releases. These are determined based on the package versioning [described above](#bump-version-workflow). Users can select their update channel using the `autoupdate:channel` setting in Wave. See [here](https://www.electron.build/tutorials/release-using-channels.html) for more information.

### Package Managers

We currently publish to Homebrew (macOS), WinGet (Windows), Chocolatey (Windows), and Snap (Linux or macOS).

#### Homebrew

Homebrew maintains an Autobump bot that regularly checks our release feed for new general releases and updates our Cask automatically. You can find the configuration for our cask [here](https://github.com/Homebrew/homebrew-cask/blob/master/Casks/w/wave.rb). We added ourselves to [this list](https://github.com/Homebrew/homebrew-cask/blob/master/.github/autobump.txt) to indicate that we want the bot to autobump us.

#### WinGet

WinGet uses PRs to manage version bumps for packages. They ship a tool called [`wingetcreate`](https://github.com/microsoft/winget-create) which automates most of this process. We run this tool in our [Publish Release workflow](https://github.com/wavetermdev/waveterm/actions/workflows/publish-release.yml) for all general releases. This publishes a PR to their repository using our [Wave Release Bot](https://github.com/wave-releaser) service account. They usually pick up these changes within a day.

#### Chocolatey

Chocolatey maintains a [PowerShell module](https://github.com/chocolatey-community/chocolatey-au) for publishing releases to their system. We have a separate repository which contains this script and the workflow to run it: [wavetermdev/chocolatey](https://github.com/wavetermdev/chocolatey). This workflow gets run once a day. It checks whether there are new changes, validates the SHA and that the package can install, and then pushes the new version to Chocolatey. It then commits the updated package spec back to our repository. They usually take up to two weeks to accept our updates.

#### Snap

Snap maintains [snapcraft](https://snapcraft.io/docs/snapcraft) to build and publish Snaps to the Snap Store. We run this tool in our [Publish Release workflow](https://github.com/wavetermdev/waveterm/actions/workflows/publish-release.yml) workflow for all beta and general releases. Beta releases publish only to the `beta` channel, while general releases publish to both `beta` and `stable`. These changes are picked up immediately.

### `electron-build` configuration

Most of our configuration is fairly standard. The main exception to this is that we exclude our Go binaries from the ASAR archive that Electron generates. ASAR files cannot be executed by NodeJS because they are not seen as files and therefore cannot be executed via a Shell command. More information can be found [here](https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive).

We also exclude most of our `node_modules` from packaging, as Vite handles packaging of any dependencies for us. The one exception is `monaco-editor`.
