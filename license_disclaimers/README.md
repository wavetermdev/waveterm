# Open-Source License Disclaimers

In order to comply with the open source licenses of some of our dependencies, we need to generate and package in our releases a disclaimer informing the end user of the licensed software. This document describes the process for generating these disclaimers, packaging them in the application binary, and viewing them programmatically within the application.

## Generating disclaimer files

The [`scripthaus.md` file](../scripthaus.md) contains scripts to genrate the disclaimers and package them in a tarball. This will be done automatically when running the scripts for a new release. To manually generate the disclosure package, run the following from the repository root directory:

```bash
scripthaus run generate-license-disclaimers
```

## Packaging disclaimers in the application binary

TODO

## Viewing disclaimers in Wave

TODO
