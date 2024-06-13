# The Next Wave

Prereqs:

You'll need to install "task" (which we're using as a build/run system):

```sh
brew install go-task
```

On first checkout:

```sh
yarn
go mod tidy
```

Then, run the following command to start the app using the Vite dev server (this will enable Hot Module Reloading):

```sh
task electron:dev
```

To run the app without the dev server, run the following instead:

```sh
task electron:start
```
