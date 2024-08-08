# Downloads the artifacts for the specified version from the staging bucket for local testing.
# Usage: download-staged-artifact.sh <version>
# Example: download-staged-artifact.sh 0.1.0

# Retrieve version from the first argument
VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    exit
fi

# Download the artifacts for the specified version from the staging bucket
DOWNLOAD_DIR=$VERSION-staged
rm -rf $DOWNLOAD_DIR
mkdir -p $DOWNLOAD_DIR
aws s3 cp s3://waveterm-github-artifacts/staging-w2/$VERSION/ $DOWNLOAD_DIR/ --recursive --profile $AWS_PROFILE
