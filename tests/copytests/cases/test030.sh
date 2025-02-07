# copy from a deeper directory to the current directory .
# ensure the file is copied correctly

set -e
cd "$HOME/testcp"
mkdir baz
touch baz/foo.txt

wsh file copy baz/foo.txt .

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
