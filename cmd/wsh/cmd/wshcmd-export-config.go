package cmd

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

func init() {
	var exportConfigCmd = &cobra.Command{
		Use:   "exportconfig [output-path]",
		Short: "export Wave Terminal configuration",
		Long:  "Export Wave Terminal configuration files into a zip archive",
		RunE:  runExportConfig,
	}
	rootCmd.AddCommand(exportConfigCmd)
}

func runExportConfig(cmd *cobra.Command, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("exportconfig requires an output path")
	}

	outputPath := args[0]
	if !strings.HasSuffix(outputPath, ".zip") {
		outputPath += ".zip"
	}

	configDir := getWaveConfigDir()

	if stat, err := os.Stat(configDir); err != nil || !stat.IsDir() {
		return fmt.Errorf("Wave config directory not found at %s", configDir)
	}

	if err := zipDir(configDir, outputPath); err != nil {
		return fmt.Errorf("exportconfig failed: %v", err)
	}

	fmt.Printf("Configuration exported to %s\n", outputPath)
	return nil
}

func zipDir(sourceDir, zipPath string) error {
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	archive := zip.NewWriter(zipFile)
	defer archive.Close()

	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		writer, err := archive.Create(relPath)
		if err != nil {
			return err
		}

		_, err = io.Copy(writer, file)
		return err
	})
}

func getWaveConfigDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(homeDir, ".config", "waveterm")
}
