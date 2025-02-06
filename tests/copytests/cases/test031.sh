# copy an empty directory to a non-existing directory without -r flag
# ensure the operation fails and the new file doesn't exist

set -e
cd "$HOME/testcp"
mkdir foo

wsh file copy foo bar >/dev/null 2>&1 && echo "the command should have failed" && exit 1

if [ -d bar ]; then
    echo "bar should not exist"
    exit 1
fi
