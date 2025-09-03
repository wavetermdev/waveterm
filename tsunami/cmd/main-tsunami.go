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
	RunE: func(cmd *cobra.Command, args []string) error {
		verbose, _ := cmd.Flags().GetBool("verbose")
		opts := build.BuildOpts{
			Dir:     args[0],
			Verbose: verbose,
		}
		if err := validateEnvironmentVars(&opts); err != nil {
			return err
		}
		if _, err := build.TsunamiBuild(opts); err != nil {
			return fmt.Errorf("build failed: %w", err)
		}
		return nil
	},
}

var runCmd = &cobra.Command{
	Use:          "run [directory]",
	Short:        "Build and run a Tsunami application",
	Long:         `Build and run a Tsunami application from the specified directory.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		verbose, _ := cmd.Flags().GetBool("verbose")
		open, _ := cmd.Flags().GetBool("open")
		opts := build.BuildOpts{
			Dir:     args[0],
			Verbose: verbose,
			Open:    open,
		}
		if err := validateEnvironmentVars(&opts); err != nil {
			return err
		}
		if err := build.TsunamiRun(opts); err != nil {
			return fmt.Errorf("run failed: %w", err)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)

	buildCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	rootCmd.AddCommand(buildCmd)

	runCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	runCmd.Flags().Bool("open", false, "Open the application in the browser after starting")
	rootCmd.AddCommand(runCmd)
}

func main() {
	tsunamibase.TsunamiVersion = TsunamiVersion
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
