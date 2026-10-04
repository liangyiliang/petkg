import type { GraphPayload, KGEdge, KGNode, NodeType } from "./types";

/** Client-side indexes over the full graph payload (a few hundred KB, loaded once). */
export class GraphIndex {
  readonly version: string;
  readonly nodes: Map<string, KGNode> = new Map();
  readonly edges: Map<string, KGEdge> = new Map();
  readonly out: Map<string, KGEdge[]> = new Map();
  readonly in: Map<string, KGEdge[]> = new Map();
  readonly byType: Map<NodeType, KGNode[]> = new Map();
  readonly byRel: Map<string, KGEdge[]> = new Map();
  /** source id -> ids of edges / fact nodes that cite it */
  readonly citedBy: Map<string, string[]> = new Map();

  constructor(payload: GraphPayload) {
    this.version = payload.version;
    for (const n of payload.nodes) {
      this.nodes.set(n.id, n);
      push(this.byType, n.type, n);
      for (const s of (n.props.sources as string[] | undefined) ?? []) push(this.citedBy, s, n.id);
    }
    for (const e of payload.edges) {
      this.edges.set(e.id, e);
      push(this.out, e.source, e);
      push(this.in, e.target, e);
      push(this.byRel, e.rel, e);
      for (const s of (e.props.sources as string[] | undefined) ?? []) push(this.citedBy, s, e.id);
    }
    for (const list of this.byType.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  name(id: string | null | undefined): string {
    if (!id) return "";
    return this.nodes.get(id)?.name ?? id.split(":").slice(1).join(":") ?? id;
  }

  type(id: string): NodeType {
    return (this.nodes.get(id)?.type ?? id.split(":")[0]) as NodeType;
  }

  neighbors(id: string, hidden: Set<string> = new Set()): KGEdge[] {
    return [...(this.out.get(id) ?? []), ...(this.in.get(id) ?? [])].filter((e) => !hidden.has(e.rel));
  }

  search(q: string, types?: Set<NodeType>, limit = 200): KGNode[] {
    const needle = q.trim().toLowerCase();
    const out: KGNode[] = [];
    for (const n of this.nodes.values()) {
      if (types && types.size && !types.has(n.type)) continue;
      if (needle) {
        const hay = `${n.name} ${n.id} ${(n.props.aliases ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      out.push(n);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Engine fact ids look like "REL|a|b|species" for edges or a node id for dose/limit facts. */
  resolveFact(factId: string): { edge?: KGEdge; node?: KGNode } {
    if (this.edges.has(factId)) return { edge: this.edges.get(factId) };
    if (this.nodes.has(factId)) return { node: this.nodes.get(factId) };
    return {};
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function sourceLink(props: Record<string, any>): string | null {
  if (props.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${props.pmid}/`;
  if (props.doi) return `https://doi.org/${props.doi}`;
  if (props.url) return props.url as string;
  return null;
}
