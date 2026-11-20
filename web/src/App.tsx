import { useEffect, useRef, useState } from "react";

interface ContainerInfo {
  id: string;
  raw_id?: string;
  node?: string;
  name: string;
  image: string;
  state: string;
  status: string;
  auto_heal: boolean;
}

interface HealEvent {
  timestamp: string;
  node?: string;
  container_id: string;
  container_name: string;
  trigger: string;
  status: string;
}

export default function App() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [history, setHistory] = useState<HealEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    const [cRes, hRes] = await Promise.all([
      fetch("/api/containers"),
      fetch("/api/history"),
    ]);
    const cData: ContainerInfo[] = await cRes.json();
    setContainers(cData);
    setHistory(await hRes.json());
    if (!selectedId && cData.length > 0) {
      setSelectedId(cData[0].id);
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLogs([]);
    const es = new EventSource(`/api/logs/${selectedId}`);
    es.onmessage = (e) => {
      setLogs((prev) => [...prev.slice(-300), e.data]);
    };
    return () => es.close();
  }, [selectedId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        height: "100vh",
      }}
    >
      <aside
        style={{
          borderRight: "1px solid #1e293b",
          padding: "1rem",
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, color: "#38bdf8" }}>🩺 Docktor</h2>
        <h4 style={{ color: "#94a3b8", marginBottom: "0.5rem" }}>CONTAINERS</h4>
        {containers.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{
              padding: "0.75rem",
              marginBottom: "0.5rem",
              borderRadius: "8px",
              cursor: "pointer",
              background: selectedId === c.id ? "#1e293b" : "#0f172a",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.name}
                </strong>
                {c.node && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.1rem 0.4rem",
                      borderRadius: "4px",
                      background: "#1e293b",
                      color: "#94a3b8",
                      border: "1px solid #334155",
                      flexShrink: 0,
                    }}
                  >
                    {c.node}
                  </span>
                )}
              </div>
              <span
                style={{
                  color: c.state === "running" ? "#4ade80" : "#f87171",
                  fontSize: "0.75rem",
                  flexShrink: 0,
                }}
              >
                ● {c.state}
              </span>
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                marginTop: "0.25rem",
              }}
            >
              {c.auto_heal ? "🛡️ Auto-Heal Active" : "Manual"} • {c.status}
            </div>
          </div>
        ))}

        <h4
          style={{
            color: "#94a3b8",
            marginTop: "1.5rem",
            marginBottom: "0.5rem",
          }}
        >
          RECENT HEAL EVENTS
        </h4>
        {history.length === 0 && (
          <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
            No crashes healed yet.
          </div>
        )}
        {history.map((h, i) => (
          <div
            key={i}
            style={{
              fontSize: "0.78rem",
              padding: "0.5rem",
              marginBottom: "0.4rem",
              background: "#1e293b",
              borderRadius: "6px",
            }}
          >
            <strong>{h.container_name}</strong> ({h.trigger}) →{" "}
            <span style={{ color: "#4ade80" }}>{h.status}</span>
            <div style={{ color: "#64748b" }}>
              {new Date(h.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </aside>

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "1rem",
          overflow: "hidden",
        }}
      >
        <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>
          Live Logs —{" "}
          {containers.find((c) => c.id === selectedId)?.name ||
            "Select a container"}
        </div>
        <div
          style={{
            flex: 1,
            background: "#020617",
            borderRadius: "8px",
            padding: "1rem",
            overflowY: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: "0.82rem",
            lineHeight: 1.5,
          }}
        >
          {logs.map((line, idx) => (
            <div
              key={idx}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
            >
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </main>
    </div>
  );
}
