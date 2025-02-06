# copy into an non-existing directory ending with a /
# ensure the file is copied to a file inside the directory
# note that this is not regular cp behavior

set -e
cd "$HOME/testcp"
touch foo.txt

# this is different from cp behavior
wsh file copy foo.txt baz/ >/dev/null 2>&1 && echo "command should have failed" && exit 1

if [ -f baz/foo.txt ]; then
    echo "baz/foo.txt should not exist"
    exit 1
fi
