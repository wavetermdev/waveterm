# Build Instructions for Wave Terminal

## Running the Development Version of Wave

If you install the production version of Wave, you'll see a semi-transparent sidebar, and the data for Wave is stored in the directory ~/prompt.  The development version has a red/brown sidebar and stores its data in ~/prompt-dev.  This allows the production and development versions to be run simultaneously with no conflicts.  If the dev database is corrupted by development bugs, or the schema changes in development it will not affect the production copy.

## Prereqs and Tools

Download and install Go (must be at least go 1.18):
```
brew install go
```

Download and install ScriptHaus (to run the build commands):
```
brew tap scripthaus-dev/scripthaus
brew install scripthaus
```

## Clone the Repo

```
git clone git@github.com:wavetermdev/waveterm.git
```

## Building WaveShell / WaveSrv

```
scripthaus run build-backend
```

This builds the Golang backends for Wave.  The binaries will put in waveshell/bin and wavesrv/bin respectively.  If you're working on a new plugin or other pure frontend changes to Wave, you won't need to rebuild these unless you pull new code from the Wave Repository.

## One-Time Setup

Install modules (we use yarn):
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


