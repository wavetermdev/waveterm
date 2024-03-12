# Open-Source Acknowledgements

We make use of many amazing open-source projects to build Wave Terminal. Here are the links to the latest acknowledgements for each of our components, including license disclaimers for each dependency:

- [Frontend](./disclaimers/frontend.md)
- [Backend](./disclaimers/backend.md)

## Generating license disclaimers

The license disclaimers for the backend are generated using the [go-licenses](https://github.com/google/go-licenses) tool. We supply a template file ([`go_licenses_report.tpl`](./go_licenses_report.tpl)) to generate a pretty print of the disclaimers for each dependency. This outputs to the file [`backend.md`](./disclaimers/backend.md).

The license disclaimers for the frontend are generated using the [`yarn licenses` tool](https://classic.yarnpkg.com/lang/en/docs/cli/licenses/). This outputs to the file [`frontend.md`](./disclaimers/frontend.md).

These three disclaimer files linked above will be periodically regenerated to reflect new dependencies.

The [`scripthaus.md` file](../scripthaus.md) contains scripts to generate the disclaimers and package them. To manually generate the disclaimers, run the following from the repository root directory:

```bash
scripthaus run generate-license-disclaimers
```
