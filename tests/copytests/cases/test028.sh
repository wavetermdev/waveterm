# copy from relative .. source to current directory .
# ensure the file is copied correctly

set -e
cd "$HOME/testcp"
touch foo.txt
mkdir baz
cd baz

wsh file copy ../foo.txt .
cd ..

if [ ! -f baz/foo.txt ]; then
    echo "baz/foo.txt does not exist"
    exit 1
fi
