# Takes a release from our staging bucket and publishes it to the public download bucket.
# Usage: publish-from-staging.sh <version>
# Example: publish-from-staging.sh 0.1.0

# Takes the version as an argument
VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    exit
fi

ORIGIN="waveterm-github-artifacts/staging-w2/$VERSION/"
DESTINATION="dl.waveterm.dev/releases-w2/"

OUTPUT=$(aws s3 cp s3://$ORIGIN s3://$DESTINATION --recursive --profile $AWS_PROFILE)

for line in $OUTPUT; do
    PREFIX=${line%%${DESTINATION}*}
    SUFFIX=${line:${#PREFIX}}
    echo "https://$SUFFIX"
done
