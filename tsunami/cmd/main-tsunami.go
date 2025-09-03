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

func validateEnvironmentVars(opts *build.BuildOpts) error {
	scaffoldPath := os.Getenv("TSUNAMI_SCAFFOLDPATH")
	if scaffoldPath == "" {
		return fmt.Errorf("TSUNAMI_SCAFFOLDPATH environment variable must be set")
	}

	sdkReplacePath := os.Getenv("TSUNAMI_SDKREPLACEPATH")
	if sdkReplacePath == "" {
		return fmt.Errorf("TSUNAMI_SDKREPLACEPATH environment variable must be set")
	}

	opts.ScaffoldPath = scaffoldPath
	opts.SdkReplacePath = sdkReplacePath
	return nil
}

var buildCmd = &cobra.Command{
	Use:          "build [directory]",
	Short:        "Build a Tsunami application",
	Long:         `Build a Tsunami application from the specified directory.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		keepTemp, _ := cmd.Flags().GetBool("keeptemp")
		output, _ := cmd.Flags().GetString("output")
		opts := build.BuildOpts{
			Dir:        args[0],
			Verbose:    verbose,
			KeepTemp:   keepTemp,
			OutputFile: output,
		}
		if err := validateEnvironmentVars(&opts); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		if err := build.TsunamiBuild(opts); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
	},
}

var runCmd = &cobra.Command{
	Use:          "run [directory]",
	Short:        "Build and run a Tsunami application",
	Long:         `Build and run a Tsunami application from the specified directory.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		open, _ := cmd.Flags().GetBool("open")
		keepTemp, _ := cmd.Flags().GetBool("keeptemp")
		opts := build.BuildOpts{
			Dir:      args[0],
			Verbose:  verbose,
			Open:     open,
			KeepTemp: keepTemp,
		}
		if err := validateEnvironmentVars(&opts); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		if err := build.TsunamiRun(opts); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)

	buildCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	buildCmd.Flags().Bool("keeptemp", false, "Keep temporary build directory")
	buildCmd.Flags().StringP("output", "o", "", "Output file path for the built application")
	rootCmd.AddCommand(buildCmd)

	runCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	runCmd.Flags().Bool("open", false, "Open the application in the browser after starting")
	runCmd.Flags().Bool("keeptemp", false, "Keep temporary build directory")
	rootCmd.AddCommand(runCmd)
}

func main() {
	tsunamibase.TsunamiVersion = TsunamiVersion
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
