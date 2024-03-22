# Autocomplete parser

This is the autocomplete parser for Wave. Much of the runtime for this parser is forked from the [@microsoft/inshellisense project](https://github.com/microsoft/inshellisense). We've modified the exec code to proxy commands to the active `waveshell` instance. All suggestions, as with inshellisense, come from the [@withfig/autocomplete project](https://github.com/withfig/autocomplete). We will be supplementing these with some of our own autocomplete for our own `/slashcommands` and `metacommands`.
