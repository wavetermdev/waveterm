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
	"github.com/wavetermdev/waveterm/pkg/util/iterfn"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"gopkg.in/ini.v1"
)

var connectionRe = regexp.MustCompile(`^aws:\/\/(.*)$`)

var tempfiles map[string]string = make(map[string]string)

func GetConfigForConnection(ctx context.Context, connection string) (*aws.Config, error) {
	connMatch := connectionRe.FindStringSubmatch(connection)
	if connMatch == nil {
		return nil, fmt.Errorf("invalid connection string: %s)", connection)
	}
	connection = connMatch[1]
	connfile, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ConnectionsFile)
	if len(cerrs) > 0 {
		return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	optfns := []func(*config.LoadOptions) error{}
	if connfile[connection] != nil {
		connectionconfig := connfile.GetMap(connection)
		if connectionconfig["aws:config"] != "" {
			var tempfile string
			if tempfiles[connection] != "" {
				tempfile = tempfiles[connection]
			} else {
				awsConfig := connectionconfig.GetString("aws:config", "")
				tempfile, err := os.CreateTemp("", fmt.Sprintf("waveterm-awsconfig-%s", connection))
				if err != nil {
					return nil, fmt.Errorf("error creating temp file: %v", err)
				}
				tempfile.WriteString(awsConfig)
			}
			optfns = append(optfns, config.WithSharedCredentialsFiles([]string{tempfile}))
		}
	}
	optfns = append(optfns, config.WithSharedConfigProfile(connection))
	cfg, err := config.LoadDefaultConfig(ctx, optfns...)
	if err != nil {
		return nil, fmt.Errorf("error loading config: %v", err)
	}
	return &cfg, nil
}

func ParseProfiles() []string {
	connfile, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ConnectionsFile)
	profiles := map[string]any{}
	if len(cerrs) > 0 {
		log.Printf("error reading wave connections file: %v", cerrs[0])
	} else {
		for k, _ := range connfile {
			connMatch := connectionRe.FindStringSubmatch(k)
			if connMatch != nil {
				profiles[connMatch[1]] = struct{}{}
			}
		}
	}

	fname := config.DefaultSharedConfigFilename() // Get aws.config default shared configuration file name
	f, err := ini.Load(fname)                     // Load ini file
	if err != nil {
		log.Printf("error reading aws config file: %v", err)
		return iterfn.MapKeysToSorted(profiles)
	}
	for _, v := range f.Sections() {
		if len(v.Keys()) != 0 { // Get only the sections having Keys
			parts := strings.Split(v.Name(), " ")
			if len(parts) == 2 && parts[0] == "profile" { // skip default
				profiles[parts[1]] = struct{}{}
			}
		}
	}

	fname = config.DefaultSharedCredentialsFilename()
	f, err = ini.Load(fname)
	if err != nil {
		log.Printf("error reading aws credentials file: %v", err)
		return iterfn.MapKeysToSorted(profiles)
	}
	for _, v := range f.Sections() {
		profiles[v.Name()] = struct{}{}
	}
	return iterfn.MapKeysToSorted(profiles)
}
