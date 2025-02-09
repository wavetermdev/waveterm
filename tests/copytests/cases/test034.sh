# copy an empty directory ending with / to a non-existing directory
# ensure the copy succeeds and the new directory exists

set -e
cd "$HOME/testcp"
mkdir bar

wsh file copy bar/ baz
if [ ! -d baz ]; then
    echo "baz does not exist"
    exit 1
fi
