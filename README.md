# The Next Wave

Prereqs:

You'll need to install "task" (which we're using as a build/run system):

```
brew install go-task
```

On first checkout:

```
yarn
go mod tidy
```

To run the app, you'll first need to run the webpack watcher:

```
task webpack
```

Then, in a separate terminal, this command will run the electron app:

```
task electron
```
