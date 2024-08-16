#!/bin/bash

# Downloads the artifacts for the specified version from the staging bucket for local testing.
# Usage: download-staged-artifact.sh <version> <aws-profile>
# Example: download-staged-artifact.sh 0.1.0 storage

VERSION=$1
AWS_PROFILE=$2
if [ -z "$VERSION" ] || [ -z "$AWS_PROFILE" ]; then
    echo "Usage: $0 <version> <aws-profile>"
    exit
fi

# Gets the directory of the script
SCRIPT_DIR=$(dirname $0)

# Download the artifacts for the specified version from the staging bucket
DOWNLOAD_DIR=$SCRIPT_DIR/$VERSION-staged
rm -rf $DOWNLOAD_DIR
mkdir -p $DOWNLOAD_DIR
aws s3 cp s3://waveterm-github-artifacts/staging-w2/$VERSION/ $DOWNLOAD_DIR/ --recursive --profile $AWS_PROFILE
