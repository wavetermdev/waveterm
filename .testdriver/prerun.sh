rm ~/Desktop/WITH-LOVE-FROM-AMERICA.txt
cd ~/actions-runner/_work/testdriver/testdriver/
brew install go
brew tap scripthaus-dev/scripthaus
brew install scripthaus
corepack enable
yarn install
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
