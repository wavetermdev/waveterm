# copy a file with contents
# ensure the contents are the same
set -e
cd "$HOME/testcp"
touch foo.txt
echo "The quick brown fox jumps over the lazy dog" > foo.txt

wsh file copy foo.txt bar.txt


FOO_MD5=$(md5sum foo.txt | cut -d " " -f1)
BAR_MD5=$(md5sum bar.txt | cut -d " " -f1)
if [ $FOO_MD5 != $BAR_MD5 ]; then
    echo "files are not the same"
    echo "FOO_MD5 is $FOO_MD5"
    echo "BAR_MD5 is $BAR_MD5"
    exit 1
fi
