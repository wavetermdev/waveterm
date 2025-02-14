# copy a doubly nested directory containing a file to a non-existant directory
# ensure this succeeds and the new files exist with the first directory renamed

set -e
cd "$HOME/testcp"
mkdir foo
mkdir foo/bar
touch foo/bar/baz.txt

wsh file copy foo qux

if [ ! -f qux/bar/baz.txt ]; then
    echo "qux/bar/baz.txt does not exist"
    exit 1
fi
