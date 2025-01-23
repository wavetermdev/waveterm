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
	"github.com/wavetermdev/waveterm/pkg/wconfig"
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
		profiles, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ProfilesFile)
		if len(cerrs) > 0 {
			return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
		}
		if profiles[profile] != nil {
			configfilepath, _ := getTempFileFromConfig(profiles, ProfileConfigKey, profile)
			credentialsfilepath, _ := getTempFileFromConfig(profiles, ProfileCredentialsKey, profile)
			if configfilepath != "" {
				log.Printf("configfilepath: %s", configfilepath)
				optfns = append(optfns, config.WithSharedConfigFiles([]string{configfilepath}))
				tempfiles[profile+"_config"] = configfilepath
			}
			if credentialsfilepath != "" {
				log.Printf("credentialsfilepath: %s", credentialsfilepath)
				optfns = append(optfns, config.WithSharedCredentialsFiles([]string{credentialsfilepath}))
				tempfiles[profile+"_credentials"] = credentialsfilepath
			}
		}
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
	fname := config.DefaultSharedConfigFilename() // Get aws.config default shared configuration file name
	f, err := ini.Load(fname)                     // Load ini file
	if err != nil {
		log.Printf("error reading aws config file: %v", err)
		return nil
	}
	for _, v := range f.Sections() {
		if len(v.Keys()) != 0 { // Get only the sections having Keys
			parts := strings.Split(v.Name(), " ")
			if len(parts) == 2 && parts[0] == "profile" { // skip default
				profiles[ProfilePrefix+parts[1]] = struct{}{}
			}
		}
	}

	fname = config.DefaultSharedCredentialsFilename()
	f, err = ini.Load(fname)
	if err != nil {
		log.Printf("error reading aws credentials file: %v", err)
		if profiles == nil {
			profiles = make(map[string]struct{})
		}
		return profiles
	}
	for _, v := range f.Sections() {
		profiles[ProfilePrefix+v.Name()] = struct{}{}
	}
	return profiles
}

func ListBuckets(ctx context.Context, client *s3.Client) ([]types.Bucket, error) {
	var err error
	var output *s3.ListBucketsOutput
	var buckets []types.Bucket
	region := client.Options().Region
	bucketPaginator := s3.NewListBucketsPaginator(client, &s3.ListBucketsInput{BucketRegion: &region})
	for bucketPaginator.HasMorePages() {
		output, err = bucketPaginator.NextPage(ctx)
		log.Printf("output: %v", output)
		if err != nil {
			var apiErr smithy.APIError
			if errors.As(err, &apiErr) && apiErr.ErrorCode() == "AccessDenied" {
				fmt.Println("You don't have permission to list buckets for this account.")
				err = apiErr
			} else {
				return nil, fmt.Errorf("Couldn't list buckets for your account. Here's why: %v\n", err)
			}
			break
		}
		if output == nil {
			break
		}
		buckets = append(buckets, output.Buckets...)
	}
	return buckets, nil
}
