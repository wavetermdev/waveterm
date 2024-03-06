# Takes a release from our staging bucket and publishes it to the public download bucket.

# Takes the version as an argument
VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    exit 1
fi

aws s3 cp s3://waveterm-github-artifacts/staging/$VERSION/ s3://dl.waveterm.dev/releases/ --recursive