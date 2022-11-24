package utilfn

import (
	"bufio"
	"encoding/binary"
	"io"
)

func PackValue(w io.Writer, barr []byte) error {
	viBuf := make([]byte, binary.MaxVarintLen64)
	viLen := binary.PutUvarint(viBuf, uint64(len(barr)))
	_, err := w.Write(viBuf[0:viLen])
	if err != nil {
		return err
	}
	_, err = w.Write(barr)
	if err != nil {
		return err
	}
	return nil
}

func UnpackValue(r *bufio.Reader) ([]byte, error) {
	lenVal, err := binary.ReadUvarint(r)
	if err != nil {
		return nil, err
	}
	rtnBuf := make([]byte, int(lenVal))
	_, err = io.ReadFull(r, rtnBuf)
	if err != nil {
		return nil, err
	}
	return rtnBuf, nil
}
