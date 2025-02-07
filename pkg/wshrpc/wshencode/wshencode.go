package wshencode

import (
	"encoding/json"
	"fmt"
	"os"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	EncTypeJson           = "json"
	EncTypeBson           = "bson"
	EncTypeEnvVar         = "WSH_ENC_TYPE"
	UnsupportedEncTypeErr = "unsupported encoding type: %s"
)

type EncoderDecoder struct {
	EncType string
}

func MakeEncoderDecoder() *EncoderDecoder {
	return &EncoderDecoder{
		EncType: GetEncTypeFromEnv(),
	}
}

func (e EncoderDecoder) Marshal(v interface{}) ([]byte, error) {
	if e.EncType == EncTypeJson {
		return json.Marshal(v)
	} else if e.EncType == EncTypeBson {
		return bson.MarshalExtJSON(v, true, false)
	}
	return nil, fmt.Errorf(UnsupportedEncTypeErr, e.EncType)
}

func (e EncoderDecoder) Unmarshal(data []byte, v interface{}) error {
	if e.EncType == EncTypeJson {
		return json.Unmarshal(data, v)
	} else if e.EncType == EncTypeBson {
		return bson.UnmarshalExtJSON(data, true, v)
	}
	return fmt.Errorf(UnsupportedEncTypeErr, e.EncType)
}

func GetEncTypeFromEnv() string {
	encType := EncTypeJson
	if envEncType := os.Getenv(EncTypeEnvVar); envEncType != "" {
		encType = envEncType
	}
	return encType
}
