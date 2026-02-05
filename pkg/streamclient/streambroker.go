package streamclient

import (
	"fmt"
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
}

func NewBroker(rpcClient StreamRpcInterface) *Broker {
	b := &Broker{
		rpcClient:           rpcClient,
		readers:             make(map[string]*Reader),
		writers:             make(map[string]StreamWriter),
		readerRoutes:        make(map[string]string),
		writerRoutes:        make(map[string]string),
		readerErrorSentTime: make(map[string]time.Time),
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

func (b *Broker) processSendAck(ackPk wshrpc.CommandStreamAckData) {
	b.lock.Lock()
	route, ok := b.writerRoutes[ackPk.Id]
	b.lock.Unlock()
	if !ok {
		return
	}

	opts := &wshrpc.RpcOpts{
		Route:      route,
		NoResponse: true,
	}
	b.rpcClient.StreamDataAckCommand(ackPk, opts)

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
