// Description: This package is used to create a connection to AWS services.
package awsconn

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"gopkg.in/ini.v1"
)

const (
	ProfileConfigKey = "profile:config"
	ProfilePrefix    = "aws:"
	TempFilePattern  = "waveterm-awsconfig-%s"
)

var connectionRe = regexp.MustCompile(`^aws:\/\/(.*)$`)

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
		profiles, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ProfilesFile)
		if len(cerrs) > 0 {
			return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
		}
		if profiles[profile] != nil {
			connectionconfig := profiles.GetMap(profile)
			if connectionconfig[ProfileConfigKey] != "" {
				var tempfile string
				if tempfiles[profile] != "" {
					tempfile = tempfiles[profile]
				} else {
					awsConfig := connectionconfig.GetString(ProfileConfigKey, "")
					tempfile, err := os.CreateTemp("", fmt.Sprintf(TempFilePattern, profile))
					if err != nil {
						return nil, fmt.Errorf("error creating temp file: %v", err)
					}
					tempfile.WriteString(awsConfig)
				}
				optfns = append(optfns, config.WithSharedCredentialsFiles([]string{tempfile}))
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
		return profiles
	}
	for _, v := range f.Sections() {
		profiles[ProfilePrefix+v.Name()] = struct{}{}
	}
	return profiles
}
