package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type HealEvent struct {
	Timestamp     time.Time `json:"timestamp"`
	ContainerID   string    `json:"container_id"`
	ContainerName string    `json:"container_name"`
	Trigger       string    `json:"trigger"`
	Status        string    `json:"status"`
}

type Agent struct {
	dockerURL   string
	httpClient  *http.Client
	mu          sync.Mutex
	lastHealed  map[string]time.Time
	healHistory []HealEvent
}

func NewAgent() *Agent {
	host := os.Getenv("DOCKER_HOST")
	if host == "" {
		host = "http://socket-proxy:2375"
	}
	host = strings.Replace(host, "tcp://", "http://", 1)

	a := &Agent{
		dockerURL:  strings.TrimRight(host, "/"),
		httpClient: &http.Client{Timeout: 15 * time.Second},
		lastHealed: make(map[string]time.Time),
	}

	for i := 0; i < 15; i++ {
		if resp, err := a.httpClient.Get(a.dockerURL + "/_ping"); err == nil {
			resp.Body.Close()
			break
		}
		log.Println("[Docktor Agent] Waiting for socket-proxy...")
		time.Sleep(1 * time.Second)
	}
	return a
}

func (a *Agent) watchEvents() {
	streamClient := &http.Client{}
	log.Println("[Docktor Agent] Listening for Docker crash/unhealthy events...")

	for {
		reqURL := a.dockerURL + `/events?filters={"type":["container"],"event":["die","oom","health_status"]}`
		resp, err := streamClient.Get(reqURL)
		if err != nil {
			log.Printf("[Error] Event stream disconnected: %v. Retrying in 3s...", err)
			time.Sleep(3 * time.Second)
			continue
		}

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			var ev struct {
				Action string `json:"Action"`
				Actor  struct {
					ID         string            `json:"ID"`
					Attributes map[string]string `json:"Attributes"`
				} `json:"Actor"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &ev); err != nil {
				continue
			}
			if ev.Action == "health_status" && ev.Actor.Attributes["health_status"] != "unhealthy" {
				continue
			}
			go a.handleCandidate(ev.Actor.ID, ev.Action)
		}
		resp.Body.Close()
		time.Sleep(2 * time.Second)
	}
}

func (a *Agent) handleCandidate(id string, trigger string) {
	resp, err := a.httpClient.Get(fmt.Sprintf("%s/containers/%s/json", a.dockerURL, id))
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var inspect struct {
		Name   string `json:"Name"`
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
		State struct {
			ExitCode int `json:"ExitCode"`
		} `json:"State"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&inspect); err != nil {
		return
	}

	if inspect.Config.Labels["docktor.heal"] != "true" {
		return
	}
	if trigger == "die" && inspect.State.ExitCode == 0 {
		return
	}

	a.mu.Lock()
	if last, ok := a.lastHealed[id]; ok && time.Since(last) < 15*time.Second {
		a.mu.Unlock()
		return
	}
	a.lastHealed[id] = time.Now()
	a.mu.Unlock()

	log.Printf("[Healing] Restarting %s due to %s...", inspect.Name, trigger)
	restartResp, err := a.httpClient.Post(fmt.Sprintf("%s/containers/%s/restart?t=5", a.dockerURL, id), "application/json", nil)
	status := "healed"
	if err != nil {
		status = fmt.Sprintf("failed: %v", err)
	} else {
		restartResp.Body.Close()
		if restartResp.StatusCode >= 300 {
			status = fmt.Sprintf("failed: HTTP %d", restartResp.StatusCode)
		}
	}

	shortID := id
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}

	a.mu.Lock()
	a.healHistory = append([]HealEvent{{
		Timestamp:     time.Now(),
		ContainerID:   shortID,
		ContainerName: strings.TrimPrefix(inspect.Name, "/"),
		Trigger:       trigger,
		Status:        status,
	}}, a.healHistory...)
	if len(a.healHistory) > 50 {
		a.healHistory = a.healHistory[:50]
	}
	a.mu.Unlock()
}

func (a *Agent) handleContainers(w http.ResponseWriter, r *http.Request) {
	resp, err := a.httpClient.Get(a.dockerURL + "/containers/json?all=true")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func (a *Agent) handleHistory(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if a.healHistory == nil {
		w.Write([]byte("[]"))
		return
	}
	json.NewEncoder(w).Encode(a.healHistory)
}

func (a *Agent) handleStreamLogs(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	inspResp, err := a.httpClient.Get(fmt.Sprintf("%s/containers/%s/json", a.dockerURL, id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var inspect struct {
		Config struct {
			Tty bool `json:"Tty"`
		} `json:"Config"`
	}
	json.NewDecoder(inspResp.Body).Decode(&inspect)
	inspResp.Body.Close()

	logClient := &http.Client{}
	req, _ := http.NewRequestWithContext(r.Context(), "GET",
		fmt.Sprintf("%s/containers/%s/logs?stdout=true&stderr=true&follow=true&tail=100&timestamps=true", a.dockerURL, id), nil)
	resp, err := logClient.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)

	if inspect.Config.Tty {
		buf := make([]byte, 4096)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
				if flusher != nil {
					flusher.Flush()
				}
			}
			if err != nil {
				return
			}
		}
	}

	// Demultiplex Docker 8-byte multiplexed log frames
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(resp.Body, header); err != nil {
			return
		}
		size := binary.BigEndian.Uint32(header[4:8])
		if size == 0 {
			continue
		}
		payload := make([]byte, size)
		if _, err := io.ReadFull(resp.Body, payload); err != nil {
			return
		}
		w.Write(payload)
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func main() {
	agent := NewAgent()
	go agent.watchEvents()

	mux := http.NewServeMux()
	mux.HandleFunc("/containers", agent.handleContainers)
	mux.HandleFunc("/history", agent.handleHistory)
	mux.HandleFunc("/logs", agent.handleStreamLogs)

	log.Println("[Docktor Agent] Listening on :8081")
	log.Fatal(http.ListenAndServe(":8081", mux))
}