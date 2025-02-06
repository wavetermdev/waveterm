# copy the current directory into a non-existing directory without the -r flag 
# ensure the copy fails and the output does not exist

set -e
cd "$HOME/testcp"
mkdir foo
touch foo/bar.txt
cd foo

wsh file copy . ../baz >/dev/null 2>&1 && echo "command should have failed" && exit 1

if [ -f baz/bar.txt ]; then
    echo "baz/bar.txt should not exist"
    exit 1
fi
