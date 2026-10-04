import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { GraphIndex } from "./graphIndex";
import type { Meta } from "./types";
import { Explore } from "./views/Explore";
import { Formulate, type FormulateState } from "./views/Formulate";
import { Overview } from "./views/Overview";
import { Relations } from "./views/Relations";

type Tab = "overview" | "explore" | "relations" | "formulate";

interface Route {
  tab: Tab;
  focus: string;
  selected: string | null;
  rel: string;
}

const DEFAULT: Route = { tab: "overview", focus: "ingredient:omega3_epa_dha", selected: null, rel: "ADDRESSES" };

// #/explore?focus=..&sel=..   #/relations?rel=..   #/formulate   #/overview
function parseHash(): Route {
  const [path, qs] = window.location.hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(qs ?? "");
  const tab = (["overview", "explore", "relations", "formulate"].includes(path) ? path : "overview") as Tab;
  return { tab, focus: q.get("focus") ?? DEFAULT.focus, selected: q.get("sel"), rel: q.get("rel") ?? DEFAULT.rel };
}

function toHash(r: Route): string {
  const q = new URLSearchParams();
  if (r.tab === "explore") {
    q.set("focus", r.focus);
    if (r.selected) q.set("sel", r.selected);
  }
  if (r.tab === "relations") q.set("rel", r.rel);
  const s = q.toString();
  return `#/${r.tab}${s ? `?${s}` : ""}`;
}

export default function App() {
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [formState, setFormState] = useState<FormulateState | null>(null);

  const reload = useCallback(() => {
    Promise.all([api.graph(), api.meta()])
      .then(([g, m]) => {
        setIndex(new GraphIndex(g));
        setMeta(m);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(reload, [reload]);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (patch: Partial<Route>) => {
    const next = { ...route, ...patch };
    window.location.hash = toHash(next);
  };
  const openNode = (focus: string, selected?: string) => go({ tab: "explore", focus, selected: selected ?? null });

  if (error)
    return (
      <div className="boot">
        <h2>Cannot reach the KG API</h2>
        <p className="mono">{error}</p>
        <p>
          Start it with <code>yarn api</code> (or <code>uvicorn server.app:app --port 8000</code> from the repo root), then{" "}
          <button className="btn" onClick={reload}>
            retry
          </button>
        </p>
      </div>
    );
  if (!index || !meta) return <div className="boot">Loading knowledge graph…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Freyja <span className="muted">KG Explorer</span>
        </div>
        <nav className="tabs">
          {(
            [
              ["overview", "Overview"],
              ["explore", "Explore"],
              ["relations", "Relations"],
              ["formulate", "Formulate"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} className={route.tab === t ? "on" : ""} onClick={() => go({ tab: t })}>
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {(meta.curation.draft ?? 0) > 0 && <span className="badge badge-warn">{meta.curation.draft} facts in draft — not vet reviewed</span>}
          <span className="mono muted small">KG {meta.version}</span>
          <button className="btn small ghost" onClick={reload} title="Reload graph from the API (picks up YAML edits)">
            Reload
          </button>
        </div>
      </header>
      <div className="body">
        {route.tab === "overview" && <Overview index={index} meta={meta} onOpenNode={(id) => openNode(id)} onOpenRelation={(rel) => go({ tab: "relations", rel })} />}
        {route.tab === "explore" && (
          <Explore index={index} focus={index.nodes.has(route.focus) ? route.focus : DEFAULT.focus} selected={route.selected} onFocus={(id) => openNode(id)} onSelect={(id) => go({ selected: id })} />
        )}
        {route.tab === "relations" && <Relations index={index} rel={route.rel} onRel={(rel) => go({ rel })} onOpen={openNode} />}
        {route.tab === "formulate" && <Formulate index={index} onOpen={openNode} state={formState} setState={setFormState} />}
      </div>
    </div>
  );
}
