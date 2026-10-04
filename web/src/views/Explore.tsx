import type { ElementDefinition, LayoutOptions } from "cytoscape";
import { useMemo, useState } from "react";
import { CyGraph } from "../components/CyGraph";
import { Inspector } from "../components/Inspector";
import { TypeDot } from "../components/ui";
import type { GraphIndex } from "../graphIndex";
import { REL_LABEL, TYPE_ORDER, TYPE_STYLE, edgeBadge, edgeColor } from "../theme";
import type { NodeType } from "../types";

const MAX_NEIGHBORS = 160;
const FORCE: LayoutOptions = {
  name: "fcose",
  animate: false,
  quality: "default",
  nodeRepulsion: 12000,
  idealEdgeLength: 110,
  nodeSeparation: 70,
  padding: 30,
} as LayoutOptions;

// One focus node: put it in the centre and its neighbours on rings, grouped by relation.
const RADIAL: LayoutOptions = {
  name: "concentric",
  animate: false,
  concentric: (n: any) => (n.data("focus") ? 2 : 1),
  levelWidth: () => 1,
  minNodeSpacing: 26,
  startAngle: (3 / 2) * Math.PI,
  padding: 30,
} as LayoutOptions;

const EXPLORE_STYLE = [
  { selector: "edge", style: { label: "" } },
  { selector: "edge.hl, edge:selected", style: { label: "data(label)" } },
  { selector: "node", style: { "font-size": 9 } },
  { selector: "node[?focus]", style: { "font-size": 12 } },
] as any;

export interface ExploreProps {
  index: GraphIndex;
  focus: string;
  selected: string | null;
  onFocus: (id: string) => void;
  onSelect: (id: string | null) => void;
}

export function Explore({ index, focus, selected, onFocus, onSelect }: ExploreProps) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<Set<NodeType>>(new Set());
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string[]>([]);
  const [lastFocus, setLastFocus] = useState(focus);

  // reset expansion when the focus changes from outside (links, history)
  if (focus !== lastFocus) {
    setLastFocus(focus);
    setExpanded([]);
  }

  const results = useMemo(() => index.search(query, types, 300).filter((n) => n.type !== "source" || query), [index, query, types]);

  const { elements, relsPresent, truncated } = useMemo(() => {
    const centers = [focus, ...expanded.filter((x) => x !== focus)];
    const nodeIds = new Set<string>(centers);
    const edges = new Map<string, ReturnType<GraphIndex["neighbors"]>[number]>();
    const rels = new Map<string, number>();
    let truncated = false;
    for (const c of centers) {
      const nb = index.neighbors(c);
      for (const e of nb) rels.set(e.rel, (rels.get(e.rel) ?? 0) + 1);
      const shown = nb.filter((e) => !hiddenRels.has(e.rel));
      if (shown.length > MAX_NEIGHBORS) truncated = true;
      for (const e of shown.slice(0, MAX_NEIGHBORS)) {
        edges.set(e.id, e);
        nodeIds.add(e.source);
        nodeIds.add(e.target);
      }
    }
    const relOf = new Map<string, string>();
    for (const e of edges.values()) {
      const other = e.source === focus ? e.target : e.source;
      if (!relOf.has(other)) relOf.set(other, e.rel);
    }
    const ordered = [...nodeIds].sort(
      (a, b) => (relOf.get(a) ?? "").localeCompare(relOf.get(b) ?? "") || index.name(a).localeCompare(index.name(b)),
    );
    const els: ElementDefinition[] = [];
    for (const id of ordered) {
      const n = index.nodes.get(id);
      const type = index.type(id);
      const style = TYPE_STYLE[type];
      const deg = index.neighbors(id).length;
      els.push({
        data: {
          id,
          label: n?.name ?? id,
          color: style?.color ?? "#999",
          shape: n?.props.kind === "hazard" ? "octagon" : style?.shape ?? "ellipse",
          size: id === focus ? 38 : expanded.includes(id) ? 30 : Math.min(28, 14 + Math.sqrt(deg) * 2.5),
          focus: id === focus || undefined,
        },
      });
    }
    for (const e of edges.values()) {
      els.push({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: edgeBadge(e.rel, e.props) || REL_LABEL[e.rel] || e.rel,
          color: edgeColor(e.rel, e.props),
          dashed: e.props.grade === "NEG" || undefined,
        },
      });
    }
    return { elements: els, relsPresent: [...rels.entries()].sort((a, b) => b[1] - a[1]), truncated };
  }, [index, focus, expanded, hiddenRels]);

  const toggleType = (t: NodeType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const toggleRel = (r: string) =>
    setHiddenRels((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });

  return (
    <div className="explore">
      <aside className="sidebar">
        <input className="search" placeholder="Search nodes, ids, aliases…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="type-filters">
          {TYPE_ORDER.map((t) => (
            <button key={t} className={`type-filter ${types.has(t) ? "on" : ""}`} onClick={() => toggleType(t)}>
              <TypeDot type={t} />
              {TYPE_STYLE[t].label}
              <span className="muted">{index.byType.get(t)?.length ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="result-list">
          {results.map((n) => (
            <button key={n.id} className={`result ${n.id === focus ? "active" : ""}`} onClick={() => onFocus(n.id)}>
              <TypeDot type={n.type} />
              <span className="result-name">{n.name}</span>
              {n.props.kind === "hazard" && <span className="badge badge-bad">hazard</span>}
            </button>
          ))}
          {!results.length && <div className="empty">No matches</div>}
        </div>
      </aside>

      <main className="canvas">
        <div className="canvas-bar">
          <div className="crumb">
            <TypeDot type={index.type(focus)} />
            <strong>{index.name(focus)}</strong>
            <span className="mono muted">{focus}</span>
            {expanded.length > 0 && (
              <button className="link" onClick={() => setExpanded([])}>
                collapse {expanded.length} expanded
              </button>
            )}
          </div>
          <div className="rel-toggles">
            {relsPresent.map(([r, c]) => (
              <label key={r} className={`rel-toggle ${hiddenRels.has(r) ? "off" : ""}`}>
                <input type="checkbox" checked={!hiddenRels.has(r)} onChange={() => toggleRel(r)} />
                {REL_LABEL[r] ?? r} <span className="muted">{c}</span>
              </label>
            ))}
          </div>
        </div>
        {truncated && <div className="notice">Large neighbourhood: showing the first {MAX_NEIGHBORS} edges per node. Hide relation types to see the rest.</div>}
        <CyGraph
          elements={elements}
          layout={expanded.length ? FORCE : RADIAL}
          extraStyle={EXPLORE_STYLE}
          selected={selected}
          onSelect={(id) => onSelect(id)}
          onActivate={(id) => onFocus(id)}
          onBackground={() => onSelect(null)}
        />
        <div className="canvas-hint">Hover to highlight · click to inspect · double-click a node to focus it · "Expand neighbours" to grow the graph</div>
      </main>

      <aside className="inspector-pane">
        <Inspector
          index={index}
          id={selected ?? focus}
          onOpen={onFocus}
          onSelect={onSelect}
          onExpand={(id) => setExpanded((prev) => (prev.includes(id) ? prev : [...prev, id]))}
          isExpanded={(id) => id === focus || expanded.includes(id)}
        />
      </aside>
    </div>
  );
}
