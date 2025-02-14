# copy a file with ~ used to resolve the destination
# ensure the destination exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy foo.txt ~/testcp/bar.txt

if [ ! -f bar.txt ]; then
    echo "bar.txt does not exist"
    exit 1
fi
