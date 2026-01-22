package streamclient

import (
	"bytes"
	"encoding/base64"
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

func TestOutOfOrderPackets(t *testing.T) {
	transport := newFakeTransport()
	reader := NewReader("test-ooo", 1024, transport)

	packet0 := wshrpc.CommandStreamData{
		Id:     "test-ooo",
		Seq:    0,
		Data64: base64.StdEncoding.EncodeToString([]byte("AAAAA")),
	}
	packet5 := wshrpc.CommandStreamData{
		Id:     "test-ooo",
		Seq:    5,
		Data64: base64.StdEncoding.EncodeToString([]byte("BBBBB")),
	}
	packet10 := wshrpc.CommandStreamData{
		Id:     "test-ooo",
		Seq:    10,
		Data64: base64.StdEncoding.EncodeToString([]byte("CCCCC")),
	}
	packet15 := wshrpc.CommandStreamData{
		Id:     "test-ooo",
		Seq:    15,
		Data64: base64.StdEncoding.EncodeToString([]byte("DDDDD")),
	}

	// Send packets out of order: 0, 10, 15, 5
	reader.RecvData(packet0)
	reader.RecvData(packet10) // OOO - should be buffered
	reader.RecvData(packet15) // OOO - should be buffered
	reader.RecvData(packet5)  // fills the gap - should trigger processing

	// Read all data
	buf := make([]byte, 1024)
	totalRead := 0
	expectedLen := 20 // 4 packets * 5 bytes each

	readDone := make(chan struct{})
	go func() {
		for totalRead < expectedLen {
			n, err := reader.Read(buf[totalRead:])
			if err != nil {
				t.Errorf("Read failed: %v", err)
				return
			}
			totalRead += n
		}
		close(readDone)
	}()

	select {
	case <-readDone:
		// Success
	case <-time.After(2 * time.Second):
		t.Fatalf("Read didn't complete in time. Read %d bytes, expected %d", totalRead, expectedLen)
	}

	if totalRead != expectedLen {
		t.Fatalf("Expected to read %d bytes, got %d", expectedLen, totalRead)
	}
}

func TestOutOfOrderWithDuplicates(t *testing.T) {
	transport := newFakeTransport()
	reader := NewReader("test-dup", 1024, transport)

	packet0 := wshrpc.CommandStreamData{
		Id:     "test-dup",
		Seq:    0,
		Data64: base64.StdEncoding.EncodeToString([]byte("aaaaa")),
	}
	packet10 := wshrpc.CommandStreamData{
		Id:     "test-dup",
		Seq:    10,
		Data64: base64.StdEncoding.EncodeToString([]byte("ccccc")),
	}
	packet5First := wshrpc.CommandStreamData{
		Id:     "test-dup",
		Seq:    5,
		Data64: base64.StdEncoding.EncodeToString([]byte("xxxxx")),
	}
	packet5Second := wshrpc.CommandStreamData{
		Id:     "test-dup",
		Seq:    5,
		Data64: base64.StdEncoding.EncodeToString([]byte("bbbbb")),
	}

	reader.RecvData(packet0)
	reader.RecvData(packet10)      // OOO - buffered
	reader.RecvData(packet5First)  // OOO - buffered
	reader.RecvData(packet5First)  // Duplicate - should be ignored
	reader.RecvData(packet5Second) // Duplicate with different data - should be ignored

	// Read all data - should get all 3 packets in order
	buf := make([]byte, 20)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	
	// Should get all 15 bytes (3 packets * 5 bytes)
	if n != 15 {
		t.Fatalf("Expected to read 15 bytes, got %d", n)
	}
	
	// Should be "aaaaaxxxxxccccc" (first packet received for each seq wins)
	expected := "aaaaaxxxxxccccc"
	if string(buf[:n]) != expected {
		t.Fatalf("Expected %q, got %q", expected, string(buf[:n]))
	}
}

func TestOutOfOrderWithGaps(t *testing.T) {
	transport := newFakeTransport()
	reader := NewReader("test-gaps", 1024, transport)

	packet0 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    0,
		Data64: base64.StdEncoding.EncodeToString([]byte("aaaaa")),
	}
	packet20 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    20,
		Data64: base64.StdEncoding.EncodeToString([]byte("eeeee")),
	}
	packet40 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    40,
		Data64: base64.StdEncoding.EncodeToString([]byte("iiiii")),
	}
	packet5 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    5,
		Data64: base64.StdEncoding.EncodeToString([]byte("bbbbb")),
	}

	reader.RecvData(packet0)
	reader.RecvData(packet40) // Way ahead - should be buffered
	reader.RecvData(packet20) // Still ahead - should be buffered
	
	// Read first packet
	buf := make([]byte, 10)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if n != 5 || string(buf[:n]) != "aaaaa" {
		t.Fatalf("Expected 'aaaaa', got %q", string(buf[:n]))
	}

	// Send packet to partially fill gap
	reader.RecvData(packet5)

	// Should be able to read it now
	n, err = reader.Read(buf)
	if err != nil {
		t.Fatalf("Second read failed: %v", err)
	}
	if n != 5 || string(buf[:n]) != "bbbbb" {
		t.Fatalf("Expected 'bbbbb', got %q", string(buf[:n]))
	}

	packet10 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    10,
		Data64: base64.StdEncoding.EncodeToString([]byte("ccccc")),
	}
	packet15 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    15,
		Data64: base64.StdEncoding.EncodeToString([]byte("ddddd")),
	}
	packet25 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    25,
		Data64: base64.StdEncoding.EncodeToString([]byte("fffff")),
	}
	packet30 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    30,
		Data64: base64.StdEncoding.EncodeToString([]byte("ggggg")),
	}
	packet35 := wshrpc.CommandStreamData{
		Id:     "test-gaps",
		Seq:    35,
		Data64: base64.StdEncoding.EncodeToString([]byte("hhhhh")),
	}

	reader.RecvData(packet10)
	reader.RecvData(packet15)
	reader.RecvData(packet25)
	reader.RecvData(packet30)
	reader.RecvData(packet35)

	// Read all remaining data at once
	allData := make([]byte, 100)
	totalRead := 0
	for totalRead < 35 {
		n, err = reader.Read(allData[totalRead:])
		if err != nil {
			t.Fatalf("Read failed: %v", err)
		}
		totalRead += n
	}

	expected := "cccccdddddeeeeefffffggggghhhhhiiiii"
	if string(allData[:totalRead]) != expected {
		t.Fatalf("Expected %q, got %q", expected, string(allData[:totalRead]))
	}
}

func TestOutOfOrderWithEOF(t *testing.T) {
	transport := newFakeTransport()
	reader := NewReader("test-eof", 1024, transport)

	packet0 := wshrpc.CommandStreamData{
		Id:     "test-eof",
		Seq:    0,
		Data64: base64.StdEncoding.EncodeToString([]byte("first")),
	}
	packet11 := wshrpc.CommandStreamData{
		Id:     "test-eof",
		Seq:    11,
		Data64: base64.StdEncoding.EncodeToString([]byte("third")),
		Eof:    true,
	}
	packet5 := wshrpc.CommandStreamData{
		Id:     "test-eof",
		Seq:    5,
		Data64: base64.StdEncoding.EncodeToString([]byte("second")),
	}

	reader.RecvData(packet0)
	reader.RecvData(packet11) // OOO with EOF
	reader.RecvData(packet5)  // Fill the gap

	// Read all data
	buf := make([]byte, 20)
	n, err := reader.Read(buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	
	expected := "firstsecondthird"
	if string(buf[:n]) != expected {
		t.Fatalf("Expected %q, got %q", expected, string(buf[:n]))
	}

	// Should get EOF now
	_, err = reader.Read(buf)
	if err != io.EOF {
		t.Fatalf("Expected EOF, got %v", err)
	}
}
