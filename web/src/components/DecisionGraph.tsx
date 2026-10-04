import type { ElementDefinition, LayoutOptions, StylesheetJson } from "cytoscape";
import { useMemo } from "react";
import type { GraphIndex } from "../graphIndex";
import { TYPE_STYLE, prefersDark } from "../theme";
import type { Formula, PetProfile } from "../types";
import { CyGraph } from "./CyGraph";
import { fmtNum } from "./ui";

export type IngredientStatus = "chosen" | "flagged" | "excluded" | "negative" | "candidate";

export const STATUS_LABEL: Record<IngredientStatus, string> = {
  chosen: "in formula",
  flagged: "in formula, flagged",
  excluded: "excluded (safety)",
  negative: "not recommended (no benefit)",
  candidate: "eligible, not selected",
};

const STATUS_COLOR: Record<IngredientStatus, string> = {
  chosen: "#0ea5e9",
  flagged: "#f59e0b",
  excluded: "#dc2626",
  negative: "#94a3b8",
  candidate: "#64748b",
};

const GRADE_W: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, NEG: 0 };
const COL_X = [0, 260, 540, 820, 1080];
const ROW_H = 46;

interface Props {
  index: GraphIndex;
  pet: PetProfile;
  formula: Formula;
  minGrade: string;
  showCandidates: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** Ingredient id -> status, shared with the results panel. */
export function ingredientStatuses(index: GraphIndex, pet: PetProfile, f: Formula, minGrade: string) {
  const status = new Map<string, IngredientStatus>();
  const flagged = new Set(f.flags.map((x) => x.ingredient).filter(Boolean) as string[]);
  for (const l of f.lines) status.set(l.ingredient, flagged.has(l.ingredient) ? "flagged" : "chosen");
  for (const e of f.excluded) status.set(e.ingredient, "excluded");
  for (const n of f.not_recommended) {
    const ing = n.edge.split("|")[1];
    if (!status.has(ing)) status.set(ing, "negative");
  }
  const needs = new Set(pet.needs.map((n) => n.need));
  for (const e of index.byRel.get("ADDRESSES") ?? []) {
    if (e.props.species === pet.species && needs.has(e.target) && GRADE_W[e.props.grade] >= GRADE_W[minGrade] && !status.has(e.source))
      status.set(e.source, "candidate");
  }
  return status;
}

export function DecisionGraph({ index, pet, formula: f, minGrade, showCandidates, selected, onSelect }: Props) {
  const elements = useMemo(() => {
    const els: ElementDefinition[] = [];
    const status = ingredientStatuses(index, pet, f, minGrade);
    const lineBy = new Map(f.lines.map((l) => [l.ingredient, l]));
    const covered = new Set(f.lines.flatMap((l) => l.needs));
    const needs = [...pet.needs].sort((a, b) => a.priority - b.priority);
    const needSet = new Set(needs.map((n) => n.need));

    const column = (col: number, items: { id: string; label: string; color: string; cls?: string; data?: object }[]) => {
      const top = -((items.length - 1) * ROW_H) / 2;
      items.forEach((it, i) =>
        els.push({
          data: { id: it.id, label: it.label, color: it.color, ...it.data },
          position: { x: COL_X[col], y: top + i * ROW_H },
          classes: it.cls,
        }),
      );
    };

    // column 0: pet context
    const ctx = [
      pet.species,
      ...(pet.breed ? [pet.breed] : []),
      ...(f.life_stage ? [f.life_stage] : []),
      ...pet.conditions,
      ...pet.medications,
      ...pet.allergens,
    ];
    column(
      0,
      ctx.map((id) => ({ id: `ctx|${id}`, label: index.name(id), color: TYPE_STYLE[index.type(id)]?.color ?? "#999", cls: "ctx", data: { ref: id } })),
    );

    // column 1: needs
    column(
      1,
      needs.map((n) => ({
        id: `need|${n.need}`,
        label: `P${n.priority} · ${index.name(n.need)}`,
        color: covered.has(n.need) ? TYPE_STYLE.need.color : "#dc2626",
        cls: covered.has(n.need) ? "need" : "need unmet",
        data: { ref: n.need },
      })),
    );

    // column 2: ingredients, ordered by status
    const order: IngredientStatus[] = ["chosen", "flagged", "excluded", "negative", "candidate"];
    const ings = [...status.entries()]
      .filter(([, s]) => showCandidates || s !== "candidate")
      .sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || index.name(a[0]).localeCompare(index.name(b[0])));
    column(
      2,
      ings.map(([id, s]) => {
        const l = lineBy.get(id);
        return {
          id: `ing|${id}`,
          label: l ? `${index.name(id)}\n${fmtNum(l.dose)} ${l.unit}/day` : index.name(id),
          color: STATUS_COLOR[s],
          cls: `ing ${s}`,
          data: { ref: id },
        };
      }),
    );
    const shown = new Set(ings.map(([id]) => id));

    // column 3: raw materials, column 4: forms
    column(
      3,
      f.lines.map((l) => ({
        id: `rm|${l.raw_material}`,
        label: `${index.name(l.raw_material)}\n${fmtNum(l.raw_mass_mg)} mg`,
        color: TYPE_STYLE.rm.color,
        cls: "rm",
        data: { ref: l.raw_material },
      })),
    );
    column(
      4,
      f.manufacturing.components.map((c) => ({
        id: `form|${c.form}`,
        label: `${index.name(c.form)}\n${c.units_per_day} × ${c.unit_mass_g} g`,
        color: TYPE_STYLE.form.color,
        cls: "form",
        data: { ref: c.form },
      })),
    );

    const edge = (s: string, t: string, color: string, label = "", cls = "") =>
      els.push({ data: { id: `${s}->${t}`, source: s, target: t, color, label }, classes: cls });

    // need -> ingredient (evidence)
    for (const e of index.byRel.get("ADDRESSES") ?? []) {
      if (e.props.species !== pet.species || !needSet.has(e.target) || !shown.has(e.source)) continue;
      const s = status.get(e.source)!;
      const used = lineBy.get(e.source)?.needs.includes(e.target);
      edge(`need|${e.target}`, `ing|${e.source}`, used ? "#10b981" : s === "negative" ? "#94a3b8" : "#cbd5e1", e.props.grade, used ? "used" : "unused");
    }
    // context -> ingredient (safety reasons)
    const reasonEdges = (ing: string, facts: { edge: string; kind: string }[], color: string, cls: string) => {
      for (const fact of facts) {
        const parts = fact.edge.split("|");
        const target = fact.kind === "CONFLICTS_WITH" ? null : parts[2];
        if (target && ctx.includes(target)) edge(`ctx|${target}`, `ing|${ing}`, color, fact.kind === "INTERACTS_WITH" ? "interaction" : "", cls);
        else if (target?.startsWith("condition:") && f.predispositions.includes(target) && pet.breed)
          edge(`ctx|${pet.breed}`, `ing|${ing}`, color, "predisposition", cls);
      }
    };
    for (const x of f.excluded) {
      if (!shown.has(x.ingredient)) continue;
      reasonEdges(x.ingredient, x.facts, "#dc2626", "reason");
      for (const a of x.reason.match(/allergen:[a-z_]+/g) ?? [])
        if (ctx.includes(a)) edge(`ctx|${a}`, `ing|${x.ingredient}`, "#dc2626", "allergen", "reason");
    }
    for (const fl of f.flags) if (fl.ingredient) reasonEdges(fl.ingredient, fl.facts, "#f59e0b", "reason");
    // ingredient -> raw material -> form
    for (const l of f.lines) {
      edge(`ing|${l.ingredient}`, `rm|${l.raw_material}`, "#f97316");
      if (l.component) edge(`rm|${l.raw_material}`, `form|${l.component}`, "#ca8a04");
    }
    // column titles above the tallest column
    const tallest = Math.max(ctx.length, needs.length, ings.length, f.lines.length, 1);
    const titleY = -((tallest - 1) * ROW_H) / 2 - 44;
    ["Pet context", "Health needs", "Ingredients", "Raw materials", "Dosage forms"].forEach((t, i) =>
      els.push({ data: { id: `title|${i}`, label: t }, position: { x: COL_X[i], y: titleY }, classes: "col-title", selectable: false, grabbable: false }),
    );
    return { els, rows: tallest };
  }, [index, pet, f, minGrade, showCandidates]);

  return (
    <CyGraph
      elements={elements.els}
      style={{ height: Math.min(1100, Math.max(360, elements.rows * ROW_H + 110)) }}
      maxFitZoom={1.1}
      layout={PRESET}
      extraStyle={decisionStyle()}
      selected={selected}
      onSelect={(id, isEdge) => !isEdge && onSelect(id)}
      onBackground={() => onSelect(null)}
      className="cy cy-decision"
      minZoom={0.15}
    />
  );
}

const PRESET: LayoutOptions = { name: "preset", fit: true, padding: 24 };

function decisionStyle(): StylesheetJson {
  const dark = prefersDark();
  return [
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: 190,
        height: 34,
        "background-color": "data(color)",
        "background-opacity": dark ? 0.22 : 0.12,
        "border-width": 1.5,
        "border-color": "data(color)",
        "text-valign": "center",
        "text-halign": "center",
        "text-max-width": "176px",
        "text-margin-y": 0,
        "font-size": 11,
        "text-outline-width": 0,
      },
    },
    { selector: "node.chosen, node.flagged", style: { "border-width": 2.5, "font-weight": 600 } },
    { selector: "node.excluded", style: { "border-style": "dashed" } },
    { selector: "node.negative, node.candidate", style: { opacity: 0.7 } },
    { selector: "node.unmet", style: { "border-style": "dashed", "border-width": 2.5 } },
    { selector: "edge", style: { "curve-style": "unbundled-bezier", "control-point-distances": [0] as any, width: 1.2, "font-size": 8, "arrow-scale": 0.6 } },
    { selector: "edge.used", style: { width: 2.4 } },
    { selector: "edge.unused", style: { opacity: 0.55 } },
    { selector: "edge.reason", style: { "curve-style": "bezier", "line-style": "dashed", width: 1.8 } },
    {
      selector: "node.col-title",
      style: { "background-opacity": 0, "border-width": 0, "font-size": 12, "font-weight": 700, color: dark ? "#94a3b8" : "#475569", events: "no" } as any,
    },
  ];
}
