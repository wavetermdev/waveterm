# Open-Source License Disclaimers

In order to comply with the open source licenses of some of our dependencies, we need to generate and package in our releases a disclaimer informing the end user of the licensed software. This document describes the process for generating these disclaimers, packaging them in the application, and viewing them programmatically within the application.

## Generating disclaimer files

The license disclaimers for the backend are generated using the [go-licenses](https://github.com/google/go-licenses) tool. We supply a template file ([`go_licenses_report.tpl`](./go_licenses_report.tpl)) to generate a pretty print of the disclaimers for each dependency. Due to a limitation in the tool, we run it separately for `wavesrv` and `waveterm`, meaning there are separate disclaimer files, `wavesrv.txt` and `waveterm.txt` respectively.

The license disclaimers for the frontend are generated using the [`yarn licenses` tool](https://classic.yarnpkg.com/lang/en/docs/cli/licenses/). This outputs into its own file, `frontend.txt`.

These three disclaimer files are then bundled and compressed into `disclaimers.tar.gz`, which is then packaged into the application.

The [`scripthaus.md` file](../scripthaus.md) contains scripts to genrate the disclaimers and package them. This happens automatically when generating a new release. To manually generate the disclaimers, run the following from the repository root directory:

```bash
scripthaus run generate-license-disclaimers
```

## Packaging disclaimers in the application binary

TODO

## Viewing disclaimers in Wave

TODO
