"""Load the YAML knowledge base, validate it, and build a graph.

Layout::

    data/sources/*.yaml               citations, split by topic
    data/nodes/<node type>.yaml      one list of nodes per file
    data/edges/<relation>.yaml       one list of edges / reified facts per file

Validation has three layers:
  1. Pydantic: field types, enums, value ranges, per-record consistency.
  2. Referential integrity: every endpoint and every source id exists and has
     the right node type (e.g. Addresses.need must be a ``need:*``).
  3. Domain lints: things that are legal but probably a curation mistake
     (an active with no dose rule, a hazard with an ADDRESSES edge, ...).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import networkx as nx
import yaml

from . import schema as S

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# prefix -> (model, file name under data/nodes)
NODE_TYPES: dict[str, tuple[type[S.Node], str]] = {
    "species": (S.Species, "species.yaml"),
    "lifestage": (S.LifeStage, "life_stages.yaml"),
    "breed": (S.Breed, "breeds.yaml"),
    "condition": (S.Condition, "conditions.yaml"),
    "need": (S.HealthNeed, "health_needs.yaml"),
    "allergen": (S.Allergen, "allergens.yaml"),
    "ingredient": (S.Ingredient, "ingredients.yaml"),
    "med": (S.Medication, "medications.yaml"),
    "form": (S.DosageForm, "dosage_forms.yaml"),
    "rm": (S.RawMaterial, "raw_materials.yaml"),
    "product": (S.Product, "products.yaml"),
}

# relation name -> (model, file, {field: allowed prefixes}, graph edge (src_field, dst_field) or None)
EDGE_TYPES: dict[str, tuple[type[S.BaseModel], str, dict[str, tuple[str, ...]], tuple[str, str] | None]] = {
    "ADDRESSES": (S.Addresses, "addresses.yaml",
                  {"ingredient": ("ingredient",), "need": ("need",), "species": ("species",)},
                  ("ingredient", "need")),
    "INDICATES": (S.Indicates, "indicates.yaml",
                  {"condition": ("condition",), "need": ("need",)}, ("condition", "need")),
    "PREDISPOSED_TO": (S.PredisposedTo, "predispositions.yaml",
                       {"breed": ("breed",), "condition": ("condition",)}, ("breed", "condition")),
    "TOXIC_TO": (S.ToxicTo, "toxicity.yaml",
                 {"ingredient": ("ingredient",), "species": ("species",)}, ("ingredient", "species")),
    "CONTRAINDICATED_IN": (S.ContraindicatedIn, "contraindications.yaml",
                           {"ingredient": ("ingredient",), "target": ("condition", "lifestage")},
                           ("ingredient", "target")),
    "INTERACTS_WITH": (S.InteractsWith, "interactions.yaml",
                       {"ingredient": ("ingredient",), "medication": ("med",)}, ("ingredient", "medication")),
    "CONFLICTS_WITH": (S.ConflictsWith, "conflicts.yaml",
                       {"a": ("ingredient",), "b": ("ingredient",)}, ("a", "b")),
    "DOSE_RULE": (S.DoseRule, "dose_rules.yaml",
                  {"ingredient": ("ingredient",), "species": ("species",), "need": ("need",)}, None),
    "SAFETY_LIMIT": (S.SafetyLimit, "safety_limits.yaml",
                     {"ingredient": ("ingredient",), "species": ("species",)}, None),
}


class KGValidationError(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__(f"{len(problems)} problem(s):\n  - " + "\n  - ".join(problems))


@dataclass
class KnowledgeGraph:
    nodes: dict[str, S.Node] = field(default_factory=dict)
    sources: dict[str, S.Source] = field(default_factory=dict)
    edges: dict[str, list] = field(default_factory=dict)  # relation -> list of models
    version: str = ""
    warnings: list[str] = field(default_factory=list)
    graph: nx.MultiDiGraph = field(default_factory=nx.MultiDiGraph)

    # ---- convenience accessors -------------------------------------------------
    def of_type(self, prefix: str) -> list[S.Node]:
        return [n for i, n in self.nodes.items() if i.startswith(prefix + ":")]

    def rel(self, name: str) -> list:
        return self.edges.get(name, [])

    def node(self, node_id: str) -> S.Node:
        return self.nodes[node_id]


def _read_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text()) or []
    if not isinstance(data, list):
        raise KGValidationError([f"{path}: top level must be a list"])
    return data


def _prefix(node_id: str) -> str:
    return node_id.split(":", 1)[0]


def edge_id(rel: str, e) -> str:
    """Stable id used by the engine trace and the explanation step."""
    if hasattr(e, "id"):
        return e.id
    ends = EDGE_TYPES[rel][3]
    parts = [getattr(e, ends[0]), getattr(e, ends[1])]
    sp = getattr(e, "species", None)
    if isinstance(sp, str):
        parts.append(sp)
    elif isinstance(sp, list) and len(sp) == 1:
        parts.append(sp[0])
    return f"{rel}|" + "|".join(parts)


def load(data_dir: Path | str = DATA_DIR, strict_lints: bool = False) -> KnowledgeGraph:
    data_dir = Path(data_dir)
    kg = KnowledgeGraph()
    problems: list[str] = []
    digest = hashlib.sha256()

    def parse(model, raw: dict, where: str):
        try:
            return model.model_validate(raw)
        except Exception as exc:  # pydantic.ValidationError
            problems.append(f"{where}: {exc}".replace("\n", " "))
            return None

    # ---- sources --------------------------------------------------------------
    for src_path in sorted((data_dir / "sources").glob("*.yaml")):
        digest.update(src_path.read_bytes())
        for i, raw in enumerate(_read_list(src_path)):
            src = parse(S.Source, raw, f"sources/{src_path.name}[{i}]")
            if src is None:
                continue
            if not src.id.startswith("source:"):
                problems.append(f"sources/{src_path.name}: id {src.id!r} must start with 'source:'")
            if src.id in kg.sources:
                problems.append(f"duplicate source id {src.id}")
            kg.sources[src.id] = src

    # ---- nodes ----------------------------------------------------------------
    for prefix, (model, fname) in NODE_TYPES.items():
        path = data_dir / "nodes" / fname
        digest.update(path.read_bytes() if path.exists() else b"")
        for i, raw in enumerate(_read_list(path)):
            node = parse(model, raw, f"nodes/{fname}[{i}]")
            if node is None:
                continue
            if _prefix(node.id) != prefix:
                problems.append(f"nodes/{fname}: id {node.id!r} must start with '{prefix}:'")
            if node.id in kg.nodes:
                problems.append(f"duplicate node id {node.id}")
            kg.nodes[node.id] = node

    # ---- edges ----------------------------------------------------------------
    for rel, (model, fname, endpoint_spec, _) in EDGE_TYPES.items():
        path = data_dir / "edges" / fname
        digest.update(path.read_bytes() if path.exists() else b"")
        kg.edges[rel] = []
        for i, raw in enumerate(_read_list(path)):
            e = parse(model, raw, f"edges/{fname}[{i}]")
            if e is not None:
                kg.edges[rel].append(e)

    kg.version = digest.hexdigest()[:12]

    # ---- referential integrity ------------------------------------------------
    def check_ref(ref: str | None, allowed: Iterable[str], where: str):
        if ref is None:
            return
        if _prefix(ref) not in allowed:
            problems.append(f"{where}: {ref!r} should be one of {sorted(allowed)}")
        elif ref not in kg.nodes:
            problems.append(f"{where}: unknown node {ref!r}")

    def check_sources(ids: list[str], where: str, required: bool):
        if required and not ids:
            problems.append(f"{where}: no sources cited")
        for s in ids:
            if s not in kg.sources:
                problems.append(f"{where}: unknown source {s!r}")

    for rel, (_, fname, endpoint_spec, _) in EDGE_TYPES.items():
        seen: set[str] = set()
        for e in kg.edges[rel]:
            eid = edge_id(rel, e)
            where = f"edges/{fname} {eid}"
            if eid in seen:
                problems.append(f"{where}: duplicate edge")
            seen.add(eid)
            for fld, allowed in endpoint_spec.items():
                check_ref(getattr(e, fld), allowed, where)
            check_sources(e.sources, where, required=True)

    for nid, n in kg.nodes.items():
        for fld in ("parent",):
            ref = getattr(n, fld, None)
            if ref:
                check_ref(ref, ("need",), nid)
        if isinstance(n, (S.Ingredient, S.DosageForm, S.LifeStage, S.RawMaterial)):
            check_sources(n.sources, nid, required=False)
        if isinstance(n, S.RawMaterial):
            for p in n.provides:
                check_ref(p.ingredient, ("ingredient",), f"{nid}.provides")
            for a in n.derived_from:
                check_ref(a, ("allergen",), f"{nid}.derived_from")
            for f in n.compatible_forms:
                check_ref(f.form, ("form",), f"{nid}.compatible_forms")
        if isinstance(n, S.Product):
            check_ref(n.form, ("form",), f"{nid}.form")
            for c in n.actives:
                check_ref(c.ingredient, ("ingredient",), f"{nid}.actives")
            for x in n.inactives_of_note:
                check_ref(x, ("ingredient", "allergen"), f"{nid}.inactives_of_note")
            for c in n.claims:
                check_ref(c, ("need",), f"{nid}.claims")

    if problems:
        raise KGValidationError(problems)

    # ---- domain lints (warnings) ---------------------------------------------
    kg.warnings = _lint(kg)
    if strict_lints and kg.warnings:
        raise KGValidationError(kg.warnings)

    kg.graph = _build_graph(kg)
    return kg


def _lint(kg: KnowledgeGraph) -> list[str]:
    w: list[str] = []
    ingredients = {n.id: n for n in kg.of_type("ingredient")}
    dosed = {(r.ingredient, r.species) for r in kg.rel("DOSE_RULE")}
    provided = {p.ingredient for rm in kg.of_type("rm") for p in rm.provides}
    for a in kg.rel("ADDRESSES"):
        ing = ingredients[a.ingredient]
        if ing.kind == S.IngredientKind.hazard.value:
            w.append(f"hazard {a.ingredient} has an ADDRESSES edge")
        if a.grade in ("A", "B", "C") and (a.ingredient, a.species) not in dosed:
            w.append(f"{a.ingredient} addresses {a.need} in {a.species} but has no dose rule")
        if a.grade in ("A", "B", "C") and a.ingredient not in provided:
            w.append(f"{a.ingredient} addresses {a.need} but no raw material provides it")
    for r in kg.rel("DOSE_RULE"):
        if r.unit != ingredients[r.ingredient].dose_unit:
            w.append(f"{r.id}: unit {r.unit} differs from ingredient dose_unit {ingredients[r.ingredient].dose_unit}")
    for s in kg.rel("SAFETY_LIMIT"):
        if s.unit != ingredients[s.ingredient].dose_unit:
            w.append(f"{s.id}: unit {s.unit} differs from ingredient dose_unit")
    return w


def _build_graph(kg: KnowledgeGraph) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph(version=kg.version)
    for nid, n in kg.nodes.items():
        g.add_node(nid, label=type(n).__name__, **{k: v for k, v in n.model_dump().items() if k != "id"})
    for sid, s in kg.sources.items():
        g.add_node(sid, label="Source", **s.model_dump(exclude={"id"}))

    for rel, (_, _, _, ends) in EDGE_TYPES.items():
        for e in kg.rel(rel):
            props = e.model_dump()
            eid = edge_id(rel, e)
            if ends:
                g.add_edge(getattr(e, ends[0]), getattr(e, ends[1]), key=eid, rel=rel, **props)
            else:  # reified fact -> its own node
                g.add_node(eid, label=rel.title().replace("_", ""), **props)
                g.add_edge(eid, e.ingredient, rel="FOR_INGREDIENT")
                g.add_edge(eid, e.species, rel="FOR_SPECIES")
                if getattr(e, "need", None):
                    g.add_edge(eid, e.need, rel="FOR_NEED")
            for s in e.sources:
                g.add_edge(eid if not ends else getattr(e, ends[0]), s, rel="CITES", about=eid)

    for rm in kg.of_type("rm"):
        for p in rm.provides:
            g.add_edge(rm.id, p.ingredient, rel="PROVIDES", **p.model_dump(exclude={"ingredient"}))
        for a in rm.derived_from:
            g.add_edge(rm.id, a, rel="DERIVED_FROM")
        for f in rm.compatible_forms:
            g.add_edge(rm.id, f.form, rel="COMPATIBLE_WITH", notes=f.notes)
    for p in kg.of_type("product"):
        g.add_edge(p.id, p.form, rel="IN_FORM")
        for c in p.actives:
            if c.ingredient:
                g.add_edge(p.id, c.ingredient, rel="CONTAINS", amount_per_unit=c.amount_per_unit, unit=c.unit)
        for x in p.inactives_of_note:
            g.add_edge(p.id, x, rel="HAS_INACTIVE")
        for c in p.claims:
            g.add_edge(p.id, c, rel="CLAIMS")
    for n in kg.of_type("breed"):
        g.add_edge(n.id, n.species, rel="OF_SPECIES")
    for n in kg.of_type("lifestage"):
        g.add_edge(n.id, n.species, rel="OF_SPECIES")
    for n in kg.of_type("need"):
        if n.parent:
            g.add_edge(n.id, n.parent, rel="SUBTYPE_OF")
    return g
