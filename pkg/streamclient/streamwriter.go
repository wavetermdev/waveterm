package streamclient

import (
	"encoding/base64"
	"fmt"
	"io"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type DataSender interface {
	SendData(dataPk wshrpc.CommandStreamData)
}

type Writer struct {
	lock         sync.Mutex
	cond         *sync.Cond
	id           string
	dataSender   DataSender
	readWindow   int64
	nextSeq      int64
	buffer       []byte
	sentNotAcked int64
	lastAckedSeq int64
	finAcked     bool
	canceled     bool
	canceledChan chan struct{}
	eof          bool
	err          error
	closed       bool
}

func NewWriter(id string, readWindow int64, dataSender DataSender) *Writer {
	w := &Writer{
		id:           id,
		readWindow:   readWindow,
		dataSender:   dataSender,
		nextSeq:      0,
		sentNotAcked: 0,
		lastAckedSeq: 0,
		canceledChan: make(chan struct{}),
	}
	w.cond = sync.NewCond(&w.lock)
	return w
}

func (w *Writer) RecvAck(ackPk wshrpc.CommandStreamAckData) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if ackPk.Id != w.id {
		return
	}

	ackedSeq := ackPk.Seq
	if ackedSeq > w.lastAckedSeq {
		w.lastAckedSeq = ackedSeq
	}

	if ackPk.Fin {
		w.finAcked = true
	}

	if ackPk.Cancel && !w.canceled {
		w.canceled = true
		close(w.canceledChan)
		if !w.closed {
			w.err = fmt.Errorf("stream cancelled")
			w.cond.Broadcast()
		}
		return
	}

	if !w.closed {
		if ackedSeq > (w.nextSeq - w.sentNotAcked) {
			ackedBytes := ackedSeq - (w.nextSeq - w.sentNotAcked)
			w.sentNotAcked -= ackedBytes
			if w.sentNotAcked < 0 {
				w.sentNotAcked = 0
			}
		}

		w.readWindow = ackPk.RWnd
		w.cond.Broadcast()
	}
}

func (w *Writer) GetAckState() (lastAckedSeq int64, finAcked bool, canceled bool) {
	w.lock.Lock()
	defer w.lock.Unlock()

	return w.lastAckedSeq, w.finAcked, w.canceled
}

func (w *Writer) GetCanceledChan() <-chan struct{} {
	return w.canceledChan
}

func (w *Writer) Write(p []byte) (int, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.closed {
		return 0, io.ErrClosedPipe
	}

	if w.err != nil {
		return 0, w.err
	}

	w.buffer = append(w.buffer, p...)
	n := len(p)

	for len(w.buffer) > 0 {
		if w.closed {
			return 0, io.ErrClosedPipe
		}
		if w.err != nil {
			return 0, w.err
		}

		sent := w.trySendDataLocked()
		if !sent {
			w.cond.Wait()
		}
	}

	return n, nil
}

func (w *Writer) trySendDataLocked() bool {
	availWindow := w.readWindow - w.sentNotAcked
	if availWindow <= 0 {
		return false
	}

	toSend := len(w.buffer)
	if int64(toSend) > availWindow {
		toSend = int(availWindow)
	}

	data := w.buffer[:toSend]
	w.buffer = w.buffer[toSend:]

	dataStr := base64.StdEncoding.EncodeToString(data)
	dataPk := wshrpc.CommandStreamData{
		Id:     w.id,
		Seq:    w.nextSeq,
		Data64: dataStr,
	}

	w.dataSender.SendData(dataPk)
	w.nextSeq += int64(toSend)
	w.sentNotAcked += int64(toSend)

	return toSend > 0
}

// If Close() is called while a Write is blocked, the Write will return an error and buffered data may be discarded.
func (w *Writer) Close() error {
	return w.CloseWithError(nil)
}

// If CloseWithError() is called while a Write is blocked, the Write will return an error and buffered data may be discarded.
func (w *Writer) CloseWithError(err error) error {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.closed {
		return nil
	}

	w.closed = true
	if w.err == nil {
		w.err = io.ErrClosedPipe
	}
	w.cond.Broadcast()

	var dataPk wshrpc.CommandStreamData
	if err == nil || err == io.EOF {
		dataPk = wshrpc.CommandStreamData{
			Id:  w.id,
			Seq: w.nextSeq,
			Eof: true,
		}
	} else {
		dataPk = wshrpc.CommandStreamData{
			Id:    w.id,
			Seq:   w.nextSeq,
			Error: err.Error(),
		}
	}
	w.dataSender.SendData(dataPk)

	return nil
}
