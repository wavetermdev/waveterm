# copy a file to one with a different name
# ensure that the destination file exists
set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy foo.txt bar.txt

if [ ! -f bar.txt ]; then
    echo "bar.txt does not exist"
    exit 1
fi
