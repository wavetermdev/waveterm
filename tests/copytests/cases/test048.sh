# copy the current directory into an existing directory
# ensure the copy succeeds and the output exists

set -e
cd "$HOME/testcp"
mkdir foo
touch foo/bar.txt
mkdir baz
cd foo


wsh file copy . ../baz
cd ..


if [ ! -f baz/bar.txt ]; then
    echo "baz/bar.txt does not exist"
    exit 1
fi
