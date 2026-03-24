package utilds

import "sync"

type WorkQueue[T any] struct {
	lock    sync.Mutex
	cond    *sync.Cond
	queue   []T
	closed  bool
	started bool
	wg      sync.WaitGroup
	workFn  func(T)
}

func NewWorkQueue[T any](workFn func(T)) *WorkQueue[T] {
	wq := &WorkQueue[T]{
		workFn: workFn,
	}
	wq.cond = sync.NewCond(&wq.lock)
	return wq
}

func (wq *WorkQueue[T]) Enqueue(item T) bool {
	wq.lock.Lock()
	defer wq.lock.Unlock()
	if wq.closed {
		return false
	}
	if !wq.started {
		wq.started = true
		wq.wg.Add(1)
		go wq.worker()
	}
	wq.queue = append(wq.queue, item)
	wq.cond.Signal()
	return true
}

func (wq *WorkQueue[T]) worker() {
	defer wq.wg.Done()
	for {
		wq.lock.Lock()
		for len(wq.queue) == 0 && !wq.closed {
			wq.cond.Wait()
		}

		if wq.closed && len(wq.queue) == 0 {
			wq.lock.Unlock()
			return
		}

		item := wq.queue[0]
		wq.queue = wq.queue[1:]
		wq.lock.Unlock()

		wq.workFn(item)
	}
}

func (wq *WorkQueue[T]) Close(immediate bool) {
	wq.lock.Lock()
	wq.closed = true
	if immediate {
		wq.queue = nil
	}
	wq.cond.Broadcast()
	wq.lock.Unlock()
}

func (wq *WorkQueue[T]) Wait() {
	wq.wg.Wait()
}
