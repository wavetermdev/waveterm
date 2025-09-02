package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/tsunami/build"
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

var buildCmd = &cobra.Command{
	Use:   "build [directory]",
	Short: "Build a Tsunami application",
	Long:  `Build a Tsunami application from the specified directory.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		opts := build.BuildOpts{
			Dir:     args[0],
			Verbose: verbose,
		}
		if err := build.TsunamiBuild(opts); err != nil {
			fmt.Printf("Build failed: %v\n", err)
			os.Exit(1)
		}
	},
}

var runCmd = &cobra.Command{
	Use:   "run [directory]",
	Short: "Build and run a Tsunami application",
	Long:  `Build and run a Tsunami application from the specified directory.`,
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		opts := build.BuildOpts{
			Dir:     args[0],
			Verbose: verbose,
		}
		if err := build.TsunamiRun(opts); err != nil {
			fmt.Printf("Run failed: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)

	buildCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	rootCmd.AddCommand(buildCmd)

	runCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	rootCmd.AddCommand(runCmd)
}

func main() {
	tsunamibase.TsunamiVersion = TsunamiVersion
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
