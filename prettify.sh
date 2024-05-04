dirs=$(git diff main --name-only --diff-filter d | grep -e '\.[tj]sx\?$' | xargs)
echo dirs: $dirs
node_modules/prettier/bin-prettier.js --write $dirs

