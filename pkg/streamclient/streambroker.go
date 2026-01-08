package streamclient

import (
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type StreamRpcInterface interface {
	StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error
	StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error
}

type wshRpcAdapter struct {
	rpc *wshutil.WshRpc
}

func (a *wshRpcAdapter) StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	return wshclient.StreamDataAckCommand(a.rpc, data, opts)
}

func (a *wshRpcAdapter) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	return wshclient.StreamDataCommand(a.rpc, data, opts)
}

func AdaptWshRpc(rpc *wshutil.WshRpc) StreamRpcInterface {
	return &wshRpcAdapter{rpc: rpc}
}

type Broker struct {
	lock                sync.Mutex
	rpcClient           StreamRpcInterface
	streamIdCounter     int64
	readers             map[int64]*Reader
	writers             map[int64]*Writer
	readerRoutes        map[int64]string
	writerRoutes        map[int64]string
	readerErrorSentTime map[int64]time.Time
	writerErrorSentTime map[int64]time.Time
}

func NewBroker(rpcClient StreamRpcInterface) *Broker {
	return &Broker{
		rpcClient:           rpcClient,
		streamIdCounter:     0,
		readers:             make(map[int64]*Reader),
		writers:             make(map[int64]*Writer),
		readerRoutes:        make(map[int64]string),
		writerRoutes:        make(map[int64]string),
		readerErrorSentTime: make(map[int64]time.Time),
		writerErrorSentTime: make(map[int64]time.Time),
	}
}

func (b *Broker) CreateStreamReader(readerRoute string, writerRoute string, rwnd int64) (*Reader, *wshrpc.StreamMeta) {
	b.lock.Lock()
	defer b.lock.Unlock()

	b.streamIdCounter++
	streamId := b.streamIdCounter

	reader := NewReader(streamId, rwnd, b)
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

func (b *Broker) AttachStreamWriter(meta *wshrpc.StreamMeta) *Writer {
	b.lock.Lock()
	defer b.lock.Unlock()

	writer := NewWriter(meta.Id, meta.RWnd, b)
	b.writers[meta.Id] = writer
	b.readerRoutes[meta.Id] = meta.ReaderRouteId
	b.writerRoutes[meta.Id] = meta.WriterRouteId

	return writer
}

// cannot block
func (b *Broker) SendAck(ackPk wshrpc.CommandStreamAckData) {
	b.lock.Lock()
	route := b.writerRoutes[ackPk.Id]
	b.lock.Unlock()

	opts := &wshrpc.RpcOpts{
		Route:      route,
		NoResponse: true,
	}
	b.rpcClient.StreamDataAckCommand(ackPk, opts)

	if ackPk.Fin || ackPk.Cancel {
		b.cleanupReader(ackPk.Id)
	}
}

// cannot block
func (b *Broker) SendData(dataPk wshrpc.CommandStreamData) {
	b.lock.Lock()
	route := b.readerRoutes[dataPk.Id]
	b.lock.Unlock()

	opts := &wshrpc.RpcOpts{
		Route:      route,
		NoResponse: true,
	}
	b.rpcClient.StreamDataCommand(dataPk, opts)
}

// cannot block
func (b *Broker) RecvData(dataPk wshrpc.CommandStreamData) {
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

// cannot block
func (b *Broker) RecvAck(ackPk wshrpc.CommandStreamAckData) {
	b.lock.Lock()
	writer, ok := b.writers[ackPk.Id]
	if !ok {
		lastSent := b.writerErrorSentTime[ackPk.Id]
		now := time.Now()
		if now.Sub(lastSent) < time.Second {
			b.lock.Unlock()
			return
		}
		b.writerErrorSentTime[ackPk.Id] = now
	}
	b.lock.Unlock()

	if !ok {
		dataPk := wshrpc.CommandStreamData{
			Id:    ackPk.Id,
			Seq:   ackPk.Id,
			Error: "stream writer not found",
		}
		b.SendData(dataPk)
		return
	}

	writer.RecvAck(ackPk)

	if ackPk.Fin || ackPk.Cancel {
		b.cleanupWriter(ackPk.Id)
	}
}

func (b *Broker) cleanupReader(streamId int64) {
	b.lock.Lock()
	defer b.lock.Unlock()

	delete(b.readers, streamId)
	delete(b.readerRoutes, streamId)
	delete(b.readerErrorSentTime, streamId)
}

func (b *Broker) cleanupWriter(streamId int64) {
	b.lock.Lock()
	defer b.lock.Unlock()

	delete(b.writers, streamId)
	delete(b.writerRoutes, streamId)
	delete(b.writerErrorSentTime, streamId)
}
