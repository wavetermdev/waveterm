package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/tsunami/build"
	"github.com/wavetermdev/waveterm/tsunami/tsunamibase"
)

const (
	EnvTsunamiScaffoldPath   = "TSUNAMI_SCAFFOLDPATH"
	EnvTsunamiSdkReplacePath = "TSUNAMI_SDKREPLACEPATH"
	EnvTsunamiNodePath       = "TSUNAMI_NODEPATH"
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
	scaffoldPath := os.Getenv(EnvTsunamiScaffoldPath)
	if scaffoldPath == "" {
		return fmt.Errorf("%s environment variable must be set", EnvTsunamiScaffoldPath)
	}

	sdkReplacePath := os.Getenv(EnvTsunamiSdkReplacePath)
	if sdkReplacePath == "" {
		return fmt.Errorf("%s environment variable must be set", EnvTsunamiSdkReplacePath)
	}

	opts.ScaffoldPath = scaffoldPath
	opts.SdkReplacePath = sdkReplacePath

	// NodePath is optional
	if nodePath := os.Getenv(EnvTsunamiNodePath); nodePath != "" {
		opts.NodePath = nodePath
	}

	return nil
}

var buildCmd = &cobra.Command{
	Use:          "build [apppath]",
	Short:        "Build a Tsunami application",
	Long:         `Build a Tsunami application.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		keepTemp, _ := cmd.Flags().GetBool("keeptemp")
		output, _ := cmd.Flags().GetString("output")
		opts := build.BuildOpts{
			AppPath:      args[0],
			Verbose:      verbose,
			KeepTemp:     keepTemp,
			OutputFile:   output,
			MoveFileBack: true,
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
	Use:          "run [apppath]",
	Short:        "Build and run a Tsunami application",
	Long:         `Build and run a Tsunami application.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		open, _ := cmd.Flags().GetBool("open")
		keepTemp, _ := cmd.Flags().GetBool("keeptemp")
		opts := build.BuildOpts{
			AppPath:      args[0],
			Verbose:      verbose,
			Open:         open,
			KeepTemp:     keepTemp,
			MoveFileBack: true,
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

var packageCmd = &cobra.Command{
	Use:          "package [apppath]",
	Short:        "Package a Tsunami application into a .tsapp file",
	Long:         `Package a Tsunami application into a .tsapp file.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")
		output, _ := cmd.Flags().GetString("output")
		appPath := args[0]
		
		if output == "" {
			appName := build.GetAppName(appPath)
			output = filepath.Join(appPath, appName+".tsapp")
		}
		
		appFS := build.NewDirFS(appPath)
		if err := build.MakeAppPackage(appFS, appPath, verbose, output); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
		
		if verbose {
			fmt.Printf("Successfully created package: %s\n", output)
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

	packageCmd.Flags().BoolP("verbose", "v", false, "Enable verbose output")
	packageCmd.Flags().StringP("output", "o", "", "Output file path for the package (default: [appname].tsapp in apppath)")
	rootCmd.AddCommand(packageCmd)
}

func main() {
	tsunamibase.TsunamiVersion = TsunamiVersion
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
