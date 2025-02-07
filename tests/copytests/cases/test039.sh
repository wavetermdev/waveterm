# copy a directory containing a file to a new directory without -r flag
# ensure this fails and the new files don't exist

set -e
cd "$HOME/testcp"
mkdir bar
touch bar/foo.txt

wsh file copy bar baz >/dev/null 2>&1 && echo "this command should have failed" && exit 1

if [ -f baz/foo.txt ]; then
    echo "baz/foo.txt should not exist"
    exit 1
fi
