# copy an empty directory to a non-existing directory ending with // with -r flag
# ensure the copy succeeds and the new directory exists

set -e
cd "$HOME/testcp"
mkdir bar

wsh file copy -r bar baz//

if [ ! -d baz ]; then
    echo "baz does not exist"
    exit 1
fi
