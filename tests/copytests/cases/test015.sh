# copy a file where source and destination are resolved with ~
# ensure the source file exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy ~/testcp/foo.txt ~/testcp/bar.txt

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
