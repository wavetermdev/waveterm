# Contributing to Wave Terminal

We welcome and value contributions to Wave Terminal! Wave is an open source project, always open for contributors. There are several ways you can contribute:

- Submit issues related to bugs or new feature requests
- Fix outstanding [issues](https://github.com/wavetermdev/waveterm/issues) with the existing code
- Contribute to [documentation](./docs)
- Spread the word on social media (tag us on [LinkedIn](https://www.linkedin.com/company/wavetermdev), [Twitter/X](https://x.com/wavetermdev))
- Or simply ⭐️ the repository to show your appreciation

However you choose to contribute, please be mindful and respect our [code of conduct](./CODE_OF_CONDUCT.md).

> All contributions are highly appreciated! 🥰

## Before You Start

We accept patches in the form of github pull requests. If you are new to github, please review this [github pull request guide](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests).

### Contributor License Agreement

Contributions to this project must be accompanied by a Contributor License Agreement (CLA). You (or your employer) retain the copyright to your contribution, this simply gives us permission to use and redistribute your contributions as part of the project.

> On submission of your first pull request you will be prompted to sign the CLA confirming your original code contribution and that you own the intellectual property.

### Style guide

The project uses American English.

We have a set of recommended Visual Studio Code extensions to enforce our style and quality standards. Please ensure you use these, especially [Prettier](https://prettier.io) and [EditorConfig](https://editorconfig.org), when contributing to our code.

## How to contribute

- For minor changes, you are welcome to [open a pull request](https://github.com/wavetermdev/waveterm/pulls).
- For major changes, please [create an issue](https://github.com/wavetermdev/waveterm/issues/new) first.
- If you are looking for a place to start take a look at [Good First Issues](https://github.com/wavetermdev/waveterm/issues?q=is:issue%20state:open%20label:%22good%20first%20issue%22).
- Join the [Discord channel](https://discord.gg/XfvZ334gwU) to collaborate with the community on your contribution.

### Development Environment

To build and run Wave locally, see instructions at [Building Wave Terminal](./BUILD.md).

### Create a Pull Request

Guidelines:

- Before writing any code, please look through existing PRs or issues to make sure nobody is already working on the same thing.
- Develop features on a branch - do not work on the main branch
- For anything but minor fixes, please submit tests and documentation
- Please reference the issue in the pull request

## Project Structure

The project is broken into four main components: frontend, emain, wavesrv, and wsh. This section is a work-in-progress as our codebase is constantly changing.

### Frontend

Our frontend can be found in the [`/frontend`](./frontend/) directory. It is written in React Typescript. The main entrypoint is [`wave.ts`](./frontend/wave.ts) and the root for the React VDOM is [`app.tsx`](./frontend/app/app.tsx). If you are using `task dev` to run your dev instance of the app, the frontend will be loaded using Vite, which allows for Hot Module Reloading. This should work for most styling and simple component changes, but anything that affects the state of the app (the Jotai or layout code, for instance) may put the frontend into a bad state. If this happens, you can force reload the frontend using `Cmd:Shift:R` or `Ctrl:Shift:R`.

### emain

emain can be found at [`/emain`](./emain/). It is the main NodeJS process and is first thing that is run when you start up the app and it forks off the process for the wavesrv backend and manages all the Electron interfaces, such as window and view management, context menus, and native UI calls. Its main entrypoint is [`emain.ts`](./emain/emain.ts). This process does not hot-reload, you will need to manually kill the dev instance and rerun it to apply changes.

The frontend and emain communicate using the [Electron IPC mechanism](https://www.electronjs.org/docs/latest/tutorial/ipc). All exposed functions between the two are defined twice, once in [`preload.ts`](./emain/preload.ts) and once in [`custom.d.ts`](./frontend/types/custom.d.ts). On the frontend, you call the exposed function by calling `getApi().<function>()`.

### wavesrv

wavesrv can be found at [`/cmd/server`](./cmd/server), with most business logic located in [`/pkg`](./pkg/). It is the primary Go backend for our app and manages the database and all communications with remote hosts. Its main entrypoint is [`main-server.go`](./cmd/server/main-server.go). This process does not hot-reload, you will need to manually kill the dev instance and rerun it to apply changes.

Communication between the wavesrv and the frontend and emain is handled by both HTTP services (found at [`/pkg/service`](./pkg/service/)) and wshrpc via WebSocket (found at [`/pkg/wshrpc`](./pkg/wshrpc/)).

### wsh

wsh can be found at [`/cmd/wsh`](./cmd/wsh/). It serves two purposes: it functions as a CLI tool for controlling Wave from the command line and it functions as a server on remote machines to facilitate multiplexing terminal sessions over a single connection and streaming files between the remote host and the local host. This process does not hot-reload, you will need to manually kill the dev instance and rerun it to apply changes.

Communication between wavesrv and wsh is handled by wshrpc via either forwarded domain socket or WebSocket, depending on what the remote host supports.
