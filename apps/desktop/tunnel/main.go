package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

type request struct {
	ID      int             `json:"id"`
	Cmd     string          `json:"cmd"`
	Payload json.RawMessage `json:"payload"`
}

type response struct {
	ID     int         `json:"id"`
	OK     bool        `json:"ok"`
	Error  string      `json:"error,omitempty"`
	Status string      `json:"status,omitempty"`
	Stats  *TunnelStats `json:"stats,omitempty"`
}

type upPayload struct {
	PrivateKey   string   `json:"privateKey"`
	Address      string   `json:"address"`
	DNS          []string `json:"dns"`
	BypassRoutes []string `json:"bypassRoutes"`
	Peer         peerSpec `json:"peer"`
}

type peerSpec struct {
	PublicKey           string   `json:"publicKey"`
	PresharedKey        string   `json:"presharedKey,omitempty"`
	Endpoint            string   `json:"endpoint"`
	AllowedIPs          []string `json:"allowedIps"`
	PersistentKeepalive *int     `json:"persistentKeepalive,omitempty"`
}

type TunnelStats struct {
	RxBytes           uint64 `json:"rxBytes"`
	TxBytes           uint64 `json:"txBytes"`
	LastHandshakeSec  int64  `json:"lastHandshakeSec"`
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[tunnel-helper] "+format+"\n", args...)
}

func main() {
	mgr := newTunnel()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	enc := json.NewEncoder(os.Stdout)
	var mu sync.Mutex

	reply := func(r response) {
		mu.Lock()
		defer mu.Unlock()
		_ = enc.Encode(r)
	}

	logf("ready")

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req request
		if err := json.Unmarshal(line, &req); err != nil {
			reply(response{OK: false, Error: "invalid json"})
			continue
		}

		switch req.Cmd {
		case "warmup":
			if err := mgr.Warmup(); err != nil {
				reply(response{ID: req.ID, OK: false, Error: err.Error()})
				continue
			}
			reply(response{ID: req.ID, OK: true, Status: "disconnected"})
		case "up":
			var p upPayload
			if err := json.Unmarshal(req.Payload, &p); err != nil {
				reply(response{ID: req.ID, OK: false, Error: "invalid payload"})
				continue
			}
			logf("up start endpoint=%s", p.Peer.Endpoint)
			if err := mgr.Up(p); err != nil {
				logf("up failed: %v", err)
				reply(response{ID: req.ID, OK: false, Error: err.Error()})
				continue
			}
			logf("up ok")
			reply(response{ID: req.ID, OK: true, Status: "connected"})
		case "down":
			if err := mgr.Down(); err != nil {
				reply(response{ID: req.ID, OK: false, Error: err.Error()})
				continue
			}
			reply(response{ID: req.ID, OK: true, Status: "disconnected"})
		case "status":
			st := "disconnected"
			if mgr.IsUp() {
				st = "connected"
			}
			reply(response{ID: req.ID, OK: true, Status: st})
		case "stats":
			stats := mgr.Stats()
			reply(response{ID: req.ID, OK: true, Stats: &stats})
		default:
			reply(response{ID: req.ID, OK: false, Error: fmt.Sprintf("unknown cmd %q", req.Cmd)})
		}
	}
}
