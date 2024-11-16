<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/wave-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./assets/wave-light.png">
    <img alt="Wave Terminal Logo" src="./assets/wave-light.png" width="240">
  </picture>
  <br/>
</p>

# Wave Terminal

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)
[![waveterm](https://snapcraft.io/waveterm/trending.svg?name=0)](https://snapcraft.io/waveterm)

Wave is an open-source terminal that can launch graphical widgets, controlled and integrated directly with the CLI. It includes a base terminal, directory browser, file previews (images, media, markdown), a graphical editor (for code/text files), a web browser, and integrated AI chat.

Wave isn't just another terminal emulator; it's a rethink on how terminals are built. For too long there has been a disconnect between the CLI and the web. If you want fast, keyboard-accessible, easy-to-write applications, you use the CLI, but if you want graphical interfaces, native widgets, copy/paste, scrolling, variable font sizes, then you'd have to turn to the web. Wave's goal is to bridge that gap.

![WaveTerm Screenshot](./assets/wave-screenshot.png)

## Installation

Wave Terminal works on macOS, Linux, and Windows.

Install Wave Terminal from: [www.waveterm.dev/download](https://www.waveterm.dev/download)

### Homebrew

![Homebrew Cask Version](https://img.shields.io/homebrew/cask/v/wave)

Also available as a Homebrew Cask for macOS.

```bash
brew install --cask wave
```

### Snap

[![waveterm](https://snapcraft.io/waveterm/badge.svg)](https://snapcraft.io/waveterm)
[![waveterm](https://snapcraft.io/waveterm/trending.svg?name=0)](https://snapcraft.io/waveterm)

Also available as a Snap for Linux.

```bash
sudo snap install waveterm --classic
```

### Chocolatey

![Chocolatey Version](https://img.shields.io/chocolatey/v/wave)

Also available via Chocolatey for Windows:

```Powershell
choco install wave
```

### WinGet

![WinGet Package Version](https://img.shields.io/winget/v/CommandLine.Wave)

Also available via the Windows Package Manager (WinGet):

```Powershell
winget install CommandLine.Wave
```

### Minimum requirements

Wave Terminal and WSH run on the following platforms:

- macOS 11 or later (arm64, x64)
- Windows 10 1809 or later (x64)
- Linux based on glibc-2.28 or later (Debian 10, RHEL 8, Ubuntu 20.04, etc.) (arm64, x64)

## Links

- Homepage &mdash; https://www.waveterm.dev
- Download Page &mdash; https://www.waveterm.dev/download
- Documentation &mdash; https://docs.waveterm.dev
- Legacy Documentation &mdash; https://legacydocs.waveterm.dev
- Blog &mdash; https://blog.waveterm.dev
- Discord Community &mdash; https://discord.gg/XfvZ334gwU

## Building from Source

See [Building Wave Terminal](BUILD.md).

## Contributing

Wave uses GitHub Issues for issue tracking.

Find more information in our [Contributions Guide](CONTRIBUTING.md), which includes:

- [Ways to contribute](CONTRIBUTING.md#contributing-to-wave-terminal)
- [Contribution guidelines](CONTRIBUTING.md#before-you-start)
- [Storybook](https://docs.waveterm.dev/storybook)

### Activity

![Alt](https://repobeats.axiom.co/api/embed/f06b0f7bb1656d2493012ad411bbd746e8bf680f.svg "Repobeats analytics image")

## License

Wave Terminal is licensed under the Apache-2.0 License. For more information on our dependencies, see [here](./ACKNOWLEDGEMENTS.md).
