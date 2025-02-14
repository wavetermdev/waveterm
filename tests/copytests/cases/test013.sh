# copy a file with ~ used to resolve the destination
# ensure the source exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy foo.txt ~/testcp/bar.txt

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
