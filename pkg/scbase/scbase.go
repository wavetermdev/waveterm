package scbase

import (
	"os"
	"path"
)

const HomeVarName = "HOME"
const ScHomeVarName = "SCRIPTHAUS_HOME"

func GetScHomeDir() string {
	scHome := os.Getenv(ScHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			homeVar = "/"
		}
		scHome = path.Join(homeVar, "scripthaus")
	}
	return scHome
}
