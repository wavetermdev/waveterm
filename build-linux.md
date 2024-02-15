# Build Instructions for Wave Terminal on Linux

These instructions are for setting up the build on Linux (Ubuntu).
If you're developing on MacOS please use the [MacOS Build Instructions](./BUILD.md).
If you are working on a different Linux distribution, you may need to adapt some of these instructions to fit your environment.

## Running the Development Version of Wave

If you install the production version of Wave, you'll see a semi-transparent gray sidebar, and the data for Wave is stored in the directory ~/.waveterm. The development version has a blue sidebar and stores its data in ~/.waveterm-dev. This allows the production and development versions to be run simultaneously with no conflicts. If the dev database is corrupted by development bugs, or the schema changes in development it will not affect the production copy.

## Prereqs and Tools

Download and install Go (must be at least go 1.18). We also need gcc installed to run a CGO build (for Golang).
zip is required to build linux deployment packages (not required for running and debugging dev builds).

```
sudo snap install go --classic
sudo apt-get update
sudo apt-get install gcc
sudo apt-get install zip
```

Download and install [ScriptHaus](https://github.com/scripthaus-dev/scripthaus) (to run the build commands):

```
git clone https://github.com/scripthaus-dev/scripthaus.git
cd scripthaus
CGO_ENABLED=1 go build -o scripthaus cmd/main.go
```

You'll now have to move the built `scripthaus` binary to a directory in your path (e.g. /usr/local/bin):

```
sudo cp scripthaus /usr/local/bin
```

## Install nodejs, npm, and yarn

We use [nvm](https://github.com/nvm-sh/nvm) to install nodejs on Linux (you can use an alternate installer if you wish). You must have a relatively recent version of node in order to build the terminal. Different distributions and shells will require different setup instructions. These instructions work for Ubuntu 22 using bash (will install node v20.8.1):

```
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install v20.8.1
```

Now we can install yarn:

```
npm install -g yarn
```

## Clone the Wave Repo

Move out of the `scripthaus` directory if you're still in it. Clone the wave repository into the directory that you'd like to use for development.

```
git clone git@github.com:wavetermdev/waveterm.git
```

## One-Time Setup

Install Wave modules (we use yarn):

```
yarn
```

Electron also requires specific builds of node_modules to work (because Electron embeds a specific node.js version that might not match your development node.js version). We use a special electron command to cross-compile those modules:

```
scripthaus run electron-rebuild
```

## Building WaveShell / WaveSrv

cd into the waveterm directory (if you haven't already) and run the build-backend command using `scripthaus`.

```
cd waveterm
scripthaus run build-backend
```

This builds the Golang backends for Wave. The binaries will put in waveshell/bin and wavesrv/bin respectively. If you're working on a new plugin or other pure frontend changes to Wave, you won't need to rebuild these unless you pull new code from the Wave Repository.

## Running WebPack

We use webpack to build both the React and Electron App Wrapper code. They are both run together using:

```
scripthaus run webpack-watch
```

## Running the WaveTerm Dev Client

Now that webpack is running (and watching for file changes) we can finally run the WaveTerm Dev Client! To start the client run:

```
scripthaus run electron
```

To kill the client, either exit the Electron App normally or just Ctrl-C the `scripthaus run electron` command.

Because we're running webpack in watch mode, any changes you make to the typescript will be automatically picked up by the client after a refresh. Note that I've disabled hot-reloading in the webpack config, so to pick up new changes you'll have to manually refresh the WaveTerm Client window. To do that use "Command-Shift-R" (Command-R is used internally by Wave and will not force a refresh).

## Debugging the Dev Client

You can use the regular Chrome DevTools to debug the frontend application. You can open the DevTools using the keyboard shortcut `Cmd-Option-I`.
