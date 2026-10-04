import { useMemo } from "react";
import type { GraphIndex } from "../graphIndex";
import { REL_LABEL, edgeBadge } from "../theme";
import type { KGEdge } from "../types";
import { Badge, Curation, NodeLink, PropTable, SourceList, TypeChip, toneFor } from "./ui";

interface Props {
  index: GraphIndex;
  id: string;
  onOpen: (id: string) => void;
  onSelect: (id: string | null) => void;
  onExpand?: (id: string) => void;
  isExpanded?: (id: string) => boolean;
}

const TEXT_FIELDS = ["effect", "mechanism", "caveats", "rationale", "signs", "notes"];
const BADGE_FIELDS = ["grade", "severity", "action", "strength", "kind", "priority", "evidence_strength"];

/** Details for whatever is selected: a node, an edge, or a fact node (dose rule / limit / source). */
export function Inspector(props: Props) {
  const { index, id } = props;
  if (index.edges.has(id)) return <EdgeDetail {...props} edge={index.edges.get(id)!} />;
  if (index.nodes.has(id)) return <NodeDetail {...props} />;
  return <div className="empty">Nothing selected</div>;
}

function EdgeDetail({ index, edge, onOpen }: Props & { edge: KGEdge }) {
  const p = edge.props;
  const rest = Object.fromEntries(
    Object.entries(p).filter(([k]) => !TEXT_FIELDS.includes(k) && !BADGE_FIELDS.includes(k) && !["about", "species"].includes(k)),
  );
  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="rel-chip">{REL_LABEL[edge.rel] ?? edge.rel}</span>
        <h2 className="edge-title">
          <NodeLink id={edge.source} index={index} onOpen={onOpen} />
          <span className="arrow">→</span>
          <NodeLink id={edge.target} index={index} onOpen={onOpen} />
        </h2>
        <div className="badges">
          {p.species && <Badge>{Array.isArray(p.species) ? p.species.map(stripPrefix).join(" + ") : stripPrefix(p.species)}</Badge>}
          {BADGE_FIELDS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => (
            <Badge key={k} tone={toneFor(String(p[k]))}>
              {k === "evidence_strength" ? `evidence: ${p[k]}` : k === "priority" ? `priority ${p[k]}` : String(p[k])}
            </Badge>
          ))}
        </div>
      </div>
      {TEXT_FIELDS.filter((k) => p[k]).map((k) => (
        <div key={k} className="text-field">
          <div className="label">{k}</div>
          <p>{String(p[k])}</p>
        </div>
      ))}
      <PropTable props={rest} index={index} onOpen={onOpen} />
      {p.curation && (
        <>
          <div className="label">Curation</div>
          <Curation c={p.curation} />
        </>
      )}
      {p.sources?.length > 0 && (
        <>
          <div className="label">Sources ({p.sources.length})</div>
          <SourceList ids={p.sources} index={index} />
        </>
      )}
      <div className="mono muted small edge-id">{edge.id}</div>
    </div>
  );
}

function NodeDetail({ index, id, onOpen, onSelect, onExpand, isExpanded }: Props) {
  const node = index.nodes.get(id)!;
  const p = node.props;
  const groups = useMemo(() => {
    const g = new Map<string, { label: string; edges: KGEdge[]; dir: "out" | "in" }>();
    for (const e of index.out.get(id) ?? []) add(g, `out:${e.rel}`, REL_LABEL[e.rel] ?? e.rel, e, "out");
    for (const e of index.in.get(id) ?? []) add(g, `in:${e.rel}`, inverseLabel(e.rel, index.type(e.source)), e, "in");
    return [...g.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [index, id]);
  const citedBy = node.type === "source" ? index.citedBy.get(id) ?? [] : [];

  return (
    <div className="inspector">
      <div className="insp-head">
        <TypeChip type={node.type} />
        {p.kind && <Badge tone={p.kind === "hazard" ? "bad" : p.kind === "excipient" ? "warn" : "info"}>{p.kind}</Badge>}
        {p.regulatory_status && p.regulatory_status !== "permitted" && <Badge tone="bad">{p.regulatory_status}</Badge>}
        {p.verification && <Badge tone={toneFor(p.verification)}>{p.verification}</Badge>}
        <h2>{node.name}</h2>
        <div className="mono muted small">{id}</div>
        {p.aliases?.length > 0 && <div className="muted small">aka {p.aliases.join(", ")}</div>}
        <div className="insp-actions">
          {onExpand && node.type !== "source" && !isExpanded?.(id) && (
            <button className="btn small" onClick={() => onExpand(id)}>
              Expand neighbours
            </button>
          )}
          <button className="btn small ghost" onClick={() => onOpen(id)}>
            Focus
          </button>
        </div>
      </div>
      {p.description && <p className="desc">{p.description}</p>}
      {node.type === "source" ? (
        <>
          <p className="desc">{p.citation}</p>
          <PropTable props={{ type: p.type, year: p.year, pmid: p.pmid, doi: p.doi, url: p.url, notes: p.notes }} index={index} onOpen={onOpen} />
          <div className="label">Cited by ({citedBy.length})</div>
          <ul className="rel-rows">
            {citedBy.map((fid) => {
              const e = index.edges.get(fid);
              return (
                <li key={fid}>
                  <button className="rel-row" onClick={() => (e ? onSelect(fid) : onOpen(fid))}>
                    {e ? (
                      <>
                        <span className="rel-small">{REL_LABEL[e.rel] ?? e.rel}</span> {index.name(e.source)} → {index.name(e.target)}
                      </>
                    ) : (
                      index.name(fid)
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <PropTable props={p} index={index} onOpen={onOpen} />
          {p.curation && <Curation c={p.curation} />}
          {p.sources?.length > 0 && (
            <>
              <div className="label">Sources ({p.sources.length})</div>
              <SourceList ids={p.sources} index={index} />
            </>
          )}
        </>
      )}
      {groups.map((g) => (
        <div key={g.label + g.dir} className="rel-group">
          <div className="label">
            {g.label} <span className="count">{g.edges.length}</span>
          </div>
          <ul className="rel-rows">
            {g.edges.map((e) => {
              const other = g.dir === "out" ? e.target : e.source;
              const badge = edgeBadge(e.rel, e.props);
              return (
                <li key={e.id}>
                  <button className="rel-row" onClick={() => onSelect(e.id)} onDoubleClick={() => onOpen(other)} title="click: inspect edge · double-click: focus node">
                    <span className="rel-other">{index.name(other)}</span>
                    {badge && <Badge tone={toneFor(e.props.grade ?? e.props.action ?? e.props.strength)}>{badge}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function add(g: Map<string, any>, key: string, label: string, e: KGEdge, dir: "out" | "in") {
  if (!g.has(key)) g.set(key, { label, edges: [], dir });
  g.get(key).edges.push(e);
}

function inverseLabel(rel: string, fromType: string): string {
  switch (rel) {
    case "ADDRESSES":
      return "addressed by";
    case "FOR_INGREDIENT":
    case "FOR_SPECIES":
    case "FOR_NEED":
      return fromType === "limit" ? "safety limits" : "dose rules";
    case "PROVIDES":
      return "provided by (raw materials)";
    case "CONTAINS":
      return "contained in (products)";
    case "HAS_INACTIVE":
      return "inactive in (products)";
    case "TOXIC_TO":
      return "toxic ingredients";
    case "CONTRAINDICATED_IN":
      return "contraindicated ingredients";
    case "INTERACTS_WITH":
      return "interacting ingredients";
    case "PREDISPOSED_TO":
      return "predisposed breeds";
    case "INDICATES":
      return "indicated by";
    case "COMPATIBLE_WITH":
      return "compatible raw materials";
    case "IN_FORM":
      return "products in this form";
    case "CLAIMS":
      return "claimed by (products)";
    case "DERIVED_FROM":
      return "raw materials derived from";
    case "OF_SPECIES":
      return fromType === "breed" ? "breeds" : "life stages";
    case "SUBTYPE_OF":
      return "sub-needs";
    case "CONFLICTS_WITH":
      return "conflicts with";
    default:
      return `← ${REL_LABEL[rel] ?? rel}`;
  }
}

function stripPrefix(s: string) {
  return s.includes(":") ? s.split(":")[1] : s;
}
