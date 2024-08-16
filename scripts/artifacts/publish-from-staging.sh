# Takes a release from our staging bucket and publishes it to the public download bucket.
# Usage: publish-from-staging.sh <version> <aws-profile>
# Example: publish-from-staging.sh 0.1.0 storage

VERSION=$1
AWS_PROFILE=$2
if [ -z "$VERSION"] || [-z "$AWS_PROFILE" ]; then
    echo "Usage: $0 <version> <aws-profile>"
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
