# copy a directory containing a file to a new directory with -r flag
# ensure this succeeds and the new files exist

set -e
cd "$HOME/testcp"
mkdir bar
touch bar/foo.txt

wsh file copy -r bar baz

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
