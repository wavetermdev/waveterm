# copy a file to one with a different name
# ensure that the original exists
set -e
cd "$HOME/testcp"
touch foo.txt

wsh file copy foo.txt bar.txt

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
