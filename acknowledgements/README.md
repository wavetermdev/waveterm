# Open-Source Acknowledgements

We make use of many amazing open-source projects to build Wave Terminal. Here are the links to the latest acknowledgements for each of our components, including license disclaimers for each dependency:

- [Frontend](./disclaimers/frontend.md)
- [`wavesrv` backend](./disclaimers/wavesrv.md)
- [`waveshell` backend](./disclaimers/waveshell.md)

## Generating license disclaimers

The license disclaimers for the backend are generated using the [go-licenses](https://github.com/google/go-licenses) tool. We supply a template file ([`go_licenses_report.tpl`](./go_licenses_report.tpl)) to generate a pretty print of the disclaimers for each dependency. Due to a limitation in the tool, we run it separately for `wavesrv` and `waveterm`, meaning there are separate disclaimer files, `wavesrv.md` and `waveterm.md` respectively.

The license disclaimers for the frontend are generated using the [`yarn licenses` tool](https://classic.yarnpkg.com/lang/en/docs/cli/licenses/). This outputs into its own file, `frontend.md`.

These three disclaimer files linked above will be periodically regenerated to reflect new dependencies.

The [`scripthaus.md` file](../scripthaus.md) contains scripts to genrate the disclaimers and package them. To manually generate the disclaimers, run the following from the repository root directory:

```bash
scripthaus run generate-license-disclaimers
```
