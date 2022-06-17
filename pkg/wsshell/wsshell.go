package wsshell

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const readWaitTimeout = 15 * time.Second
const writeWaitTimeout = 10 * time.Second
const pingPeriodTickTime = 10 * time.Second
const initialPingTime = 1 * time.Second

var upgrader = websocket.Upgrader{
	ReadBufferSize:   4 * 1024,
	WriteBufferSize:  4 * 1024,
	HandshakeTimeout: 1 * time.Second,
	CheckOrigin:      func(r *http.Request) bool { return true },
}

type WSShell struct {
	Conn       *websocket.Conn
	RemoteAddr string
	ConnId     string
	Query      url.Values
	OpenTime   time.Time
	NumPings   int
	LastPing   time.Time
	LastRecv   time.Time
	Header     http.Header

	CloseChan chan bool
	WriteChan chan []byte
	ReadChan  chan []byte
}

func (ws *WSShell) NonBlockingWrite(data []byte) bool {
	select {
	case ws.WriteChan <- data:
		return true

	default:
		return false
	}
}

func (ws *WSShell) WritePing() error {
	now := time.Now()
	pingMessage := map[string]interface{}{"type": "ping", "stime": now.Unix()}
	jsonVal, _ := json.Marshal(pingMessage)
	_ = ws.Conn.SetWriteDeadline(time.Now().Add(writeWaitTimeout)) // no error
	err := ws.Conn.WriteMessage(websocket.TextMessage, jsonVal)
	ws.NumPings++
	ws.LastPing = now
	if err != nil {
		return err
	}
	return nil
}

func (ws *WSShell) WriteJson(val interface{}) error {
	barr, err := json.Marshal(val)
	if err != nil {
		return err
	}
	ws.WriteChan <- barr
	return nil
}

func (ws *WSShell) WritePump() {
	ticker := time.NewTicker(pingPeriodTickTime)
	defer func() {
		ticker.Stop()
		ws.Conn.Close()
	}()
	go func() {
		time.Sleep(initialPingTime)
		ws.WritePing()
	}()
	for {
		select {
		case <-ticker.C:
			err := ws.WritePing()
			if err != nil {
				log.Printf("WritePump %s err: %v\n", ws.RemoteAddr, err)
				return
			}

		case msgBytes, ok := <-ws.WriteChan:
			if !ok {
				return
			}
			_ = ws.Conn.SetWriteDeadline(time.Now().Add(writeWaitTimeout)) // no error
			err := ws.Conn.WriteMessage(websocket.TextMessage, msgBytes)
			if err != nil {
				log.Printf("WritePump %s err: %v\n", ws.RemoteAddr, err)
				return
			}
		}
	}
}

func (ws *WSShell) ReadPump() {
	readWait := readWaitTimeout
	defer func() {
		ws.Conn.Close()
	}()
	ws.Conn.SetReadLimit(4096)
	ws.Conn.SetReadDeadline(time.Now().Add(readWait))
	for {
		_, message, err := ws.Conn.ReadMessage()
		if err != nil {
			log.Printf("ReadPump %s Err: %v\n", ws.RemoteAddr, err)
			break
		}
		jmsg := map[string]interface{}{}
		err = json.Unmarshal(message, &jmsg)
		if err != nil {
			log.Printf("Error unmarshalling json: %v\n", err)
			break
		}
		ws.Conn.SetReadDeadline(time.Now().Add(readWait))
		ws.LastRecv = time.Now()
		if str, ok := jmsg["type"].(string); ok && str == "pong" {
			// nothing
			continue
		}
		if str, ok := jmsg["type"].(string); ok && str == "ping" {
			now := time.Now()
			pongMessage := map[string]interface{}{"type": "pong", "stime": now.Unix()}
			jsonVal, _ := json.Marshal(pongMessage)
			ws.WriteChan <- jsonVal
			continue
		}
		ws.ReadChan <- message
	}
}

func (ws *WSShell) IsClosed() bool {
	select {
	case <-ws.CloseChan:
		return true

	default:
		return false
	}
}

func StartWS(w http.ResponseWriter, r *http.Request) (*WSShell, error) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}
	ws := WSShell{Conn: conn, ConnId: uuid.New().String(), OpenTime: time.Now()}
	ws.CloseChan = make(chan bool)
	ws.WriteChan = make(chan []byte, 10)
	ws.ReadChan = make(chan []byte, 10)
	ws.RemoteAddr = r.RemoteAddr
	ws.Query = r.URL.Query()
	ws.Header = r.Header
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ws.WritePump()
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		ws.ReadPump()
	}()
	go func() {
		wg.Wait()
		close(ws.CloseChan)
		close(ws.ReadChan)
	}()
	return &ws, nil
}
