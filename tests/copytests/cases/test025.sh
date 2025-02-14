# copy into an non-existing directory where file has the same base name
# ensure the file is copied to a file inside the directory
# note that this is not regular cp behavior

set -e
cd "$HOME/testcp"
touch foo.txt

# this is different from cp behavior
wsh file copy foo.txt baz/foo.txt

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
