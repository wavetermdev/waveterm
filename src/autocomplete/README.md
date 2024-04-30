# Newton autocomplete parser

Newton is a Fig-compatible autocomplete parser. It builds on a lot of goodness from the [@microsoft/inshellisense project](https://github.com/microsoft/inshellisense), with heavy modifications to minimize recursion and allow for caching of intermediate states. All suggestions, as with inshellisense, come from the [@withfig/autocomplete project](https://github.com/withfig/autocomplete).

Any exec commands that need to be run are proxied through the Wave backend to ensure no additional permissions are required.

The following features from Fig's object definitions are not yet supported:

-   Specs
    -   Versioned specs, such as the `az` CLI
    -   Custom specs from your filesystem
    -   Wave's slash commands and bracket syntax
        -   Slash commands will be added in a future PR, we just need to generate the proper specs for them
        -   Bracket syntax should not break the parser right now, you just won't get any suggestions when filling out metacommands within brackets
-   Suggestions
    -   Rich icons support and icons served from the filesystem
    -   `isDangerous` field
    -   `hidden` field
    -   `deprecated` field
    -   `replaceValue` field - this requires a bit more work to properly parse out the text that needs to be replaced.
    -   `previewComponent` field - this does not appear to be used by any specs right now
-   Subcommands
    -   `cache` field - All script outputs are currently cached for 5 minutes
-   Options
    -   `isPersistent` field - this requires a bit of work to make sure we pass forward the correct options to subcommands
    -   `isRequired` field - this should prioritize options that are required
    -   `isRepeatable` field - this should let a flag be repeated a specified number of times before being invalidated and no longer suggested
    -   `requiresEquals` field - this is deprecated, but some popular specs still use it
-   Args
    -   `suggestCurrentToken` field
    -   `isDangerous` field
    -   `isScript` field
    -   `isModule` field - only Python uses this right now
    -   `debounce` field
    -   `default` field
    -   `parserDirectives.alias` field
-   Generators
    -   `getQueryTerm` field
    -   `cache` field - All script outputs are currently cached for 5 minutes
