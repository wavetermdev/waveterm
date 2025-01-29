package tarcopy

import (
	"archive/tar"
	"context"
	"io"
	"io/fs"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TarCopySrc(ctx context.Context, chunkSize int, pathPrefix string) (outputChan chan wshrpc.RespOrErrorUnion[iochantypes.Packet], writeHeader func(fi fs.FileInfo, file string) error, writer io.Writer, close func()) {
	pipeReader, pipeWriter := io.Pipe()
	tarWriter := tar.NewWriter(pipeWriter)
	rtnChan := iochan.ReaderChan(ctx, pipeReader, wshrpc.FileChunkSize, func() {
		for {
			if err := pipeReader.Close(); err != nil {
				log.Printf("error closing pipe reader: %v, trying again in 10ms\n", err)
				time.Sleep(time.Millisecond * 10)
				continue
			}
			break
		}
	})

	return rtnChan, func(fi fs.FileInfo, file string) error {
			// generate tar header
			header, err := tar.FileInfoHeader(fi, file)
			if err != nil {
				return err
			}

			header.Name = strings.TrimPrefix(file, pathPrefix)
			if header.Name == "" {
				return nil
			}
			if strings.HasPrefix(header.Name, "/") {
				header.Name = header.Name[1:]
			}

			// write header
			if err := tarWriter.WriteHeader(header); err != nil {
				return err
			}
			return nil
		}, tarWriter, func() {
			for {
				if err := tarWriter.Close(); err != nil {
					log.Printf("TarCopySrc: error closing tar writer: %v, trying again in 10ms\n", err)
					time.Sleep(time.Millisecond * 10)
					continue
				}
				break
			}
			for {
				if err := pipeWriter.Close(); err != nil {
					log.Printf("TarCopySrc: error closing pipe writer: %v, trying again in 10ms\n", err)
					time.Sleep(time.Millisecond * 10)
					continue
				}
				break
			}
		}
}
