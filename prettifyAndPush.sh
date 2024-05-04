dirs=$(git diff main --name-only --diff-filter d | grep -e '\.[tj]sx\?$' | xargs)
node_modules/prettier/bin-prettier.js --write $dirs
git add $dirs
git commit --amend
git push
