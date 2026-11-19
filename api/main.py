import os
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

AGENT_URL = os.getenv("AGENT_URL", "http://agent:8081")

app = FastAPI(title="Docktor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/api/containers")
async def get_containers():
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{AGENT_URL}/containers")
        raw = response.json()
        return [
            {
                "id": c["Id"][:12],
                "name": c["Names"][0].lstrip("/") if c.get("Names") else c["Id"][:12],
                "image": c["Image"],
                "state": c["State"],
                "status": c["Status"],
                "auto_heal": c.get("Labels", {}).get("docktor.heal") == "true",
            }
            for c in raw
        ]

@app.get("/api/history")
async def get_heal_history():
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{AGENT_URL}/history")
        return response.json() or []

@app.get("/api/logs/{container_id}")
async def stream_logs(container_id: str, request: Request):
    async def event_generator():
        timeout = httpx.Timeout(None, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "GET", f"{AGENT_URL}/logs", params={"id": container_id}
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