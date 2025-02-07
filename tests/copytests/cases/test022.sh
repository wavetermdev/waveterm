# copy a file to a deeper directory with the same base name
# ensure the destination file exists

set -e
cd "$HOME/testcp"
touch foo.txt
mkdir baz

wsh file copy foo.txt baz/foo.txt

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
