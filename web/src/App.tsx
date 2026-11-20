import { useEffect, useMemo, useRef, useState } from "react";

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
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const [cRes, hRes] = await Promise.all([
        fetch("/api/containers"),
        fetch("/api/history"),
      ]);
      if (cRes.ok) {
        const list: ContainerInfo[] = await cRes.json();
        setContainers(list);
        if (list.length > 0) {
          setSelectedId((prev) =>
            prev && list.some((c) => c.id === prev) ? prev : list[0].id,
          );
        }
      }
      if (hRes.ok) {
        setHistory(await hRes.json());
      }
    } catch (err) {
      console.error("Polling error:", err);
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
      setLogs((prev) => [...prev.slice(-400), e.data]);
    };
    return () => es.close();
  }, [selectedId]);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const nodes = useMemo(() => {
    const unique = new Set(
      containers.map((c) => c.node).filter((n): n is string => Boolean(n)),
    );
    return ["all", ...Array.from(unique)];
  }, [containers]);

  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      const matchesNode = nodeFilter === "all" || c.node === nodeFilter;
      const matchesSearch = c.name
        .toLowerCase()
        .includes(search.toLowerCase().trim());
      return matchesNode && matchesSearch;
    });
  }, [containers, nodeFilter, search]);

  const selectedContainer = containers.find((c) => c.id === selectedId);
  const runningCount = containers.filter((c) => c.state === "running").length;

  const getLogColor = (line: string) => {
    const lower = line.toLowerCase();
    if (
      lower.includes("error") ||
      lower.includes("fatal") ||
      lower.includes("panic") ||
      lower.includes("exception")
    ) {
      return "#f87171";
    }
    if (lower.includes("warn")) {
      return "#fbbf24";
    }
    return "#e2e8f0";
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        height: "100vh",
      }}
    >
      <aside
        style={{
          borderRight: "1px solid #1e293b",
          padding: "1rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0, color: "#38bdf8" }}>🩺 Docktor</h2>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
            {runningCount}/{containers.length} up
          </span>
        </div>

        {/* Search input */}
        <input
          type="text"
          placeholder="Filter containers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.45rem 0.65rem",
            marginBottom: "0.6rem",
            borderRadius: "6px",
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#f8fafc",
            fontSize: "0.8rem",
            outline: "none",
          }}
        />

        {/* LXC Node filter tabs */}
        {nodes.length > 2 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              marginBottom: "0.75rem",
            }}
          >
            {nodes.map((n) => (
              <button
                key={n}
                onClick={() => setNodeFilter(n)}
                style={{
                  padding: "0.2rem 0.55rem",
                  borderRadius: "999px",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  border: "1px solid #334155",
                  background: nodeFilter === n ? "#0284c7" : "#0f172a",
                  color: nodeFilter === n ? "#fff" : "#94a3b8",
                }}
              >
                {n === "all" ? "All Nodes" : n}
              </button>
            ))}
          </div>
        )}

        <h4
          style={{
            color: "#94a3b8",
            marginTop: "0.25rem",
            marginBottom: "0.5rem",
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
          }}
        >
          CONTAINERS ({filteredContainers.length})
        </h4>

        {filteredContainers.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{
              padding: "0.7rem",
              marginBottom: "0.45rem",
              borderRadius: "8px",
              cursor: "pointer",
              background: selectedId === c.id ? "#1e293b" : "#0f172a",
              border:
                selectedId === c.id ? "1px solid #38bdf8" : "1px solid #334155",
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
                    fontSize: "0.88rem",
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
                      background: "#0f172a",
                      color: "#38bdf8",
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
                  fontSize: "0.72rem",
                  flexShrink: 0,
                }}
              >
                ● {c.state}
              </span>
            </div>
            <div
              style={{
                fontSize: "0.73rem",
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
            marginTop: "1.25rem",
            marginBottom: "0.5rem",
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
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
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{h.container_name}</strong>
              {h.node && (
                <span style={{ fontSize: "0.68rem", color: "#38bdf8" }}>
                  {h.node}
                </span>
              )}
            </div>
            <div>
              ({h.trigger}) →{" "}
              <span style={{ color: "#4ade80" }}>{h.status}</span>
            </div>
            <div style={{ color: "#64748b", fontSize: "0.7rem" }}>
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.6rem",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            Live Logs —{" "}
            {selectedContainer
              ? `${selectedContainer.name}${
                  selectedContainer.node ? ` (${selectedContainer.node})` : ""
                }`
              : "Select a container"}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => setAutoScroll((prev) => !prev)}
              style={{
                padding: "0.3rem 0.65rem",
                borderRadius: "6px",
                border: "1px solid #334155",
                background: autoScroll ? "#1e293b" : "#b45309",
                color: "#f8fafc",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              {autoScroll ? "Auto-Scroll: ON" : "Auto-Scroll: PAUSED"}
            </button>
            <button
              onClick={() => setLogs([])}
              style={{
                padding: "0.3rem 0.65rem",
                borderRadius: "6px",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#94a3b8",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            background: "#020617",
            border: "1px solid #1e293b",
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
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                color: getLogColor(line),
              }}
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
