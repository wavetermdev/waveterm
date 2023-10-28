# Code Editor for Wave Terminal

These instructions are for setting up the build on MacOS.
If you're developing on Linux please use the [Linux Build Instructions](./build-linux.md).

## Running the Development Version of Wave

If you install the production version of Wave, you'll see a semi-transparent sidebar, and the data for Wave is stored in the directory ~/prompt. The development version has a red/brown sidebar and stores its data in ~/prompt-dev. This allows the production and development versions to be run simultaneously with no conflicts. If the dev database is corrupted by development bugs, or the schema changes in development it will not affect the production copy.
