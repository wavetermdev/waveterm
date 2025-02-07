# copy to a deeper directory and rename
# ensure the destination file exists

set -e
cd "$HOME/testcp"
touch foo.txt
mkdir baz

wsh file copy foo.txt baz/bar.txt

if [ ! -f baz/bar.txt ]; then
    echo "baz/bar.txt does not exist"
    exit 1
fi
