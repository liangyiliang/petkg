"""Export the validated graph to Neo4j Cypher or node-link JSON.

YAML in git is the source of truth (reviewable diffs, PR-based curation).
Neo4j is a read-only projection for exploration and ad-hoc queries.
"""

from __future__ import annotations

import json
from datetime import date
from enum import Enum

from networkx.readwrite import json_graph

from .loader import KnowledgeGraph


def _clean(v):
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (list, tuple)):
        if all(isinstance(x, (str, int, float, bool)) or x is None for x in v):
            return [x for x in v if x is not None]
        return json.dumps(v, default=str)
    if isinstance(v, dict):
        return json.dumps(v, default=str)
    return v


def _props(d: dict) -> str:
    items = {k: _clean(v) for k, v in d.items() if v is not None and v != [] and k != "label"}
    return json.dumps(items, default=str, ensure_ascii=False)


def to_cypher(kg: KnowledgeGraph) -> str:
    """Emit idempotent MERGE statements (one per line) using APOC-free Cypher."""
    g = kg.graph
    lines = [f"// Freyja supplement KG version {kg.version}",
             "CREATE CONSTRAINT kg_id IF NOT EXISTS FOR (n:KG) REQUIRE n.id IS UNIQUE;"]
    for nid, data in g.nodes(data=True):
        label = data.get("label", "Node")
        lines.append(f"MERGE (n:KG:{label} {{id: {json.dumps(nid)}}}) SET n += {_props(data)};")
    for u, v, k, data in g.edges(keys=True, data=True):
        rel = data.get("rel", "RELATED")
        props = _props({x: y for x, y in data.items() if x != "rel"})
        # stable per-relationship key: the KG edge id when there is one, else endpoints + rel
        key = k if isinstance(k, str) else f"{rel}|{u}|{v}|{data.get('about', k)}"
        lines.append(f"MATCH (a:KG {{id: {json.dumps(u)}}}), (b:KG {{id: {json.dumps(v)}}}) "
                     f"MERGE (a)-[r:{rel} {{key: {json.dumps(key)}}}]->(b) SET r += {props};")
    return "\n".join(lines) + "\n"


def to_json(kg: KnowledgeGraph) -> str:
    data = json_graph.node_link_data(kg.graph)
    return json.dumps(data, default=lambda o: _clean(o) if not isinstance(o, (list, dict)) else str(o), indent=1)
