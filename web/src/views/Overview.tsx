import type { ElementDefinition, LayoutOptions } from "cytoscape";
import { useMemo, useState } from "react";
import { CyGraph } from "../components/CyGraph";
import { Badge, Section, TypeDot } from "../components/ui";
import type { GraphIndex } from "../graphIndex";
import { REL_LABEL, SAFETY_RELS, TYPE_STYLE } from "../theme";
import type { Meta, NodeType } from "../types";

const LAYOUT: LayoutOptions = {
  name: "fcose",
  animate: false,
  nodeRepulsion: 30000,
  idealEdgeLength: 150,
  padding: 40,
} as LayoutOptions;

interface Props {
  index: GraphIndex;
  meta: Meta;
  onOpenNode: (id: string) => void;
  onOpenRelation: (rel: string) => void;
}

/** Type-level view: one node per node type, one edge per (type, relation, type) triple. */
export function Overview({ index, meta, onOpenNode, onOpenRelation }: Props) {
  const [picked, setPicked] = useState<string | null>("type:ingredient");

  const { elements, triples } = useMemo(() => {
    const triples = new Map<string, { rel: string; s: NodeType; t: NodeType; n: number }>();
    for (const e of index.edges.values()) {
      const s = index.type(e.source);
      const t = index.type(e.target);
      const key = `${s}|${e.rel}|${t}`;
      const cur = triples.get(key);
      if (cur) cur.n++;
      else triples.set(key, { rel: e.rel, s, t, n: 1 });
    }
    const els: ElementDefinition[] = [];
    for (const [t, list] of index.byType) {
      if (t === "source") continue;
      els.push({
        data: {
          id: `type:${t}`,
          label: `${TYPE_STYLE[t].label}\n${list.length}`,
          color: TYPE_STYLE[t].color,
          shape: TYPE_STYLE[t].shape,
          size: 22 + Math.sqrt(list.length) * 4,
        },
      });
    }
    for (const [key, x] of triples) {
      els.push({
        data: {
          id: `rel:${key}`,
          source: `type:${x.s}`,
          target: `type:${x.t}`,
          label: `${REL_LABEL[x.rel] ?? x.rel} (${x.n})`,
          color: SAFETY_RELS.has(x.rel) ? "#f97316" : x.rel === "ADDRESSES" ? "#10b981" : "#94a3b8",
          strong: SAFETY_RELS.has(x.rel) || x.rel === "ADDRESSES" || undefined,
          rel: x.rel,
        },
      });
    }
    return { elements: els, triples };
  }, [index]);

  const pickedType = picked?.startsWith("type:") ? (picked.slice(5) as NodeType) : null;
  const pickedTriple = picked?.startsWith("rel:") ? triples.get(picked.slice(4)) : null;
  const totalFacts = Object.values(meta.relation_counts).reduce((a, b) => a + b, 0);

  return (
    <div className="overview">
      <div className="stats">
        <Stat label="Nodes" value={Object.entries(meta.node_counts).filter(([k]) => k !== "source").reduce((a, [, v]) => a + v, 0)} />
        <Stat label="Facts (edges + dose rules + limits)" value={totalFacts} />
        <Stat label="Sources" value={meta.node_counts.source ?? 0} />
        <Stat
          label="Curation"
          value={Object.entries(meta.curation)
            .map(([k, v]) => `${v} ${k}`)
            .join(" · ")}
          tone={meta.curation.vet_approved ? undefined : "warn"}
        />
        <Stat label="KG version" value={meta.version} mono />
      </div>

      {meta.reload_problems.length > 0 && (
        <div className="notice bad">
          <strong>Latest YAML edit failed validation; serving the previous version.</strong>
          <ul>
            {meta.reload_problems.slice(0, 8).map((p) => (
              <li key={p} className="mono small">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overview-grid">
        <div className="card schema-card">
          <div className="card-title">
            Schema map <span className="muted small">— node types and the relations between them (click to inspect)</span>
          </div>
          <CyGraph
            elements={elements}
            layout={LAYOUT}
            selected={picked}
            onSelect={(id) => setPicked(id)}
            className="cy cy-schema"
          />
        </div>

        <div className="card side-card">
          {pickedType && (
            <Section title={TYPE_STYLE[pickedType].label} count={index.byType.get(pickedType)?.length}>
              <div className="node-grid">
                {(index.byType.get(pickedType) ?? []).map((n) => (
                  <button key={n.id} className="result" onClick={() => onOpenNode(n.id)}>
                    <TypeDot type={n.type} />
                    <span className="result-name">{n.name}</span>
                    {n.props.kind === "hazard" && <Badge tone="bad">hazard</Badge>}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {pickedTriple && (
            <Section title={`${TYPE_STYLE[pickedTriple.s].label} → ${REL_LABEL[pickedTriple.rel] ?? pickedTriple.rel} → ${TYPE_STYLE[pickedTriple.t].label}`} count={pickedTriple.n}>
              <p className="muted">{REL_HELP[pickedTriple.rel] ?? ""}</p>
              <button className="btn" onClick={() => onOpenRelation(pickedTriple.rel)}>
                Open {REL_LABEL[pickedTriple.rel] ?? pickedTriple.rel} table
              </button>
            </Section>
          )}
          <Section title="Data gaps" count={meta.warnings.length}>
            <p className="muted small">Lints from the loader: evidence exists but no dose rule or raw material does, so the engine cannot use it.</p>
            <ul className="warnings">
              {meta.warnings.map((w) => (
                <li key={w}>{w.replace(/ingredient:|need:|species:/g, "")}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, mono }: { label: string; value: string | number; tone?: "warn"; mono?: boolean }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className={`stat-value ${mono ? "mono" : ""}`}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export const REL_HELP: Record<string, string> = {
  ADDRESSES: "Ingredient helps a health need in one species, with an evidence grade (A–D, NEG = evidence of no benefit).",
  INDICATES: "A diagnosed condition implies a health need (used by the step-1 rules).",
  PREDISPOSED_TO: "Breed risk. Some safety rules fire on predisposition alone (copper, purines).",
  TOXIC_TO: "Species hazard: exclude, vet review, or keep under a dose cap.",
  CONTRAINDICATED_IN: "Unsafe or cautioned in a condition or life stage.",
  INTERACTS_WITH: "Drug–supplement interaction at drug-class level.",
  CONFLICTS_WITH: "Ingredient pair that should not be blended or co-dosed.",
  FOR_INGREDIENT: "Dose rule or safety limit for an ingredient.",
  FOR_SPECIES: "Dose rule or safety limit for a species.",
  FOR_NEED: "Need-specific dose rule.",
  PROVIDES: "Raw material delivers an ingredient at a potency.",
  DERIVED_FROM: "Raw material allergen source.",
  COMPATIBLE_WITH: "Raw material can be made into this dosage form.",
  CONTAINS: "Product contains an ingredient (amount per unit).",
  HAS_INACTIVE: "Product inactive ingredient or allergen worth screening.",
  IN_FORM: "Product dosage form.",
  CLAIMS: "Health need the product is marketed for.",
};
