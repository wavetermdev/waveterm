rm ~/Desktop/WITH-LOVE-FROM-AMERICA.txt
brew install go
brew tap scripthaus-dev/scripthaus
brew install scripthaus
npm install -g yarn
mkdir ~/build
cd ~/build
git clone https://github.com/wavetermdev/waveterm.git
cd waveterm
scripthaus run build-backend
echo "Yarn"
yarn
echo "Rebuild"
scripthaus run electron-rebuild
echo "Webpack"
scripthaus run webpack-build
echo "Starting Electron"
scripthaus run electron 1>/dev/null 2>&1 &
echo "Electron Done"
exit
