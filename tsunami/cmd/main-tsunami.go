package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/tsunami/tsunamibase"
)

// these are set at build time
var TsunamiVersion = "0.0.0"
var BuildTime = "0"

var rootCmd = &cobra.Command{
	Use:   "tsunami",
	Short: "Tsunami - A VDOM-based UI framework",
	Long:  `Tsunami is a VDOM-based UI framework for building modern applications.`,
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print Tsunami version",
	Long:  `Print Tsunami version`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("v" + tsunamibase.TsunamiVersion)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}

func main() {
	tsunamibase.TsunamiVersion = TsunamiVersion
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}