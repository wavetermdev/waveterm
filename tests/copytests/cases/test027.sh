# copy into an non-existing file name not-ending with a /
# ensure the file is copied to a file instead of a directory

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy foo.txt baz

if [ ! -f baz ]; then
    echo "baz does not exist"
    exit 1
fi
