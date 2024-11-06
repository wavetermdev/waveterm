<p align="center">
  <picture>
	<source media="(prefers-color-scheme: dark)" srcset="../assets/wave-dark.png">
	<source media="(prefers-color-scheme: light)" srcset="../assets/wave-light.png">
	<img alt="Wave Terminal Logo" src="../assets/wave-light.png" width="240">
  </picture>
  <br/>
</p>

# Wave Terminal Documentation

This is the home for Wave Terminal's documentation site. This README is specifically about _building_ and contributing to the docs site. If you are looking for the actual hosted docs, go here -- https://docs.waveterm.dev

### Installation

Our docs are built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

```sh
yarn
```

### Local Development

```sh
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```sh
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Deployment

Deployments are handled automatically by the [Docsite and Storybook CI/CD workflow](../.github/workflows/deploy-docsite.yml)
