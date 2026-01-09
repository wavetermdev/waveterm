package streamclient

import (
	"bytes"
	"io"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type fakeTransport struct {
	dataChan chan wshrpc.CommandStreamData
	ackChan  chan wshrpc.CommandStreamAckData
}

func newFakeTransport() *fakeTransport {
	return &fakeTransport{
		dataChan: make(chan wshrpc.CommandStreamData, 10),
		ackChan:  make(chan wshrpc.CommandStreamAckData, 10),
	}
}

func (ft *fakeTransport) SendData(dataPk wshrpc.CommandStreamData) {
	ft.dataChan <- dataPk
}

func (ft *fakeTransport) SendAck(ackPk wshrpc.CommandStreamAckData) {
	ft.ackChan <- ackPk
}

func TestBasicReadWrite(t *testing.T) {
	transport := newFakeTransport()

	reader := NewReader("1", 1024, transport)
	writer := NewWriter("1", 1024, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	testData := []byte("Hello, World!")
	n, err := writer.Write(testData)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if n != len(testData) {
		t.Fatalf("Write returned %d, expected %d", n, len(testData))
	}

	buf := make([]byte, 1024)
	n, err = reader.Read(buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if n != len(testData) {
		t.Fatalf("Read returned %d, expected %d", n, len(testData))
	}
	if !bytes.Equal(buf[:n], testData) {
		t.Fatalf("Read data %q doesn't match written data %q", buf[:n], testData)
	}
}

func TestEOF(t *testing.T) {
	transport := newFakeTransport()

	reader := NewReader("1", 1024, transport)
	writer := NewWriter("1", 1024, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	testData := []byte("Test data")
	writer.Write(testData)
	writer.Close()

	buf := make([]byte, 1024)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("First read failed: %v", err)
	}
	if !bytes.Equal(buf[:n], testData) {
		t.Fatalf("Read data doesn't match")
	}

	_, err = reader.Read(buf)
	if err != io.EOF {
		t.Fatalf("Expected EOF, got %v", err)
	}
}

func TestFlowControl(t *testing.T) {
	smallWindow := int64(10)
	transport := newFakeTransport()

	reader := NewReader("1", smallWindow, transport)
	writer := NewWriter("1", smallWindow, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	largeData := make([]byte, 100)
	for i := range largeData {
		largeData[i] = byte(i)
	}

	writeDone := make(chan error)
	go func() {
		_, err := writer.Write(largeData)
		writeDone <- err
	}()

	received := make([]byte, 0, 100)
	buf := make([]byte, 20)
	for len(received) < len(largeData) {
		n, err := reader.Read(buf)
		if err != nil {
			t.Fatalf("Read failed: %v", err)
		}
		received = append(received, buf[:n]...)
	}

	select {
	case err := <-writeDone:
		if err != nil {
			t.Fatalf("Write failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Write didn't complete in time")
	}

	if !bytes.Equal(received, largeData) {
		t.Fatal("Received data doesn't match sent data")
	}
}

func TestError(t *testing.T) {
	transport := newFakeTransport()

	reader := NewReader("1", 1024, transport)
	writer := NewWriter("1", 1024, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	testErr := io.ErrUnexpectedEOF
	writer.CloseWithError(testErr)

	buf := make([]byte, 1024)
	_, err := reader.Read(buf)
	if err == nil {
		t.Fatal("Expected error from read")
	}
	if err.Error() != "stream error: unexpected EOF" {
		t.Fatalf("Expected stream error, got: %v", err)
	}
}

func TestCancel(t *testing.T) {
	transport := newFakeTransport()

	reader := NewReader("1", 1024, transport)
	writer := NewWriter("1", 1024, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	reader.Close()

	select {
	case <-writer.GetCanceledChan():
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("Writer not notified of cancellation")
	}

	_, _, canceled := writer.GetAckState()
	if !canceled {
		t.Fatal("Writer should be in canceled state")
	}
}

func TestMultipleWrites(t *testing.T) {
	transport := newFakeTransport()

	reader := NewReader("1", 1024, transport)
	writer := NewWriter("1", 1024, transport)

	go func() {
		for dataPk := range transport.dataChan {
			reader.RecvData(dataPk)
		}
	}()

	go func() {
		for ackPk := range transport.ackChan {
			writer.RecvAck(ackPk)
		}
	}()

	messages := []string{"First", "Second", "Third"}
	for _, msg := range messages {
		_, err := writer.Write([]byte(msg))
		if err != nil {
			t.Fatalf("Write failed: %v", err)
		}
	}

	expected := "FirstSecondThird"
	buf := make([]byte, len(expected))
	totalRead := 0
	for totalRead < len(expected) {
		n, err := reader.Read(buf[totalRead:])
		if err != nil {
			t.Fatalf("Read failed: %v", err)
		}
		totalRead += n
	}

	if string(buf) != expected {
		t.Fatalf("Expected %q, got %q", expected, string(buf))
	}
}
