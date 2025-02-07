# copy a file with /// separating directory and file
# ensure the copy succeeds and the file exists

set -e
cd "$HOME/testcp"
mkdir foo
touch foo/bar.txt

wsh file copy foo///bar.txt .

if [ ! -f bar.txt ]; then
    echo "bar.txt does not exist"
    exit 1
fi
