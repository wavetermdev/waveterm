# Build Instructions for Wave Terminal on Linux

These instructions are for setting up the build on Linux. 
If you're developing on MacOS please use the [MacOS Build Instructions](./BUILD.md).

## Running the Development Version of Wave

If you install the production version of Wave, you'll see a semi-transparent sidebar, and the data for Wave is stored in the directory ~/prompt.  The development version has a red/brown sidebar and stores its data in ~/prompt-dev.  This allows the production and development versions to be run simultaneously with no conflicts.  If the dev database is corrupted by development bugs, or the schema changes in development it will not affect the production copy.

## Prereqs and Tools

Download and install Go (must be at least go 1.18):
```
sudo snap install go --classic
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


## Clone the Wave Repo

```
git clone git@github.com:wavetermdev/waveterm.git
```

## Building WaveShell / WaveSrv

```
scripthaus run build-backend
```

This builds the Golang backends for Wave.  The binaries will put in waveshell/bin and wavesrv/bin respectively.  If you're working on a new plugin or other pure frontend changes to Wave, you won't need to rebuild these unless you pull new code from the Wave Repository.

## Install nodejs, npm, and yarn

We use [nvm](https://github.com/nvm-sh/nvm) to install nodejs on Linux (you can use an alternate installer if you wish).  You must have a relatively recent version of node in order to build the terminal.  Different distributions and shells will require different setup instructions.  These instructions work for Ubuntu 22 using bash (will install node v20.8.1):

```
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install v20.8.1
```

Now we can install yarn:

```
sudo npm install -g yarn
```

## One-Time Setup

Install Wave modules (we use yarn):
```
yarn
```

Electron also requires specific builds of node_modules to work (because Electron embeds a specific node.js version that might not match your development node.js version).  We use a special electron command to cross-compile those modules:

```
scripthaus run electron-rebuild
```

## Running WebPack

Two webpacks are required to run the client.  One webpack will build the React code that runs inside of Electron.  The other webpack builds the node.js code for the Electron App Wrapper.

For the React code:
```
scripthaus run webpack-watch
```

For the Electron App:
```
scripthaus run webpack-electron-watch
```

## Running the Prompt Dev Client

Now that webpack is running (and watching for file changes) we can finally run the Prompt Dev Client!  To start the client run:
```
scripthaus run electron
```

To kill the client, either exit the Electron App normally or just Ctrl-C the ```scripthaus run electron``` command.

Because we're running webpack in watch mode, any changes you make to the typescript will be automatically picked up by the client after a refresh.  Note that I've disabled hot-reloading in the webpack config, so to pick up new changes you'll have to manually refresh the Prompt Client window.  To do that use "Command-Shift-R" (Command-R is used internally by Prompt and will not force a refresh).


