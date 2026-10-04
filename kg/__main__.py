"""Command line entry point.

    python -m kg validate                 # schema + integrity + lints
    python -m kg stats                    # counts by node / edge type
    python -m kg formulate examples/pets.yaml [--pet ID] [--json]
    python -m kg export cypher out.cypher # or: export json out.json
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import yaml

from .export import to_cypher, to_json
from .formulate import Engine, PetProfile
from .loader import KGValidationError, load


def _print_formula(f, kg) -> None:
    name = lambda i: kg.nodes[i].name if i in kg.nodes else i  # noqa: E731
    print(f"\n=== {f.pet_id}  (KG {f.kg_version}, life stage {f.life_stage}) ===")
    if f.predispositions:
        print("breed predispositions:", ", ".join(f.predispositions))
    print("\nFormula (per day):")
    def fmt(x: float) -> str:
        return f"{x:.2e}" if x >= 1e6 else f"{x:,.0f}" if x >= 100 else f"{x:.3g}"

    for l in f.lines:
        print(f"  - {name(l.ingredient):38s} {fmt(l.dose):>10s} {l.unit:<4s} via {l.raw_material} "
              f"({l.raw_mass_mg:,.0f} mg raw) -> {', '.join(l.needs)}")
        for c in l.calc:
            print(f"        {c}")
    if f.unmet_needs:
        print("\nUnmet needs:", ", ".join(f.unmet_needs))
    if f.not_recommended:
        print("\nNot recommended (negative evidence):")
        for x in f.not_recommended:
            print(f"  - {x.statement[:140]}")
    if f.excluded:
        print("\nExcluded:")
        for e in f.excluded:
            print(f"  - {name(e.ingredient)}: {e.reason}")
    if f.flags:
        print("\nFlags for vet review:")
        for fl in f.flags:
            print(f"  - [{fl.action}] {fl.message}")
    m = f.manufacturing
    print(f"\nManufacturing: {'feasible' if m.feasible else 'NOT feasible'}")
    for c in m.components:
        print(f"  - {c.form}: {c.units_per_day} x {c.unit_mass_g} g/day ({c.total_mass_g} g actives)")
    for i in m.issues:
        print(f"  ! {i}")
    if f.product_matches:
        print("\nClosest in-market products:")
        for p in f.product_matches:
            cov = ", ".join(f"{k.split(':')[1]} {v:.0%}" for k, v in p.covers.items())
            print(f"  - {p.score:.2f} {p.name} ({p.units_per_day:g}/day): {cov}")
            for w in p.warnings:
                print(f"        ! {w}")
    print(f"\n{len(f.facts_used)} KG facts used, {len(f.sources_used)} sources cited")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="kg")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    sub.add_parser("stats")
    fp = sub.add_parser("formulate")
    fp.add_argument("pets", type=Path)
    fp.add_argument("--pet")
    fp.add_argument("--json", action="store_true")
    ep = sub.add_parser("export")
    ep.add_argument("fmt", choices=["cypher", "json"])
    ep.add_argument("out", type=Path)
    args = ap.parse_args(argv)

    try:
        kg = load()
    except KGValidationError as e:
        print(e, file=sys.stderr)
        return 1

    if args.cmd == "validate":
        print(f"OK  version {kg.version}: {len(kg.nodes)} nodes, "
              f"{sum(len(v) for v in kg.edges.values())} edges/facts, {len(kg.sources)} sources")
        for w in kg.warnings:
            print("  warn:", w)
    elif args.cmd == "stats":
        c = collections.Counter(i.split(":")[0] for i in kg.nodes)
        for k, v in sorted(c.items()):
            print(f"node  {k:12s} {v}")
        for k, v in kg.edges.items():
            print(f"edge  {k:20s} {len(v)}")
        print(f"sources {len(kg.sources)}")
        status = collections.Counter(e.curation.status for v in kg.edges.values() for e in v)
        print("curation:", dict(status))
    elif args.cmd == "formulate":
        pets = [PetProfile.model_validate(p) for p in yaml.safe_load(args.pets.read_text())]
        eng = Engine(kg)
        for p in pets:
            if args.pet and p.pet_id != args.pet:
                continue
            f = eng.formulate(p)
            if args.json:
                print(json.dumps(f.model_dump(), indent=1, default=str))
            else:
                _print_formula(f, kg)
    elif args.cmd == "export":
        args.out.write_text(to_cypher(kg) if args.fmt == "cypher" else to_json(kg))
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
