# Takes a release from our staging bucket and publishes it to the public download bucket.
# Usage: publish-from-staging.sh <version>
# Example: publish-from-staging.sh 0.1.0

# Takes the version as an argument
VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    exit
fi

aws s3 cp s3://waveterm-github-artifacts/staging/$VERSION/ s3://dl.waveterm.dev/releases/ --recursive --profile $AWS_PROFILE