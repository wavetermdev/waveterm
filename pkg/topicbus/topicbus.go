// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package topicbus

import (
	"fmt"
	"sync"
)

const (
	MaxMaxEntries  = 1000
	MaxMaxDataLen  = 1024 * 1024
	MaxTotalData   = 50 * 1024 * 1024
	NotifyQueueLen = 100

	DefaultMaxEntries = 1
	DefaultMaxDataLen = 1024
)

type TopicOpts struct {
	MaxEntries int
	MaxDataLen int
}

type Topic struct {
	ZoneId   string
	Name     string
	Opts     TopicOpts
	Data     [][]byte
	StartPos int
	Size     int
	DataSize int
	Subs     map[string]bool
}

type topicKey struct {
	ZoneId string
	Name   string
}

type TopicNotify struct {
	SubscribeId string
	ZoneId      string
	Name        string
	Data        []byte
}

type Bus struct {
	lock        *sync.Mutex
	topics      map[topicKey]*Topic
	subsReverse map[string]map[topicKey]bool
	curDataLen  int64
	notifyCh    chan TopicNotify
}

var GlobalBus *Bus

func InitGlobalBus(notifyCh chan TopicNotify) {
	GlobalBus = &Bus{
		lock:        &sync.Mutex{},
		topics:      make(map[topicKey]*Topic),
		subsReverse: make(map[string]map[topicKey]bool),
		curDataLen:  0,
		notifyCh:    notifyCh,
	}
}

func (b *Bus) TopicSubscribe(zoneId string, name string, subscribeId string, opts TopicOpts) (*Topic, error) {
	if opts.MaxEntries < 0 {
		return nil, fmt.Errorf("max entries must not be negative")
	}
	if opts.MaxDataLen < 0 {
		return nil, fmt.Errorf("max data length must not be negative")
	}
	if opts.MaxEntries == 0 {
		opts.MaxEntries = DefaultMaxEntries
	}
	if opts.MaxDataLen == 0 {
		opts.MaxDataLen = DefaultMaxDataLen
	}
	if opts.MaxEntries > MaxMaxEntries {
		return nil, fmt.Errorf("max entries exceeds limit")
	}
	if opts.MaxDataLen > MaxMaxDataLen {
		return nil, fmt.Errorf("max data length exceeds limit")
	}
	if opts.MaxEntries <= 0 || opts.MaxDataLen <= 0 {
		return nil, fmt.Errorf("max entries and max data length must be positive")
	}
	if subscribeId == "" {
		return nil, fmt.Errorf("subscribe id must be provided")
	}
	b.lock.Lock()
	defer b.lock.Unlock()
	if b.curDataLen > MaxTotalData {
		return nil, fmt.Errorf("total data exceeds limit")
	}
	key := topicKey{ZoneId: zoneId, Name: name}
	topic := b.topics[key]
	if topic == nil {
		topic = &Topic{
			ZoneId:   zoneId,
			Name:     name,
			Opts:     opts,
			Data:     make([][]byte, opts.MaxEntries),
			StartPos: 0,
			Size:     0,
			Subs:     make(map[string]bool),
		}
		b.curDataLen += int64(opts.MaxDataLen)
	}
	if topic.Opts.MaxDataLen < opts.MaxDataLen {
		b.curDataLen += int64(opts.MaxDataLen - topic.Opts.MaxDataLen)
		topic.Opts.MaxDataLen = opts.MaxDataLen
	}
	if topic.Opts.MaxEntries < opts.MaxEntries {
		topic.Opts.MaxEntries = opts.MaxEntries
		newData := make([][]byte, opts.MaxEntries)
		copy(newData, topic.Data)
		topic.Data = newData
	}
	topic.Subs[subscribeId] = true
	subMap := b.subsReverse[subscribeId]
	if subMap == nil {
		subMap = make(map[topicKey]bool)
		b.subsReverse[subscribeId] = subMap
	}
	subMap[key] = true
	return topic, nil
}

func (t *Topic) nextIdx(idx int) int {
	return (t.StartPos + idx) % t.Opts.MaxEntries
}

func (t *Topic) writePos() int {
	return (t.StartPos + t.Size) % t.Opts.MaxEntries
}

// returns subscribers to notify
func (b *Bus) Publish(zoneId string, name string, data []byte) error {
	b.lock.Lock()
	defer b.lock.Unlock()
	key := topicKey{ZoneId: zoneId, Name: name}
	topic := b.topics[key]
	if topic == nil {
		return nil
	}
	if len(data) > topic.Opts.MaxDataLen {
		return fmt.Errorf("data too large")
	}
	if topic.Size < topic.Opts.MaxEntries {
		topic.Data[topic.writePos()] = data
		topic.Size++
		topic.DataSize += len(data)
	} else {
		topic.DataSize += len(data) - len(topic.Data[topic.StartPos])
		topic.Data[topic.StartPos] = data
		topic.StartPos = topic.nextIdx(topic.StartPos)
	}
	// remove data items to make DataSize < MaxDataLen
	// we know it will fit because len(data) <= MaxDataLen
	for topic.DataSize > topic.Opts.MaxDataLen {
		topic.DataSize -= len(topic.Data[topic.StartPos])
		topic.Data[topic.StartPos] = nil
		topic.StartPos = topic.nextIdx(topic.StartPos)
		topic.Size--
	}
	for sub := range topic.Subs {
		// yes, this can block, it will lock then entire bus which will create backpressure
		// this implementation is good enough for now, but can be improved in the future
		b.notifyCh <- TopicNotify{
			SubscribeId: sub,
			ZoneId:      zoneId,
			Name:        name,
			Data:        data,
		}
	}
	return nil
}

func (t *Topic) lastN(n int) [][]byte {
	if t == nil {
		return nil
	}
	if n > t.Size {
		n = t.Size
	}
	data := make([][]byte, n)
	for i := 0; i < n; i++ {
		idx := (t.StartPos + i) % t.Opts.MaxEntries
		data[i] = t.Data[idx]
	}
	return data
}

func (b *Bus) GetLastN(zoneId string, name string, n int) [][]byte {
	if n <= 0 {
		return nil
	}
	b.lock.Lock()
	defer b.lock.Unlock()
	key := topicKey{ZoneId: zoneId, Name: name}
	topic := b.topics[key]
	return topic.lastN(n)
}

func (b *Bus) GetAll(zoneId string, name string) [][]byte {
	b.lock.Lock()
	defer b.lock.Unlock()
	key := topicKey{ZoneId: zoneId, Name: name}
	topic := b.topics[key]
	return topic.lastN(topic.Size)
}

func (b *Bus) Subscribe(zoneId string, name string, subscribeId string) {
	b.lock.Lock()
	defer b.lock.Unlock()
	key := topicKey{ZoneId: zoneId, Name: name}
	topic := b.topics[key]
	if topic != nil {
		topic.Subs[subscribeId] = true
	}
	subMap := b.subsReverse[subscribeId]
	if subMap == nil {
		subMap = make(map[topicKey]bool)
		b.subsReverse[subscribeId] = subMap
	}
	subMap[key] = true
}

func (b *Bus) Unsubscribe(subscribeId string) {
	b.lock.Lock()
	defer b.lock.Unlock()
	subMap := b.subsReverse[subscribeId]
	if subMap == nil {
		return
	}
	for key := range subMap {
		topic := b.topics[key]
		if topic == nil {
			continue
		}
		delete(topic.Subs, subscribeId)
		if len(topic.Subs) == 0 {
			delete(b.topics, key)
		}
	}
	delete(b.subsReverse, subscribeId)
}
