# Freyja supplement knowledge graph

Knowledge graph and reference engine for **step 2 of the pipeline** (choosing the formula): which ingredients
address each health need, which are unsafe for this animal, how much to give, whether it can be manufactured,
and which in-market products come closest.

Design rationale, schema diagram, content status and open questions: [docs/DESIGN.md](docs/DESIGN.md).

## Quick start

```bash
pip install pydantic pyyaml networkx pytest
python -m kg validate                       # schema + referential integrity + lints
python -m kg stats                          # counts by node / edge type and curation status
python -m kg formulate examples/pets.yaml   # run the engine on the synthetic pets
python -m kg formulate examples/pets.yaml --pet demo-miso --json
python -m kg export cypher build/kg.cypher  # Neo4j load script (or: export json build/kg.json)
python -m pytest -q tests
```

Sample engine output: [docs/example_output.txt](docs/example_output.txt).

## Web explorer

A React + TypeScript UI over a small FastAPI wrapper around the same engine (no logic is duplicated in TS).

```bash
pip install fastapi uvicorn
cd web && yarn install && yarn build    # one-time; FastAPI then serves web/dist
cd .. && python3 -m uvicorn server.app:app --port 8000
# open http://localhost:8000
```

For frontend development, run `yarn api` (API with auto-reload) and `yarn dev` (Vite on :5173, proxies /api) in
two terminals.

- **Overview**: a map of node types and relations (click a type for its nodes, or a relation for its table), headline
  counts, and the loader's data-gap warnings.
- **Explore**: search or filter any node; a radial neighbourhood graph grouped by relation (hover to highlight,
  double-click to refocus, "Expand neighbours" to grow it); an inspector with properties, every relation, and
  PubMed/DOI-linked sources for nodes and edges. URLs are deep links (`#/explore?focus=…&sel=…`).
- **Relations**: filterable tables for evidence, contraindications, interactions, toxicity, dose rules, safety
  limits, predispositions and conflicts.
- **Formulate**: edit a pet profile (or load a synthetic example) and the engine re-runs as you type. You see a
  decision graph (pet context → needs → ingredients → raw materials → dosage forms, with dashed safety reasons and
  greyed candidates that were not selected), the formula with calculation traces, vet flags, exclusions, the
  manufacturing plan, product matches, and every fact used, each linking back into the explorer.

The API reloads the graph whenever a file under `data/` changes. If an edit fails validation, the explorer keeps
the last good version and shows the problems on the Overview.

## Layout

```
kg/schema.py         Pydantic models for every node, edge and reified fact
kg/loader.py         YAML -> validated KnowledgeGraph + networkx graph; integrity checks and lints
kg/formulate.py      deterministic step-2 engine (candidates, safety, selection, dose, manufacture, products)
kg/export.py         Cypher / node-link JSON export
server/app.py        FastAPI: /api/graph, /api/meta, /api/examples, /api/formulate; serves web/dist
web/                 React + TypeScript + Cytoscape.js explorer (Vite, Yarn)
data/nodes/          species, breeds, life stages, conditions, needs, allergens, ingredients,
                     raw materials, dosage forms, medications, products
data/edges/          addresses, indicates, predispositions, toxicity, contraindications,
                     interactions, conflicts, dose_rules, safety_limits
data/sources/        citations (PubMed-checked), split by research area
research/            raw research notes with per-value verification tags (provenance for the YAML)
scripts/             importers used to seed edges from research notes
examples/pets.yaml   synthetic PetProfiles (not real patients)
```

## Status

All facts are `curation.status: draft`. Every edge cites a source, but none has had veterinary review yet.
Do not use this for real animals until it has. See "Content status" in the design note.
