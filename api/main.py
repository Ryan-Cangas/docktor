import asyncio
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx

app = FastAPI(title="Docktor Multi-Node BFF")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Comma-separated format: "nodeName=http://ip:8081,nodeName2=http://ip2:8081"
RAW_AGENTS = os.getenv("AGENT_URLS", "local=http://agent:8081")


def parse_agents() -> dict[str, str]:
    agents = {}
    for entry in RAW_AGENTS.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "=" in entry:
            name, url = entry.split("=", 1)
            agents[name.strip()] = url.strip().rstrip("/")
        else:
            agents["default"] = entry.rstrip("/")
    return agents


@app.get("/api/containers")
async def get_containers():
    agents = parse_agents()

    async def fetch_node(node: str, base_url: str):
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                resp = await client.get(f"{base_url}/containers")
                raw = resp.json()
                return [
                    {
                        "id": f"{node}:{c['Id'][:12]}",
                        "raw_id": c["Id"][:12],
                        "node": node,
                        "name": c["Names"][0].lstrip("/") if c.get("Names") else c["Id"][:12],
                        "image": c["Image"],
                        "state": c["State"],
                        "status": c["Status"],
                        "auto_heal": c.get("Labels", {}).get("docktor.heal") == "true",
                    }
                    for c in raw
                ]
        except httpx.RequestError:
            return []

    results = await asyncio.gather(*(fetch_node(n, u) for n, u in agents.items()))
    return [item for sublist in results for item in sublist]


@app.get("/api/history")
async def get_heal_history():
    agents = parse_agents()

    async def fetch_history(node: str, base_url: str):
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                resp = await client.get(f"{base_url}/history")
                items = resp.json() or []
                for item in items:
                    item["node"] = node
                return items
        except httpx.RequestError:
            return []

    results = await asyncio.gather(*(fetch_history(n, u) for n, u in agents.items()))
    combined = [item for sublist in results for item in sublist]
    combined.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return combined[:50]


@app.get("/api/logs/{composite_id}")
async def stream_logs(composite_id: str, request: Request):
    agents = parse_agents()
    if ":" in composite_id:
        node, container_id = composite_id.split(":", 1)
    else:
        node, container_id = next(iter(agents.keys())), composite_id

    base_url = agents.get(node)
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Unknown node: {node}")

    async def event_generator():
        timeout = httpx.Timeout(None, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "GET", f"{base_url}/logs", params={"id": container_id}
            ) as resp:
                async for line in resp.aiter_lines():
                    if await request.is_disconnected():
                        break
                    if line:
                        yield f"data: {line}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )