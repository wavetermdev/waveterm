# copy into an existing directory not ending in /
# ensure the file is inserted in the directory

set -e
cd "$HOME/testcp"
touch foo.txt
mkdir baz

wsh file copy foo.txt baz

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
