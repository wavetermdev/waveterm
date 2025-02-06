# copy an empty directory ending with / to a non-existing directory without -r flag
# ensure the copy fails and the new directory doesn't exist

set -e
cd "$HOME/testcp"
mkdir bar

wsh file copy bar/ baz >/dev/null 2>&1 && echo "this command was supposed to fail" && exit 1

if [ -d baz ]; then
    echo "baz should not exist"
    exit 1
fi
