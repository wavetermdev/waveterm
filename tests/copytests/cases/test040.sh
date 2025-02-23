# copy a directory containing a file to a new directory
# ensure this succeeds and the new files exist

set -e
cd "$HOME/testcp"
mkdir bar
touch bar/foo.txt

wsh file copy bar baz

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
