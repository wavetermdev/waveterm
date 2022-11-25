package binpack

import (
	"encoding/binary"
	"io"
)

type FullByteReader interface {
	io.ByteReader
	io.Reader
}

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

func PackInt(w io.Writer, ival int) error {
	viBuf := make([]byte, binary.MaxVarintLen64)
	l := binary.PutUvarint(viBuf, uint64(ival))
	_, err := w.Write(viBuf[0:l])
	return err
}

func UnpackValue(r FullByteReader) ([]byte, error) {
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

func UnpackInt(r io.ByteReader) (int, error) {
	ival64, err := binary.ReadVarint(r)
	if err != nil {
		return 0, err
	}
	return int(ival64), nil
}
