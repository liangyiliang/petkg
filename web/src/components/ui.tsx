import { useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphIndex } from "../graphIndex";
import { sourceLink } from "../graphIndex";
import { TYPE_STYLE, short } from "../theme";
import type { NodeType } from "../types";

export function TypeDot({ type }: { type: NodeType }) {
  return <span className="dot" style={{ background: TYPE_STYLE[type]?.color ?? "#999" }} />;
}

export function TypeChip({ type }: { type: NodeType }) {
  const s = TYPE_STYLE[type];
  return (
    <span className="type-chip" style={{ color: s?.color, borderColor: s?.color }}>
      {s?.label ?? type}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "muted";

export function toneFor(value: string | undefined | null): Tone {
  switch (value) {
    case "A":
    case "B":
    case "strong":
    case "label_confirmed":
    case "vet_approved":
      return "good";
    case "C":
    case "moderate":
    case "monitor":
    case "relative":
    case "vet_review":
    case "reduce_dose":
    case "separate_dosing":
    case "dose_cap":
    case "retailer_listing":
    case "draft":
      return "warn";
    case "absolute":
    case "exclude":
    case "major":
    case "unverified":
      return "bad";
    case "NEG":
    case "D":
    case "reported":
      return "muted";
    default:
      return "neutral";
  }
}

export function NodeLink({ id, index, onOpen }: { id: string; index: GraphIndex; onOpen: (id: string) => void }) {
  const type = index.type(id);
  return (
    <button className="node-link" onClick={() => onOpen(id)} title={id}>
      <TypeDot type={type} />
      {index.name(id)}
    </button>
  );
}

export function SourceList({ ids, index }: { ids: string[]; index: GraphIndex }) {
  if (!ids?.length) return null;
  return (
    <ol className="sources">
      {ids.map((id) => {
        const s = index.nodes.get(id);
        const link = s ? sourceLink(s.props) : null;
        return (
          <li key={id}>
            <span className="source-type">{s?.props.type ?? "?"}</span>{" "}
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {s?.props.citation ?? id}
              </a>
            ) : (
              <span>{s?.props.citation ?? id}</span>
            )}
            {s?.props.pmid && <span className="mono muted"> PMID {s.props.pmid}</span>}
            {s?.props.notes && <div className="muted small">{s.props.notes}</div>}
          </li>
        );
      })}
    </ol>
  );
}

const HIDDEN_PROP_KEYS = new Set(["name", "sources", "curation", "id", "description", "aliases"]);

/** Generic property table: scalars inline, lists as chips, objects as compact JSON. */
export function PropTable({ props, index, onOpen }: { props: Record<string, any>; index: GraphIndex; onOpen: (id: string) => void }) {
  const rows = Object.entries(props).filter(
    ([k, v]) => !HIDDEN_PROP_KEYS.has(k) && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== "",
  );
  if (!rows.length) return null;
  return (
    <table className="props">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k.replace(/_/g, " ")}</th>
            <td>
              <PropValue value={v} index={index} onOpen={onOpen} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PropValue({ value, index, onOpen }: { value: any; index: GraphIndex; onOpen: (id: string) => void }): ReactNode {
  if (typeof value === "string") {
    if (index.nodes.has(value) && !value.startsWith("source:")) return <NodeLink id={value} index={index} onOpen={onOpen} />;
    if (/^https?:\/\//.test(value))
      return (
        <a href={value} target="_blank" rel="noreferrer" className="break">
          {value}
        </a>
      );
    return <span className={toneFor(value) !== "neutral" ? "" : undefined}>{value}</span>;
  }
  if (typeof value === "number") return <span className="mono">{fmtNum(value)}</span>;
  if (typeof value === "boolean") return <span className="mono">{value ? "yes" : "no"}</span>;
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "string"))
      return (
        <span className="chips">
          {value.map((x) =>
            index.nodes.has(x) ? <NodeLink key={x} id={x} index={index} onOpen={onOpen} /> : <Badge key={x}>{x}</Badge>,
          )}
        </span>
      );
    return (
      <div className="obj-list">
        {value.map((x, i) => (
          <div key={i} className="obj">
            {typeof x === "object" ? (
              Object.entries(x)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => (
                  <span key={k} className="kv">
                    <span className="muted">{k.replace(/_/g, " ")}</span>{" "}
                    {typeof v === "string" && index.nodes.has(v) ? (
                      <NodeLink id={v} index={index} onOpen={onOpen} />
                    ) : (
                      <span className="mono">{typeof v === "number" ? fmtNum(v) : String(v)}</span>
                    )}
                  </span>
                ))
            ) : (
              String(x)
            )}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object")
    return (
      <span className="kvs">
        {Object.entries(value)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => (
            <span key={k} className="kv">
              <span className="muted">{k}</span> <span className="mono">{typeof v === "number" ? fmtNum(v) : String(v)}</span>
            </span>
          ))}
      </span>
    );
  return String(value);
}

export function fmtNum(x: number): string {
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e6) return x.toExponential(2).replace("e+", "×10^");
  if (a >= 100) return Math.round(x).toLocaleString();
  if (a >= 1) return (Math.round(x * 100) / 100).toString();
  return Number(x.toPrecision(3)).toString();
}

export function Curation({ c }: { c?: { status?: string; notes?: string | null; reviewer?: string | null } }) {
  if (!c) return null;
  return (
    <div className="curation">
      <Badge tone={toneFor(c.status)}>{c.status}</Badge>
      {c.reviewer && <span className="muted small"> by {c.reviewer}</span>}
      {c.notes && <div className="small">{c.notes}</div>}
    </div>
  );
}

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

/** Searchable multi-select with removable chips. */
export function MultiSelect({
  options, value, onChange, placeholder,
}: { options: Option[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return options.filter((o) => !value.includes(o.id) && (`${o.label} ${o.id}`.toLowerCase().includes(needle))).slice(0, 60);
  }, [options, q, value]);
  return (
    <div className="multiselect" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="ms-box" onClick={() => inputRef.current?.focus()}>
        {value.map((id) => (
          <span key={id} className="ms-chip">
            {byId.get(id)?.label ?? short(id)}
            <button aria-label="remove" onClick={() => onChange(value.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={q}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) {
              onChange([...value, filtered[0].id]);
              setQ("");
            } else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="ms-menu" tabIndex={-1}>
          {filtered.map((o) => (
            <button
              key={o.id}
              className="ms-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange([...value, o.id]);
                setQ("");
              }}
            >
              {o.label}
              {o.hint && <span className="muted small"> {o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Section({ title, count, children, right }: { title: string; count?: number; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h3>
        {right}
      </header>
      {children}
    </section>
  );
}
