# Newton autocomplete parser

Newton is a Fig-compatible autocomplete parser. It builds on a lot of goodness from the [@microsoft/inshellisense project](https://github.com/microsoft/inshellisense), with heavy modifications to minimize recursion and allow for caching of intermediate states. All suggestions, as with inshellisense, come from the [@withfig/autocomplete project](https://github.com/withfig/autocomplete). We will be supplementing these with some of our own autocomplete for our own `/slashcommands` and `metacommands`.

Any exec commands that need to be run are proxied through the Wave backend to ensure no additional permissions are required.
