// Package taskoffload provides a comprehensive system for offloading
// CPU-intensive, IO-intensive, and background tasks to worker pools
package taskoffload

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
)

// TaskPriority defines priority levels for tasks
type TaskPriority int

const (
	PriorityLow TaskPriority = iota
	PriorityNormal
	PriorityHigh
	PriorityCritical
)

// TaskStatus represents task state
type TaskStatus int

const (
	StatusPending TaskStatus = iota
	StatusRunning
	StatusCompleted
	StatusFailed
	StatusCancelled
)

// TaskType defines task categories
type TaskType string

const (
	TypeCPUIntensive TaskType = "cpu-intensive"
	TypeIOIntensive  TaskType = "io-intensive"
	TypeNetwork     TaskType = "network"
	TypeBackground  TaskType = "background"
)

// Task represents work to be processed
type Task struct {
	ID       string                 `json:"id"`
	Type     TaskType              `json:"type"`
	Priority TaskPriority          `json:"priority"`
	Status   TaskStatus            `json:"status"`
	Handler  TaskHandler           `json:"-"`
	Data     map[string]interface{} `json:"data"`
	Context  context.Context       `json:"-"`
	Created  time.Time             `json:"created"`
	Error    string                `json:"error,omitempty"`
}

// TaskHandler defines task execution function signature
type TaskHandler func(ctx context.Context, task *Task) error

// TaskConfig holds configuration settings
type TaskConfig struct {
	MaxWorkers int           `json:"maxworkers"`
	QueueSize  int           `json:"queuesize"`
	TaskTimeout time.Duration `json:"tasktimeout"`
	RetryCount int           `json:"retrycount"`
}

// SystemStats provides performance metrics
type SystemStats struct {
	TotalTasks     int64         `json:"totaltasks"`
	ActiveTasks    int           `json:"activetasks"`
	CompletedTasks int64         `json:"completedtasks"`
	FailedTasks    int64         `json:"failedtasks"`
	QueueSize      int           `json:"queuesize"`
	WorkersActive  int           `json:"workersactive"`
	WorkersIdle    int           `json:"workersidle"`
	Uptime         time.Duration `json:"uptime"`
	LastUpdated    time.Time     `json:"lastupdated"`
}

// Manager coordinates task processing
type Manager struct {
	config      TaskConfig
	handlers    map[TaskType]TaskHandler
	tasks       map[string]*Task
	queues      map[TaskPriority]chan *Task
	workers     []*worker
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.RWMutex
	wg          sync.WaitGroup
	startTime   time.Time
	eventBroker *wps.BrokerType
	stats       SystemStats
	statsMu     sync.RWMutex
}

// worker represents a processing goroutine
type worker struct {
	id       string
	manager  *Manager
	taskChan chan *Task
	quit     chan bool
	isBusy   bool
	busyMu   sync.Mutex
}

// NewManager creates a task offloading manager
func NewManager(config TaskConfig, eventBroker *wps.BrokerType) *Manager {
	ctx, cancel := context.WithCancel(context.Background())

	// Set defaults
	if config.MaxWorkers <= 0 {
		config.MaxWorkers = 4
	}
	if config.QueueSize <= 0 {
		config.QueueSize = 1000
	}
	if config.TaskTimeout <= 0 {
		config.TaskTimeout = 30 * time.Minute
	}
	if config.RetryCount <= 0 {
		config.RetryCount = 3
	}

	queues := make(map[TaskPriority]chan *Task)
	for priority := PriorityLow; priority <= PriorityCritical; priority++ {
		queues[priority] = make(chan *Task, config.QueueSize)
	}

	manager := &Manager{
		config:      config,
		handlers:    make(map[TaskType]TaskHandler),
		tasks:       make(map[string]*Task),
		queues:      queues,
		workers:     make([]*worker, 0, config.MaxWorkers),
		ctx:         ctx,
		cancel:      cancel,
		startTime:   time.Now(),
		eventBroker: eventBroker,
	}

	return manager
}

// RegisterHandler registers a task handler
func (m *Manager) RegisterHandler(taskType TaskType, handler TaskHandler) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if handler == nil {
		return fmt.Errorf("handler cannot be nil")
	}

	m.handlers[taskType] = handler
	return nil
}

// SubmitTask adds a new task to the processing queue
func (m *Manager) SubmitTask(taskType TaskType, priority TaskPriority, data map[string]interface{}) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if handler exists
	if _, exists := m.handlers[taskType]; !exists {
		return "", fmt.Errorf("no handler for task type: %s", taskType)
	}

	// Create task
	taskID := fmt.Sprintf("task-%d", time.Now().UnixNano())
	task := &Task{
		ID:       taskID,
		Type:     taskType,
		Priority: priority,
		Status:   StatusPending,
		Data:     data,
		Context:  m.ctx,
		Created:  time.Now(),
	}

	// Store task
	m.tasks[taskID] = task

	// Add to queue
	select {
	case m.queues[priority] <- task:
		// Update stats
		m.statsMu.Lock()
		m.stats.TotalTasks++
		m.stats.QueueSize++
		m.statsMu.Unlock()

		// Publish event
		m.publishEvent(wps.WaveEvent{
			Event:  "task:submitted",
			Scopes: []string{fmt.Sprintf("task:%s", taskID)},
			Data:   task,
		})

		return taskID, nil
	default:
		// Queue full
		delete(m.tasks, taskID)
		return "", fmt.Errorf("task queue full")
	}
}

// GetTaskStatus retrieves task information
func (m *Manager) GetTaskStatus(taskID string) (*Task, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	task, exists := m.tasks[taskID]
	if !exists {
		return nil, fmt.Errorf("task not found")
	}

	return task, nil
}

// CancelTask cancels a task if possible
func (m *Manager) CancelTask(taskID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, exists := m.tasks[taskID]
	if !exists {
		return fmt.Errorf("task not found")
	}

	if task.Status != StatusPending && task.Status != StatusRunning {
		return fmt.Errorf("task cannot be cancelled")
	}

	// Mark as cancelled (in real implementation, would cancel context)
	task.Status = StatusCancelled

	// Update stats
	m.statsMu.Lock()
	m.stats.QueueSize--
	if task.Status == StatusRunning {
		m.stats.ActiveTasks--
	}
	m.statsMu.Unlock()

	// Publish event
	m.publishEvent(wps.WaveEvent{
		Event:  "task:cancelled",
		Scopes: []string{fmt.Sprintf("task:%s", taskID)},
		Data:   task,
	})

	return nil
}

// GetSystemStats returns current metrics
func (m *Manager) GetSystemStats() SystemStats {
	m.statsMu.RLock()
	defer m.statsMu.RUnlock()

	// Count active workers
	activeWorkers := 0
	idleWorkers := 0
	for _, w := range m.workers {
		w.busyMu.Lock()
		if w.isBusy {
			activeWorkers++
		} else {
			idleWorkers++
		}
		w.busyMu.Unlock()
	}

	stats := m.stats
	stats.WorkersActive = activeWorkers
	stats.WorkersIdle = idleWorkers
	stats.ActiveTasks = len(m.tasks) - int(stats.CompletedTasks) - int(stats.FailedTasks)
	stats.LastUpdated = time.Now()
	stats.Uptime = time.Since(m.startTime)

	return stats
}

// Start begins task processing
func (m *Manager) Start() error {
	if len(m.handlers) == 0 {
		return fmt.Errorf("no handlers registered")
	}

	// Start workers
	for i := 0; i < m.config.MaxWorkers; i++ {
		w := &worker{
			id:       fmt.Sprintf("worker-%d", i),
			manager:  m,
			taskChan: make(chan *Task, 1),
			quit:     make(chan bool),
		}

		m.workers = append(m.workers, w)
		m.wg.Add(1)
		go w.run()
	}

	// Start scheduler
	m.wg.Add(1)
	go m.scheduler()

	return nil
}

// Stop shuts down the manager
func (m *Manager) Stop() error {
	m.cancel()

	// Stop workers
	for _, w := range m.workers {
		w.quit <- true
	}

	// Wait for completion
	m.wg.Wait()

	// Cancel remaining tasks
	m.mu.Lock()
	for _, task := range m.tasks {
		if task.Status == StatusPending || task.Status == StatusRunning {
			task.Status = StatusCancelled
		}
	}
	m.mu.Unlock()

	return nil
}

// scheduler distributes tasks to workers
func (m *Manager) scheduler() {
	defer m.wg.Done()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	priorities := []TaskPriority{PriorityCritical, PriorityHigh, PriorityNormal, PriorityLow}

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			// Process each priority level
			for _, priority := range priorities {
				select {
				case task := <-m.queues[priority]:
					m.dispatchTask(task)
				default:
					// No tasks at this priority
				}
			}
		}
	}
}

// dispatchTask assigns task to available worker
func (m *Manager) dispatchTask(task *Task) {
	for _, w := range m.workers {
		if !w.isBusy {
			if w.assignTask(task) {
				return
			}
		}
	}

	// No available workers, re-queue
	select {
	case m.queues[task.Priority] <- task:
		// Successfully re-queued
	default:
		// Queue full, fail task
		m.mu.Lock()
		if existingTask, exists := m.tasks[task.ID]; exists {
			existingTask.Status = StatusFailed
			existingTask.Error = "no available workers"
		}
		m.mu.Unlock()
	}
}

// publishEvent sends events through Wave event system
func (m *Manager) publishEvent(event wps.WaveEvent) {
	if m.eventBroker != nil {
		m.eventBroker.Publish(event)
	}
}

// worker implementation
func (w *worker) run() {
	for {
		select {
		case task := <-w.taskChan:
			w.processTask(task)
		case <-w.quit:
			return
		}
	}
}

func (w *worker) assignTask(task *Task) bool {
	select {
	case w.taskChan <- task:
		w.busyMu.Lock()
		w.isBusy = true
		w.busyMu.Unlock()
		return true
	default:
		return false
	}
}

func (w *worker) processTask(task *Task) {
	defer func() {
		w.busyMu.Lock()
		w.isBusy = false
		w.busyMu.Unlock()
	}()

	// Update task status
	task.Status = StatusRunning
	startTime := time.Now()

	// Get handler
	w.manager.mu.RLock()
	handler, exists := w.manager.handlers[task.Type]
	w.manager.mu.RUnlock()

	if !exists {
		task.Status = StatusFailed
		task.Error = fmt.Sprintf("no handler for type: %s", task.Type)
		return
	}

	// Execute task with timeout
	ctx, cancel := context.WithTimeout(task.Context, w.manager.config.TaskTimeout)
	defer cancel()

	// Update context
	task.Context = ctx

	// Execute handler
	err := handler(ctx, task)

	// Update task status
	duration := time.Since(startTime)
	if err != nil {
		task.Status = StatusFailed
		task.Error = err.Error()
	} else {
		task.Status = StatusCompleted
	}

	// Update stats
	w.manager.statsMu.Lock()
	w.manager.stats.CompletedTasks++
	w.manager.stats.QueueSize--
	if task.Status == StatusFailed {
		w.manager.stats.FailedTasks++
	}
	w.manager.statsMu.Unlock()

	// Publish completion event
	w.manager.publishEvent(wps.WaveEvent{
		Event:  "task:completed",
		Scopes: []string{fmt.Sprintf("task:%s", task.ID)},
		Data: map[string]interface{}{
			"task":     task,
			"duration": duration,
			"success":  task.Status == StatusCompleted,
		},
	})
}

func (w *worker) isBusy() bool {
	w.busyMu.Lock()
	defer w.busyMu.Unlock()
	return w.isBusy
}
