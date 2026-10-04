"""HTTP API for the web explorer.

    uvicorn server.app:app --reload --port 8000

The graph is reloaded automatically when any file under data/ changes, so a
curator can edit YAML and refresh the browser. If the edited YAML fails
validation, the API keeps serving the last good version and reports the
problems on /api/meta.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from kg.formulate import Engine, EngineConfig, PetProfile
from kg.loader import DATA_DIR, KGValidationError, KnowledgeGraph, load

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples" / "pets.yaml"
WEB_DIST = ROOT / "web" / "dist"

# graph edges that are not useful to draw (citations are shown as edge properties instead)
HIDDEN_RELS = {"CITES"}


class _Cache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.stamp: float | None = None
        self.kg: KnowledgeGraph | None = None
        self.payload: dict[str, Any] | None = None
        self.problems: list[str] = []

    @staticmethod
    def _stamp() -> float:
        return max((p.stat().st_mtime for p in DATA_DIR.rglob("*.yaml")), default=0.0)

    def get(self) -> KnowledgeGraph:
        with self.lock:
            stamp = self._stamp()
            if self.kg is None or stamp != self.stamp:
                try:
                    self.kg = load()
                    self.payload = None
                    self.problems = []
                except KGValidationError as exc:
                    self.problems = exc.problems
                    if self.kg is None:
                        raise HTTPException(500, {"message": "knowledge graph failed validation",
                                                  "problems": exc.problems})
                self.stamp = stamp
            return self.kg


cache = _Cache()
app = FastAPI(title="Freyja supplement KG explorer")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _jsonable(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "value"):
        return v.value
    return v


def _node_type(node_id: str) -> str:
    return node_id.split(":", 1)[0]


def build_payload(kg: KnowledgeGraph) -> dict[str, Any]:
    g = kg.graph
    nodes = []
    for nid, data in g.nodes(data=True):
        props = {k: _jsonable(v) for k, v in data.items() if k not in ("label",)}
        name = props.get("name") or props.get("citation") or nid
        nodes.append({"id": nid, "type": _node_type(nid), "kind": data.get("label"), "name": name, "props": props})
    edges = []
    for u, v, k, data in g.edges(keys=True, data=True):
        rel = data.get("rel")
        if rel in HIDDEN_RELS:
            continue
        eid = k if isinstance(k, str) else f"{rel}|{u}|{v}"
        props = {x: _jsonable(y) for x, y in data.items() if x != "rel"}
        edges.append({"id": eid, "rel": rel, "source": u, "target": v, "props": props})
    # de-duplicate edge ids (structural edges between the same pair)
    seen: dict[str, int] = {}
    for e in edges:
        n = seen.get(e["id"], 0)
        seen[e["id"]] = n + 1
        if n:
            e["id"] = f"{e['id']}#{n}"
    return {"version": kg.version, "nodes": nodes, "edges": edges}


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    kg = cache.get()
    counts: dict[str, int] = {}
    for nid in kg.nodes:
        counts[_node_type(nid)] = counts.get(_node_type(nid), 0) + 1
    counts["source"] = len(kg.sources)
    curation: dict[str, int] = {}
    for es in kg.edges.values():
        for e in es:
            curation[e.curation.status] = curation.get(e.curation.status, 0) + 1
    return {
        "version": kg.version,
        "node_counts": counts,
        "relation_counts": {rel: len(es) for rel, es in kg.edges.items()},
        "curation": curation,
        "warnings": kg.warnings,
        "reload_problems": cache.problems,
    }


@app.get("/api/graph")
def graph() -> dict[str, Any]:
    kg = cache.get()
    if cache.payload is None or cache.payload["version"] != kg.version:
        cache.payload = build_payload(kg)
    return cache.payload


@app.get("/api/examples")
def examples() -> list[dict[str, Any]]:
    return yaml.safe_load(EXAMPLES.read_text()) or []


@app.post("/api/formulate")
def formulate(profile: dict[str, Any]) -> dict[str, Any]:
    kg = cache.get()
    config = profile.pop("config", None)
    try:
        pet = PetProfile.model_validate(profile)
        cfg = EngineConfig.model_validate(config) if config else None
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False))
    unknown = [x for x in [pet.breed, *pet.conditions, *pet.medications, *pet.allergens,
                           *(n.need for n in pet.needs)] if x and x not in kg.nodes]
    if unknown:
        raise HTTPException(422, f"unknown ids: {unknown}")
    formula = Engine(kg, cfg).formulate(pet)
    return formula.model_dump(mode="json")


# Serve the built explorer (yarn build) from the same origin when present.
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
