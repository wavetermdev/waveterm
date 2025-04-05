Okay, here are the code snippets from the Wave Terminal build instructions, organized for easier copying:
Prerequisites
Linux
Debian/Ubuntu:
sudo apt install zip snapd
sudo snap install zig --classic --beta

Fedora/RHEL:
sudo dnf install zip zig

Arch:
sudo pacman -S zip zig

For packaging
Install fpm (if on ARM64):
gem install fpm

Install snapcraft:
sudo snap install snapcraft --classic

Yarn Modern
Enable Corepack:
corepack enable

Install Corepack manually (if needed):
npm install -g corepack
corepack enable

Clone the Repo
Using SSH:
git clone git@github.com:wavetermdev/waveterm.git

Using HTTPS:
git clone https://github.com/wavetermdev/waveterm.git

Install code dependencies
task init

Build and Run
Development server
task dev

Standalone
task start

Packaged
task package

For Linux ARM64:
USE_SYSTEM_FPM=1 task package

Debugging
(No specific code to copy here, but the instructions mention using Chrome DevTools and the backend log file.)
Backend logs (development version):
~/.waveterm-dev/waveapp.log

This should make it easier for you to copy and paste the commands as needed. Let me know if you'd like any further organization or have any other requests!
