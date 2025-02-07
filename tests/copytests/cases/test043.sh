# copy a directory containing a file to an existing directory ending with /.
# ensure this succeeds and the new files are nested in the existing directory

set -e
cd "$HOME/testcp"
mkdir bar
touch bar/foo.txt
mkdir baz

wsh file copy bar baz/.

if [ ! -f baz/bar/foo.txt ]; then
    echo "baz/bar/foo.txt does not exist"
    exit 1
fi
