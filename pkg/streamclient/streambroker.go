package streamclient

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type workItem struct {
	workType string
	ackPk    wshrpc.CommandStreamAckData
	dataPk   wshrpc.CommandStreamData
}

type StreamWriter interface {
	RecvAck(ackPk wshrpc.CommandStreamAckData)
}

type StreamRpcInterface interface {
	StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error
	StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error
}

const defaultAckRetryInterval = 25 * time.Millisecond

type Broker struct {
	lock                sync.Mutex
	rpcClient           StreamRpcInterface
	readers             map[string]*Reader
	writers             map[string]StreamWriter
	readerRoutes        map[string]string
	writerRoutes        map[string]string
	readerErrorSentTime map[string]time.Time
	sendQueue           *utilds.WorkQueue[workItem]
	recvQueue           *utilds.WorkQueue[workItem]

	// pendingAcks holds the latest unsent ACK per stream. A send failure must
	// not drop the last ACK or the remote 64 KB window wedges permanently.
	pendingAcks      map[string]wshrpc.CommandStreamAckData
	retryPending     bool
	ackRetryInterval time.Duration
	closed           bool
}

func NewBroker(rpcClient StreamRpcInterface) *Broker {
	b := &Broker{
		rpcClient:           rpcClient,
		readers:             make(map[string]*Reader),
		writers:             make(map[string]StreamWriter),
		readerRoutes:        make(map[string]string),
		writerRoutes:        make(map[string]string),
		readerErrorSentTime: make(map[string]time.Time),
		pendingAcks:         make(map[string]wshrpc.CommandStreamAckData),
		ackRetryInterval:    defaultAckRetryInterval,
	}
	b.sendQueue = utilds.NewWorkQueue(b.processSendWork)
	b.recvQueue = utilds.NewWorkQueue(b.processRecvWork)
	return b
}

func (b *Broker) CreateStreamReader(readerRoute string, writerRoute string, rwnd int64) (*Reader, *wshrpc.StreamMeta) {
	return b.CreateStreamReaderWithSeq(readerRoute, writerRoute, rwnd, 0)
}

func (b *Broker) CreateStreamReaderWithSeq(readerRoute string, writerRoute string, rwnd int64, startSeq int64) (*Reader, *wshrpc.StreamMeta) {
	b.lock.Lock()
	defer b.lock.Unlock()

	streamId := uuid.New().String()

	reader := NewReaderWithSeq(streamId, rwnd, startSeq, b)
	b.readers[streamId] = reader
	b.readerRoutes[streamId] = readerRoute
	b.writerRoutes[streamId] = writerRoute

	meta := &wshrpc.StreamMeta{
		Id:            streamId,
		RWnd:          rwnd,
		ReaderRouteId: readerRoute,
		WriterRouteId: writerRoute,
	}

	return reader, meta
}

func (b *Broker) AttachStreamWriter(meta *wshrpc.StreamMeta, writer StreamWriter) error {
	b.lock.Lock()
	defer b.lock.Unlock()

	if _, exists := b.writers[meta.Id]; exists {
		return fmt.Errorf("writer already registered for stream id %s", meta.Id)
	}

	b.writers[meta.Id] = writer
	b.readerRoutes[meta.Id] = meta.ReaderRouteId
	b.writerRoutes[meta.Id] = meta.WriterRouteId

	return nil
}

func (b *Broker) DetachStreamWriter(streamId string) {
	b.lock.Lock()
	defer b.lock.Unlock()

	delete(b.writers, streamId)
	delete(b.writerRoutes, streamId)
}

func (b *Broker) CreateStreamWriter(meta *wshrpc.StreamMeta) (*Writer, error) {
	writer := NewWriter(meta.Id, meta.RWnd, b)
	err := b.AttachStreamWriter(meta, writer)
	if err != nil {
		return nil, err
	}
	return writer, nil
}

func (b *Broker) SendAck(ackPk wshrpc.CommandStreamAckData) {
	b.sendQueue.Enqueue(workItem{workType: "sendack", ackPk: ackPk})
}

func (b *Broker) SendData(dataPk wshrpc.CommandStreamData) {
	b.sendQueue.Enqueue(workItem{workType: "senddata", dataPk: dataPk})
}

// RecvData and RecvAck are designed to be non-blocking and must remain so to prevent deadlock.
// They only enqueue work items to be processed asynchronously by the work queue's goroutine.
// These methods are called from the main RPC runServer loop, so blocking here would stall all RPC processing.
func (b *Broker) RecvData(dataPk wshrpc.CommandStreamData) {
	b.recvQueue.Enqueue(workItem{workType: "recvdata", dataPk: dataPk})
}

func (b *Broker) RecvAck(ackPk wshrpc.CommandStreamAckData) {
	b.recvQueue.Enqueue(workItem{workType: "recvack", ackPk: ackPk})
}

func (b *Broker) processSendWork(item workItem) {
	switch item.workType {
	case "sendack":
		b.processSendAck(item.ackPk)
	case "senddata":
		b.processSendData(item.dataPk)
	}
}

func (b *Broker) processRecvWork(item workItem) {
	switch item.workType {
	case "recvdata":
		b.processRecvData(item.dataPk)
	case "recvack":
		b.processRecvAck(item.ackPk)
	}
}

// goroutineDumpLock and lastGoroutineDumpAt rate-limit full goroutine stack dumps
// triggered when an ACK send times out (the signature of a wedged output stream).
// The dump captures the blocked goroutines at the exact moment the wedge begins,
// so it doesn't rely on the user noticing the freeze in time.
var (
	goroutineDumpLock   sync.Mutex
	lastGoroutineDumpAt time.Time
)

// dumpGoroutinesOnce writes a full goroutine stack dump (equivalent to the pprof
// goroutine endpoint) to a timestamped file in os.TempDir(). It is rate-limited to
// once per 10 minutes so intermittent ACK timeouts don't flood the filesystem.
func dumpGoroutinesOnce() {
	goroutineDumpLock.Lock()
	defer goroutineDumpLock.Unlock()
	if time.Since(lastGoroutineDumpAt) < 10*time.Minute {
		return
	}
	lastGoroutineDumpAt = time.Now()

	buf := make([]byte, 1024*1024)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) {
			buf = buf[:n]
			break
		}
		buf = make([]byte, len(buf)*2)
	}

	path := filepath.Join(os.TempDir(), fmt.Sprintf("waveterm-goroutine-dump-%s.txt", time.Now().Format("20060102-150405")))
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		log.Printf("[streamclient] dumpGoroutinesOnce: failed to write goroutine dump: %v", err)
		return
	}
	log.Printf("[streamclient] dumpGoroutinesOnce: wrote goroutine dump to %s (%d bytes)", path, len(buf))
}

// coalesceAcks keeps the most advanced window state and never drops Fin/Cancel.
func coalesceAcks(a, b wshrpc.CommandStreamAckData) wshrpc.CommandStreamAckData {
	out := b
	if a.Seq > b.Seq || (a.Seq == b.Seq && a.RWnd > b.RWnd) {
		out.Seq = a.Seq
		out.RWnd = a.RWnd
	}
	out.Fin = a.Fin || b.Fin
	out.Cancel = a.Cancel || b.Cancel
	if out.Error == "" {
		if b.Error != "" {
			out.Error = b.Error
		} else {
			out.Error = a.Error
		}
	}
	if out.Id == "" {
		out.Id = a.Id
	}
	return out
}

// takePendingMerged removes any stored ACK for this stream and merges it with ack.
func (b *Broker) takePendingMerged(ack wshrpc.CommandStreamAckData) (wshrpc.CommandStreamAckData, bool) {
	b.lock.Lock()
	defer b.lock.Unlock()
	prev, ok := b.pendingAcks[ack.Id]
	if !ok {
		return ack, false
	}
	delete(b.pendingAcks, ack.Id)
	return coalesceAcks(prev, ack), true
}

// putPending stores ack (coalesced with any existing pending ACK) and starts
// the retry loop if needed. Returns true if this is the first pending ACK for
// the stream (used to rate-limit logs / dumps).
func (b *Broker) putPending(ack wshrpc.CommandStreamAckData) (first bool) {
	b.lock.Lock()
	defer b.lock.Unlock()
	if b.closed {
		return false
	}
	if b.pendingAcks == nil {
		b.pendingAcks = make(map[string]wshrpc.CommandStreamAckData)
	}
	_, existed := b.pendingAcks[ack.Id]
	if existed {
		ack = coalesceAcks(b.pendingAcks[ack.Id], ack)
	}
	b.pendingAcks[ack.Id] = ack
	if !b.retryPending {
		b.retryPending = true
		interval := b.ackRetryInterval
		if interval <= 0 {
			interval = defaultAckRetryInterval
		}
		go b.retryPendingLoop(interval)
	}
	return !existed
}

func (b *Broker) retryPendingLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		b.lock.Lock()
		if b.closed || len(b.pendingAcks) == 0 {
			b.retryPending = false
			b.lock.Unlock()
			return
		}
		batch := make([]wshrpc.CommandStreamAckData, 0, len(b.pendingAcks))
		for _, ack := range b.pendingAcks {
			batch = append(batch, ack)
		}
		b.lock.Unlock()
		for _, ack := range batch {
			b.sendQueue.Enqueue(workItem{workType: "sendack", ackPk: ack})
		}
	}
}

func (b *Broker) processSendAck(ackPk wshrpc.CommandStreamAckData) {
	ackPk, hadPending := b.takePendingMerged(ackPk)

	b.lock.Lock()
	route, ok := b.writerRoutes[ackPk.Id]
	b.lock.Unlock()
	if !ok {
		// A missing writer route means the ACK cannot be delivered (stream gone).
		// Do not retry — there is nowhere to send it.
		log.Printf("[streamclient] processSendAck: no writer route for stream %s, dropping ACK seq=%d", ackPk.Id, ackPk.Seq)
		return
	}

	opts := &wshrpc.RpcOpts{
		Route:      route,
		NoResponse: true,
	}
	if err := b.rpcClient.StreamDataAckCommand(ackPk, opts); err != nil {
		first := b.putPending(ackPk)
		if first {
			log.Printf("[streamclient] processSendAck: error sending ACK for stream %s seq=%d: %v (will retry latest)", ackPk.Id, ackPk.Seq, err)
			// Capture the full goroutine state at the moment the ACK path blocks so
			// the wedge can be diagnosed without a manual pprof grab.
			dumpGoroutinesOnce()
		}
		return
	}

	if hadPending {
		log.Printf("[streamclient] processSendAck: recovered ACK send for stream %s seq=%d", ackPk.Id, ackPk.Seq)
	}

	if ackPk.Fin || ackPk.Cancel {
		b.cleanupReader(ackPk.Id)
	}
}

func (b *Broker) processSendData(dataPk wshrpc.CommandStreamData) {
	b.lock.Lock()
	route := b.readerRoutes[dataPk.Id]
	b.lock.Unlock()

	opts := &wshrpc.RpcOpts{
		Route:      route,
		NoResponse: true,
	}
	b.rpcClient.StreamDataCommand(dataPk, opts)
}

func (b *Broker) processRecvData(dataPk wshrpc.CommandStreamData) {
	b.lock.Lock()
	reader, ok := b.readers[dataPk.Id]
	if !ok {
		lastSent := b.readerErrorSentTime[dataPk.Id]
		now := time.Now()
		if now.Sub(lastSent) < time.Second {
			b.lock.Unlock()
			return
		}
		b.readerErrorSentTime[dataPk.Id] = now
	}
	b.lock.Unlock()

	if !ok {
		ackPk := wshrpc.CommandStreamAckData{
			Id:     dataPk.Id,
			Seq:    dataPk.Seq,
			Cancel: true,
			Error:  "stream reader not found",
		}
		b.SendAck(ackPk)
		return
	}

	reader.RecvData(dataPk)
}

func (b *Broker) processRecvAck(ackPk wshrpc.CommandStreamAckData) {
	b.lock.Lock()
	writer, ok := b.writers[ackPk.Id]
	b.lock.Unlock()

	if !ok {
		return
	}

	writer.RecvAck(ackPk)

	if ackPk.Fin || ackPk.Cancel {
		b.cleanupWriter(ackPk.Id)
	}
}

func (b *Broker) Close() {
	b.lock.Lock()
	b.closed = true
	b.pendingAcks = nil
	b.lock.Unlock()
	b.sendQueue.Close(false)
	b.recvQueue.Close(false)
	b.sendQueue.Wait()
	b.recvQueue.Wait()
}

func (b *Broker) cleanupReader(streamId string) {
	b.lock.Lock()
	defer b.lock.Unlock()

	delete(b.readers, streamId)
	delete(b.readerRoutes, streamId)
	delete(b.readerErrorSentTime, streamId)
}

func (b *Broker) cleanupWriter(streamId string) {
	b.lock.Lock()
	defer b.lock.Unlock()

	delete(b.writers, streamId)
	delete(b.writerRoutes, streamId)
}
