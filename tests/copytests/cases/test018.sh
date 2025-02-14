# copy a file to itself with ~ for source resolution
# ensure that the operation fails and the file still exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy ~/testcp/foo.txt foo.txt  >/dev/null 2>&1 && echo "copy should have failed" && exit 1

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
