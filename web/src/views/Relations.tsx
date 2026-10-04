import { useMemo, useState } from "react";
import { Badge, TypeDot, fmtNum, toneFor } from "../components/ui";
import type { GraphIndex } from "../graphIndex";
import { REL_LABEL, short } from "../theme";
import { REL_HELP } from "./Overview";

interface Column {
  key: string;
  label: string;
  get: (row: Row) => string | number | null | undefined;
  badge?: boolean;
  wide?: boolean;
}

interface Row {
  id: string; // edge id or fact node id
  from: string;
  to: string;
  props: Record<string, any>;
}

const p = (k: string) => (r: Row) => r.props[k];
const sp = (r: Row) => {
  const s = r.props.species;
  return Array.isArray(s) ? s.map(short).join("+") : short(s);
};

const COLUMNS: Record<string, Column[]> = {
  ADDRESSES: [
    { key: "species", label: "species", get: sp },
    { key: "grade", label: "grade", get: p("grade"), badge: true },
    { key: "effect", label: "effect", get: p("effect"), wide: true },
  ],
  CONTRAINDICATED_IN: [
    { key: "species", label: "species", get: sp },
    { key: "severity", label: "severity", get: p("severity"), badge: true },
    { key: "action", label: "action", get: p("action"), badge: true },
    { key: "evidence", label: "evidence", get: p("evidence_strength") },
    { key: "rationale", label: "rationale", get: p("rationale"), wide: true },
  ],
  INTERACTS_WITH: [
    { key: "severity", label: "severity", get: p("severity"), badge: true },
    { key: "action", label: "action", get: (r) => (r.props.action === "separate_dosing" ? `separate ${r.props.separate_hours}h` : r.props.action), badge: true },
    { key: "evidence", label: "evidence", get: p("evidence_strength") },
    { key: "mechanism", label: "mechanism", get: p("mechanism"), wide: true },
  ],
  TOXIC_TO: [
    { key: "species", label: "species", get: sp },
    { key: "action", label: "action", get: p("action"), badge: true },
    { key: "threshold", label: "threshold mg/kg", get: p("threshold_mg_per_kg") },
    { key: "signs", label: "signs", get: p("signs"), wide: true },
  ],
  PREDISPOSED_TO: [
    { key: "strength", label: "strength", get: p("strength"), badge: true },
    { key: "test", label: "genetic test", get: p("genetic_test") },
    { key: "notes", label: "evidence", get: (r) => r.props.curation?.notes, wide: true },
  ],
  INDICATES: [{ key: "priority", label: "priority", get: p("priority") }],
  CONFLICTS_WITH: [
    { key: "kind", label: "kind", get: p("kind") },
    { key: "action", label: "action", get: p("action"), badge: true },
    { key: "notes", label: "notes", get: p("notes"), wide: true },
  ],
  DOSE_RULE: [
    { key: "species", label: "species", get: sp },
    { key: "need", label: "need", get: (r) => short(r.props.need) || "(any)" },
    { key: "basis", label: "basis", get: p("basis") },
    { key: "min", label: "min", get: p("min") },
    { key: "target", label: "target", get: (r) => r.props.target ?? (r.props.bands?.length ? `${r.props.bands.length} bands` : null) },
    { key: "max", label: "max", get: p("max") },
    { key: "unit", label: "unit", get: p("unit") },
    { key: "notes", label: "curation notes", get: (r) => r.props.curation?.notes, wide: true },
  ],
  SAFETY_LIMIT: [
    { key: "species", label: "species", get: sp },
    { key: "kind", label: "kind", get: p("kind"), badge: true },
    { key: "basis", label: "basis", get: p("basis") },
    { key: "max", label: "max", get: p("max") },
    { key: "unit", label: "unit", get: p("unit") },
    { key: "notes", label: "notes", get: p("notes"), wide: true },
  ],
};

const RELATIONS = ["ADDRESSES", "CONTRAINDICATED_IN", "INTERACTS_WITH", "TOXIC_TO", "DOSE_RULE", "SAFETY_LIMIT", "PREDISPOSED_TO", "INDICATES", "CONFLICTS_WITH"];

interface Props {
  index: GraphIndex;
  rel: string;
  onRel: (rel: string) => void;
  onOpen: (focus: string, selected?: string) => void;
}

export function Relations({ index, rel, onRel, onOpen }: Props) {
  const [q, setQ] = useState("");
  const [facet, setFacet] = useState<Record<string, string>>({});
  const columns = COLUMNS[rel] ?? [];

  const rows: Row[] = useMemo(() => {
    if (rel === "DOSE_RULE" || rel === "SAFETY_LIMIT") {
      const t = rel === "DOSE_RULE" ? "dose" : "limit";
      return (index.byType.get(t) ?? []).map((n) => ({ id: n.id, from: n.props.ingredient, to: n.props.species, props: n.props }));
    }
    return (index.byRel.get(rel) ?? []).map((e) => ({ id: e.id, from: e.source, to: e.target, props: e.props }));
  }, [index, rel]);

  const facetCols = columns.filter((c) => c.badge || c.key === "species");
  const facetValues = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of facetCols) out[c.key] = [...new Set(rows.map((r) => String(c.get(r) ?? "")))].filter(Boolean).sort();
    return out;
  }, [rows, facetCols]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return rows
      .filter((r) => facetCols.every((c) => !facet[c.key] || String(c.get(r) ?? "") === facet[c.key]))
      .filter((r) => {
        if (!needle) return true;
        const hay = `${index.name(r.from)} ${index.name(r.to)} ${columns.map((c) => c.get(r) ?? "").join(" ")}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => index.name(a.from).localeCompare(index.name(b.from)));
  }, [rows, q, facet, facetCols, columns, index]);

  const fromLabel = rel === "PREDISPOSED_TO" ? "breed" : rel === "INDICATES" ? "condition" : "ingredient";
  const toLabel: Record<string, string> = {
    ADDRESSES: "need", CONTRAINDICATED_IN: "condition / life stage", INTERACTS_WITH: "medication", TOXIC_TO: "species",
    PREDISPOSED_TO: "condition", INDICATES: "need", CONFLICTS_WITH: "ingredient", DOSE_RULE: "", SAFETY_LIMIT: "",
  };

  return (
    <div className="relations">
      <div className="rel-tabs">
        {RELATIONS.map((r) => (
          <button key={r} className={`pill ${r === rel ? "on" : ""}`} onClick={() => { onRel(r); setFacet({}); }}>
            {REL_LABEL[r] ?? r.replace("_", " ").toLowerCase()}
            <span className="count">{r === "DOSE_RULE" ? index.byType.get("dose")?.length : r === "SAFETY_LIMIT" ? index.byType.get("limit")?.length : index.byRel.get(r)?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <p className="muted rel-help">{REL_HELP[rel] ?? (rel === "DOSE_RULE" ? "Daily amount per species and (optionally) per need. Need-specific rules win over general ones." : "Hard ceilings applied after dose rules.")}</p>
      <div className="table-tools">
        <input className="search" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} />
        {facetCols.map((c) => (
          <select key={c.key} value={facet[c.key] ?? ""} onChange={(e) => setFacet({ ...facet, [c.key]: e.target.value })}>
            <option value="">{c.label}: all</option>
            {facetValues[c.key]?.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ))}
        <span className="muted small">
          {filtered.length} of {rows.length}
        </span>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{fromLabel}</th>
              {toLabel[rel] && <th>{toLabel[rel]}</th>}
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>sources</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.from, r.id)} title="Open in explorer">
                <td className="nowrap">
                  <TypeDot type={index.type(r.from)} /> {index.name(r.from)}
                </td>
                {toLabel[rel] && (
                  <td className="nowrap">
                    <TypeDot type={index.type(r.to)} /> {index.name(r.to)}
                  </td>
                )}
                {columns.map((c) => {
                  const v = c.get(r);
                  return (
                    <td key={c.key} className={c.wide ? "wide" : "nowrap"}>
                      {v === null || v === undefined || v === "" ? (
                        <span className="muted">—</span>
                      ) : c.badge ? (
                        <Badge tone={toneFor(String(v))}>{String(v)}</Badge>
                      ) : typeof v === "number" ? (
                        <span className="mono">{fmtNum(v)}</span>
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
                <td className="mono muted">{r.props.sources?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
