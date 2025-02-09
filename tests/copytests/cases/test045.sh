# copy a doubly nested directory containing a file to an existing directory
# ensure this succeeds and the new files exist and are nested in the existing directory

set -e
cd "$HOME/testcp"
mkdir foo
mkdir foo/bar
touch foo/bar/baz.txt
mkdir qux

wsh file copy foo qux

if [ ! -f qux/foo/bar/baz.txt ]; then
    echo "qux/foo/bar/baz.txt does not exist"
    exit 1
fi
