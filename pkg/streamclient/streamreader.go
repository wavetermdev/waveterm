package streamclient

import (
	"encoding/base64"
	"fmt"
	"io"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type AckSender interface {
	SendAck(ackPk wshrpc.CommandStreamAckData)
}

type Reader struct {
	lock         sync.Mutex
	cond         *sync.Cond
	id           int64
	ackSender    AckSender
	readWindow   int64
	nextSeq      int64
	buffer       []byte
	eof          bool
	err          error
	closed       bool
	lastRwndSent int64
}

func NewReader(id int64, readWindow int64, ackSender AckSender) *Reader {
	r := &Reader{
		id:           id,
		readWindow:   readWindow,
		ackSender:    ackSender,
		nextSeq:      0,
		lastRwndSent: readWindow,
	}
	r.cond = sync.NewCond(&r.lock)
	return r
}

func (r *Reader) RecvData(dataPk wshrpc.CommandStreamData) {
	r.lock.Lock()
	defer r.lock.Unlock()

	if r.closed {
		return
	}

	if dataPk.Id != r.id {
		return
	}

	// error packets can be sent without a valid Seq, so check for errors before validating sequence
	if dataPk.Error != "" {
		r.err = fmt.Errorf("stream error: %s", dataPk.Error)
		r.cond.Broadcast()
		r.sendAckLocked(true, false, "")
		return
	}

	if dataPk.Seq != r.nextSeq {
		r.err = fmt.Errorf("stream sequence mismatch: expected %d, got %d", r.nextSeq, dataPk.Seq)
		r.cond.Broadcast()
		r.sendAckLocked(false, true, "sequence mismatch error")
		return
	}

	if dataPk.Data64 != "" {
		data, err := base64.StdEncoding.DecodeString(dataPk.Data64)
		if err != nil {
			r.err = err
			r.cond.Broadcast()
			r.sendAckLocked(false, true, "base64 decode error")
			return
		}
		r.buffer = append(r.buffer, data...)
		r.nextSeq += int64(len(data))
	}

	if dataPk.Eof {
		r.eof = true
		r.cond.Broadcast()
		r.sendAckLocked(true, false, "")
		return
	}

	r.cond.Broadcast()
	r.sendAckLocked(false, false, "")
}

func (r *Reader) sendAckLocked(fin bool, cancel bool, errStr string) {
	rwnd := r.readWindow - int64(len(r.buffer))
	if rwnd < 0 {
		rwnd = 0
	}
	ack := wshrpc.CommandStreamAckData{
		Id:     r.id,
		Seq:    r.nextSeq,
		Fin:    fin,
		Cancel: cancel,
		RWnd:   rwnd,
		Error:  errStr,
	}
	r.ackSender.SendAck(ack)
	r.lastRwndSent = rwnd
}

func (r *Reader) Read(p []byte) (int, error) {
	r.lock.Lock()
	defer r.lock.Unlock()

	for len(r.buffer) == 0 && !r.eof && r.err == nil && !r.closed {
		r.cond.Wait()
	}

	if r.closed {
		return 0, io.ErrClosedPipe
	}

	if r.err != nil {
		return 0, r.err
	}

	if len(r.buffer) == 0 && r.eof {
		return 0, io.EOF
	}

	n := copy(p, r.buffer)
	r.buffer = r.buffer[n:]

	if n > 0 {
		currentRwnd := r.readWindow - int64(len(r.buffer))
		if currentRwnd < 0 {
			currentRwnd = 0
		}

		threshold := r.readWindow / 5
		rwndDiff := currentRwnd - r.lastRwndSent

		if len(r.buffer) == 0 || rwndDiff >= threshold {
			r.sendAckLocked(false, false, "")
		}
	}

	return n, nil
}

func (r *Reader) Close() error {
	r.lock.Lock()
	defer r.lock.Unlock()

	if r.closed {
		if r.err != nil {
			return r.err
		}
		return io.ErrClosedPipe
	}

	r.closed = true
	if r.err == nil {
		r.err = io.ErrClosedPipe
	}
	r.cond.Broadcast()
	r.sendAckLocked(false, true, "")

	return r.err
}
