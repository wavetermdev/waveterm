# copy a file with ~ used to resolve the source
# ensure the source still exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy ~/testcp/foo.txt bar.txt

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
