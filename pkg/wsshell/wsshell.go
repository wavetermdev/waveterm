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

func (ws *WSShell) WritePump() {
	writeWait := 2 * time.Second
	pingPeriod := 2 * time.Second
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		ws.Conn.Close()
	}()
	for {
		select {
		case <-ticker.C:
			now := time.Now()
			pingMessage := map[string]interface{}{"type": "ping", "stime": now.Unix()}
			jsonVal, _ := json.Marshal(pingMessage)
			_ = ws.Conn.SetWriteDeadline(time.Now().Add(writeWait)) // no error
			err := ws.Conn.WriteMessage(websocket.TextMessage, jsonVal)
			ws.NumPings++
			ws.LastPing = now
			if err != nil {
				log.Printf("WritePump %s err: %v\n", ws.RemoteAddr, err)
				return
			}

		case msgBytes := <-ws.WriteChan:
			_ = ws.Conn.SetWriteDeadline(time.Now().Add(writeWait)) // no error
			err := ws.Conn.WriteMessage(websocket.TextMessage, msgBytes)
			if err != nil {
				log.Printf("WritePump %s err: %v\n", ws.RemoteAddr, err)
				return
			}
		}
	}
}

func (ws *WSShell) ReadPump() {
	readWait := 5 * time.Second
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
		ws.ReadChan <- message
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
