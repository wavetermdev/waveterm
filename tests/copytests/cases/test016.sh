# copy a file where source and destination are resolved with ~
# ensure the destination file exists

set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy ~/testcp/foo.txt ~/testcp/bar.txt

if [ ! -f bar.txt ]; then
    echo "bar.txt does not exist"
    exit 1
fi
