# copy an empty directory to a non-existing directory
# ensure the empty directory is copied to one with the new name

set -e
cd "$HOME/testcp"
mkdir foo

wsh file copy foo bar

if [ ! -d bar ]; then
    echo "bar does not exist"
    exit 1
fi
