# copy from the current directory to a relative directory ..
# ensure the file is copied correctly

set -e
cd "$HOME/testcp"
mkdir baz
cd baz
touch foo.txt


wsh file copy foo.txt ..
cd ..

if [ ! -f foo.txt ]; then
    echo "foo.txt does not exist"
    exit 1
fi
