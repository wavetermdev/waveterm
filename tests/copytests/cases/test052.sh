# copy a directory with contents
# ensure the contents are the same
set -e
cd "$HOME/testcp"
mkdir foo
mkdir foo/bar
touch foo/bar/baz.txt
mkdir foo/bar/qux
touch foo/bar/qux/quux.txt
echo "The quick brown fox jumps over the lazy dog." > foo/bar/baz.txt
echo "Sphinx of black quartz, judge my vow." > foo/bar/qux/quux.txt
mkdir corge

# we need a nested corge/foo so the foo.zip contains the same exact file names
# in other words, if one file was named foo and the other was corge, they would
# not match. this allows them to be the same.
wsh file copy foo corge/foo


zip -r foo.zip foo >/dev/null 2>&1
FOO_MD5=$(md5sum foo.zip | cut -d " " -f1)

cd corge
zip -r foo.zip foo >/dev/null 2>&1
CORGE_MD5=$(md5sum foo.zip | cut -d " " -f1)

if [ $FOO_MD5 != $CORGE_MD5 ]; then
    echo "directories are not the same"
    echo "FOO_MD5 is $FOO_MD5"
    echo "CORGE_MD5 is $CORGE_MD5"
    exit 1
fi

