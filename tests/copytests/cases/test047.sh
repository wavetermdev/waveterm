# copy a file with /// to a file with //
# ensure the copy succeeds and the file exists

set -e
cd "$HOME/testcp"
mkdir foo
touch foo/bar.txt
mkdir baz

wsh file copy foo///bar.txt baz//qux.txt

if [ ! -f baz/qux.txt ]; then
    echo "baz/qux.txt does not exist"
    exit 1
fi
