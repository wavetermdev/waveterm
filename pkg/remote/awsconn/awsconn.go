// Description: This package is used to create a connection to AWS services.
package awsconn

import (
	"context"
	"fmt"
	"regexp"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var connectionRe = regexp.MustCompile(`^aws:\/\/(.*)$`)

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
		if connectionconfig["aws:access_"] != "" {
			optfns = append(optfns, config.LoadSharedConfigProfile()()
		}
		if connectionconfig[wshrpc.ConnKeywords.AwsRegion] != "" {
			optfns = append(optfns, config.WithRegion(connectionconfig[wshrpc.ConnKeywords.AwsRegion]))
		}
	}
	config, err := config.LoadDefaultConfig(ctx)

}
