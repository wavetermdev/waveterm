// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Description: This package is used to create a connection to AWS services.
package awsconn

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/aws/smithy-go"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"gopkg.in/ini.v1"
)

const (
	ProfileConfigKey      = "profile:config"
	ProfileCredentialsKey = "profile:credentials"
	ProfilePrefix         = "aws:"
	TempFilePattern       = "waveterm-awsconfig-%s"
)

var connectionRe = regexp.MustCompile(`^(.*):\w+:\/\/.*$`)

var tempfiles map[string]string = make(map[string]string)

func GetConfig(ctx context.Context, profile string) (*aws.Config, error) {
	optfns := []func(*config.LoadOptions) error{}
	// If profile is empty, use default config
	if profile != "" {
		connMatch := connectionRe.FindStringSubmatch(profile)
		if connMatch == nil {
			return nil, fmt.Errorf("invalid connection string: %s)", profile)
		}
		profile = connMatch[1]
		log.Printf("GetConfig: profile=%s", profile)

		// TODO: Reimplement generic profile support
		// profiles, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ProfilesFile)
		// if len(cerrs) > 0 {
		// 	return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
		// }
		// if profiles[profile] != nil {
		// 	configfilepath, _ := getTempFileFromConfig(profiles, ProfileConfigKey, profile)
		// 	credentialsfilepath, _ := getTempFileFromConfig(profiles, ProfileCredentialsKey, profile)
		// 	if configfilepath != "" {
		// 		log.Printf("configfilepath: %s", configfilepath)
		// 		optfns = append(optfns, config.WithSharedConfigFiles([]string{configfilepath}))
		// 		tempfiles[profile+"_config"] = configfilepath
		// 	}
		// 	if credentialsfilepath != "" {
		// 		log.Printf("credentialsfilepath: %s", credentialsfilepath)
		// 		optfns = append(optfns, config.WithSharedCredentialsFiles([]string{credentialsfilepath}))
		// 		tempfiles[profile+"_credentials"] = credentialsfilepath
		// 	}
		// }
		optfns = append(optfns, config.WithRegion("us-west-2"))
		trimmedProfile := strings.TrimPrefix(profile, ProfilePrefix)
		optfns = append(optfns, config.WithSharedConfigProfile(trimmedProfile))
	}
	cfg, err := config.LoadDefaultConfig(ctx, optfns...)
	if err != nil {
		return nil, fmt.Errorf("error loading config: %v", err)
	}
	return &cfg, nil
}

func getTempFileFromConfig(config waveobj.MetaMapType, key string, profile string) (string, error) {
	connectionconfig := config.GetMap(profile)
	if connectionconfig[key] != "" {
		awsConfig := connectionconfig.GetString(key, "")
		if awsConfig != "" {
			tempfile, err := os.CreateTemp("", fmt.Sprintf(TempFilePattern, profile))
			if err != nil {
				return "", fmt.Errorf("error creating temp file: %v", err)
			}
			_, err = tempfile.WriteString(awsConfig)
			if err != nil {
				return "", fmt.Errorf("error writing to temp file: %v", err)
			}
			return tempfile.Name(), nil
		}
	}
	return "", nil
}

func ParseProfiles() map[string]struct{} {
	profiles := make(map[string]struct{})
	fname := config.DefaultSharedConfigFilename()
	errs := []error{}
	f, err := ini.Load(fname) // Load ini file
	if err != nil {
		errs = append(errs, err)
	} else {
		for _, v := range f.Sections() {
			if len(v.Keys()) != 0 { // Get only the sections having Keys
				parts := strings.Split(v.Name(), " ")
				if len(parts) == 2 && parts[0] == "profile" { // skip default
					profiles[ProfilePrefix+parts[1]] = struct{}{}
				}
			}
		}
	}

	fname = config.DefaultSharedCredentialsFilename()
	f, err = ini.Load(fname)
	if err != nil {
		errs = append(errs, err)
	} else {
		for _, v := range f.Sections() {
			profiles[ProfilePrefix+v.Name()] = struct{}{}
		}
	}
	if len(errs) > 0 {
		log.Printf("error reading aws config/credentials file: %v", errs)
	}
	return profiles
}

func ListBuckets(ctx context.Context, client *s3.Client) ([]types.Bucket, error) {
	var err error
	var output *s3.ListBucketsOutput
	var buckets []types.Bucket
	bucketPaginator := s3.NewListBucketsPaginator(client, &s3.ListBucketsInput{})
	for bucketPaginator.HasMorePages() {
		output, err = bucketPaginator.NextPage(ctx)
		if err != nil {
			CheckAccessDeniedErr(&err)
			return nil, fmt.Errorf("error listing buckets: %v", err)
		} else {
			buckets = append(buckets, output.Buckets...)
		}
	}
	return buckets, nil
}

func CheckAccessDeniedErr(err *error) bool {
	var apiErr smithy.APIError
	if err != nil && errors.As(*err, &apiErr) && apiErr.ErrorCode() == "AccessDenied" {
		*err = apiErr
		return true
	}
	return false
}
