package tarcopy

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"path/filepath"
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

			header.Name = filepath.Clean(strings.TrimPrefix(file, pathPrefix))
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

func TarCopyDest(ctx context.Context, cancel context.CancelCauseFunc, ch <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet], readNext func(next *tar.Header, reader *tar.Reader) error) error {
	pipeReader, pipeWriter := io.Pipe()
	iochan.WriterChan(ctx, pipeWriter, ch, func() {
		for {
			if err := pipeWriter.Close(); err != nil {
				log.Printf("error closing pipe writer: %v, trying again in 10ms\n", err)
				time.Sleep(time.Millisecond * 10)
				continue
			}
			cancel(nil)
			break
		}
	}, cancel)
	tarReader := tar.NewReader(pipeReader)
	defer func() {
		for {
			if err := pipeReader.Close(); err != nil {
				log.Printf("error closing pipe reader: %v, trying again in 10ms\n", err)
				time.Sleep(time.Millisecond * 10)
				continue
			}
			cancel(nil)
			break
		}
	}()
	for {
		select {
		case <-ctx.Done():
			if ctx.Err() != nil {
				return context.Cause(ctx)
			}
			return nil
		default:
			next, err := tarReader.Next()
			if err != nil {
				// Do one more check for context error before returning
				if ctx.Err() != nil {
					return context.Cause(ctx)
				}
				if errors.Is(err, io.EOF) {
					return nil
				} else {
					return fmt.Errorf("cannot read tar stream: %w", err)
				}
			}
			err = readNext(next, tarReader)
			if err != nil {
				return err
			}
		}
	}
}
