import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { DecisionGraph, STATUS_LABEL, ingredientStatuses, type IngredientStatus } from "../components/DecisionGraph";
import { Badge, MultiSelect, Section, TypeDot, fmtNum, toneFor, type Option } from "../components/ui";
import type { GraphIndex } from "../graphIndex";
import { REL_LABEL, short } from "../theme";
import type { EngineConfig, Fact, Formula, PetProfile } from "../types";

export interface FormulateState {
  pet: PetProfile;
  config: EngineConfig;
}

interface Props {
  index: GraphIndex;
  onOpen: (focus: string, selected?: string) => void;
  /** lifted to App so the form survives tab switches */
  state: FormulateState | null;
  setState: (s: FormulateState) => void;
}

const BLANK: Record<string, PetProfile> = {
  dog: { pet_id: "new-dog", species: "species:dog", breed: null, age_years: 6, weight_kg: 20, conditions: [], medications: [], allergens: [], needs: [{ need: "need:joint_mobility", priority: 1 }] },
  cat: { pet_id: "new-cat", species: "species:cat", breed: "breed:domestic_shorthair", age_years: 8, weight_kg: 4.5, conditions: [], medications: [], allergens: [], needs: [{ need: "need:renal_support", priority: 1 }] },
};

export function Formulate({ index, onOpen, state, setState }: Props) {
  const [examples, setExamples] = useState<PetProfile[]>([]);
  const pet = state?.pet ?? BLANK.dog;
  const config = state?.config ?? { min_grade: "C", max_actives: 6 };
  const setPet = (p: PetProfile) => setState({ pet: p, config });
  const setConfig = (c: EngineConfig) => setState({ pet, config: c });
  const [formula, setFormula] = useState<Formula | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCandidates, setShowCandidates] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    api.examples().then((ex) => {
      setExamples(ex);
      if (!state && ex[0]) setState({ pet: withDefaults(ex[0]), config });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-run (debounced) whenever the profile or config changes
  useEffect(() => {
    if (!pet.needs.length) {
      setFormula(null);
      return;
    }
    const id = ++reqId.current;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .formulate(pet, config)
        .then((f) => {
          if (id !== reqId.current) return;
          setFormula(f);
          setError(null);
        })
        .catch((e) => id === reqId.current && setError(String(e.message ?? e)))
        .finally(() => id === reqId.current && setBusy(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="formulate">
      <aside className="pet-form">
        <PetForm index={index} pet={pet} setPet={setPet} examples={examples} config={config} setConfig={setConfig} />
      </aside>
      <main className="results">
        {error && <div className="notice bad">{error}</div>}
        {!pet.needs.length && <div className="empty big">Select at least one health need to formulate.</div>}
        {formula && pet.needs.length > 0 && (
          <Results
            index={index}
            pet={pet}
            f={formula}
            busy={busy}
            minGrade={config.min_grade}
            showCandidates={showCandidates}
            setShowCandidates={setShowCandidates}
            picked={picked}
            setPicked={setPicked}
            onOpen={onOpen}
          />
        )}
      </main>
    </div>
  );
}

function withDefaults(p: PetProfile): PetProfile {
  return {
    ...p,
    breed: p.breed ?? null,
    ideal_weight_kg: p.ideal_weight_kg ?? null,
    conditions: p.conditions ?? [],
    medications: p.medications ?? [],
    allergens: p.allergens ?? [],
  };
}

// ---------------------------------------------------------------------------- form

function PetForm({
  index, pet, setPet, examples, config, setConfig,
}: {
  index: GraphIndex;
  pet: PetProfile;
  setPet: (p: PetProfile) => void;
  examples: PetProfile[];
  config: EngineConfig;
  setConfig: (c: EngineConfig) => void;
}) {
  const opts = useMemo(() => {
    const of = (t: Parameters<GraphIndex["byType"]["get"]>[0], filter?: (props: any) => boolean): Option[] =>
      (index.byType.get(t) ?? []).filter((n) => !filter || filter(n.props)).map((n) => ({ id: n.id, label: n.name }));
    return {
      breeds: of("breed", (p) => p.species === pet.species),
      conditions: of("condition", (p) => !p.species || p.species.includes(pet.species)),
      meds: (index.byType.get("med") ?? []).map((n) => ({ id: n.id, label: n.name, hint: (n.props.examples ?? []).slice(0, 3).join(", ") })),
      allergens: of("allergen"),
      needs: index.byType.get("need") ?? [],
    };
  }, [index, pet.species]);

  const set = <K extends keyof PetProfile>(k: K, v: PetProfile[K]) => setPet({ ...pet, [k]: v });
  const prio = (need: string) => pet.needs.find((n) => n.need === need)?.priority ?? 0;
  const setPrio = (need: string, p: number) =>
    set("needs", p === 0 ? pet.needs.filter((n) => n.need !== need) : [...pet.needs.filter((n) => n.need !== need), { need, priority: p }]);

  return (
    <div className="form">
      <label className="field">
        <span>Start from</span>
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "dog" || v === "cat") setPet(BLANK[v]);
            else if (v) setPet(withDefaults(examples.find((x) => x.pet_id === v)!));
          }}
        >
          <option value="">{pet.pet_id}</option>
          <optgroup label="Synthetic examples">
            {examples.map((x) => (
              <option key={x.pet_id} value={x.pet_id}>
                {x.pet_id} ({short(x.species)}, {short(x.breed ?? "")})
              </option>
            ))}
          </optgroup>
          <optgroup label="Blank">
            <option value="dog">Blank dog</option>
            <option value="cat">Blank cat</option>
          </optgroup>
        </select>
      </label>

      <div className="field">
        <span>Species</span>
        <div className="segmented">
          {["species:dog", "species:cat"].map((s) => (
            <button key={s} className={pet.species === s ? "on" : ""} onClick={() => s !== pet.species && setPet({ ...BLANK[short(s)], needs: pet.needs })}>
              {index.name(s)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Breed</span>
        <select value={pet.breed ?? ""} onChange={(e) => set("breed", e.target.value || null)}>
          <option value="">Unknown / mixed</option>
          {opts.breeds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      <div className="row3">
        <label className="field">
          <span>Age (y)</span>
          <input type="number" min={0} step={0.5} value={pet.age_years} onChange={(e) => set("age_years", Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Weight (kg)</span>
          <input type="number" min={0.5} step={0.1} value={pet.weight_kg} onChange={(e) => set("weight_kg", Math.max(0.1, Number(e.target.value)))} />
        </label>
        <label className="field" title="Doses use ideal weight when set (overweight pets)">
          <span>Ideal (kg)</span>
          <input type="number" min={0} step={0.1} value={pet.ideal_weight_kg ?? ""} placeholder="—" onChange={(e) => set("ideal_weight_kg", e.target.value ? Number(e.target.value) : null)} />
        </label>
      </div>

      <div className="field">
        <span>Conditions</span>
        <MultiSelect options={opts.conditions} value={pet.conditions} onChange={(v) => set("conditions", v)} placeholder="Add diagnosis or state…" />
      </div>
      <div className="field">
        <span>Medications (class)</span>
        <MultiSelect options={opts.meds} value={pet.medications} onChange={(v) => set("medications", v)} placeholder="Add drug class…" />
      </div>
      <div className="field">
        <span>Allergens</span>
        <MultiSelect options={opts.allergens} value={pet.allergens} onChange={(v) => set("allergens", v)} placeholder="Add allergen…" />
      </div>

      <div className="field">
        <span>Health needs (from step 1) — priority</span>
        <div className="needs">
          {opts.needs.map((n) => (
            <div key={n.id} className={`need-row ${prio(n.id) ? "on" : ""}`}>
              <span className="need-name">{n.name}</span>
              <div className="segmented tiny">
                {[0, 1, 2, 3].map((p) => (
                  <button key={p} className={prio(n.id) === p ? "on" : ""} onClick={() => setPrio(n.id, p)} title={p ? `priority ${p}` : "not needed"}>
                    {p || "–"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <details className="advanced">
        <summary>Engine settings</summary>
        <div className="row3">
          <label className="field">
            <span>Min evidence</span>
            <select value={config.min_grade} onChange={(e) => setConfig({ ...config, min_grade: e.target.value })}>
              {["A", "B", "C", "D"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Max actives</span>
            <input type="number" min={1} max={12} value={config.max_actives} onChange={(e) => setConfig({ ...config, max_actives: Number(e.target.value) })} />
          </label>
        </div>
      </details>
      <details className="advanced">
        <summary>Request JSON</summary>
        <pre className="json">{JSON.stringify({ ...pet, config }, null, 2)}</pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------- results

function Results({
  index, pet, f, busy, minGrade, showCandidates, setShowCandidates, picked, setPicked, onOpen,
}: {
  index: GraphIndex;
  pet: PetProfile;
  f: Formula;
  busy: boolean;
  minGrade: string;
  showCandidates: boolean;
  setShowCandidates: (v: boolean) => void;
  picked: string | null;
  setPicked: (v: string | null) => void;
  onOpen: (focus: string, selected?: string) => void;
}) {
  const status = useMemo(() => ingredientStatuses(index, pet, f, minGrade), [index, pet, f, minGrade]);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const pickedRef = picked?.split("|").slice(1).join("|") ?? null;

  return (
    <div className={`results-inner ${busy ? "busy" : ""}`}>
      <div className="summary">
        <div>
          <div className="muted small">Life stage</div>
          <strong>{index.name(f.life_stage) || "—"}</strong>
        </div>
        <div>
          <div className="muted small">Actives</div>
          <strong>{f.lines.length}</strong>
        </div>
        <div>
          <div className="muted small">Manufacturable</div>
          <Badge tone={f.manufacturing.feasible ? "good" : "bad"}>{f.manufacturing.feasible ? "yes" : "no"}</Badge>
        </div>
        <div>
          <div className="muted small">Vet flags</div>
          <Badge tone={f.flags.length ? "warn" : "good"}>{f.flags.length}</Badge>
        </div>
        <div>
          <div className="muted small">Unmet needs</div>
          <Badge tone={f.unmet_needs.length ? "bad" : "good"}>{f.unmet_needs.length}</Badge>
        </div>
        <div>
          <div className="muted small">Facts / sources</div>
          <strong>
            {f.facts_used.length} / {f.sources_used.length}
          </strong>
        </div>
        <div className="mono muted small">KG {f.kg_version}</div>
      </div>
      {f.predispositions.length > 0 && (
        <div className="predispositions">
          <span className="muted small">Breed predispositions:</span>{" "}
          {f.predispositions.map((p) => (
            <button key={p} className="chip" onClick={() => onOpen(p)}>
              {index.name(p)}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">
          Decision graph
          <span className="legend">
            {(Object.keys(STATUS_LABEL) as IngredientStatus[]).map((s) => (
              <span key={s} className={`legend-item st-${s}`}>
                {STATUS_LABEL[s]}
              </span>
            ))}
          </span>
          <label className="small">
            <input type="checkbox" checked={showCandidates} onChange={(e) => setShowCandidates(e.target.checked)} /> show unselected candidates
          </label>
        </div>
        <div className="decision-wrap">
          <DecisionGraph index={index} pet={pet} formula={f} minGrade={minGrade} showCandidates={showCandidates} selected={picked} onSelect={setPicked} />
          {pickedRef && (
            <PickedDetail index={index} f={f} refId={pickedRef} status={status.get(pickedRef)} onOpen={onOpen} onClose={() => setPicked(null)} />
          )}
        </div>
        <div className="canvas-hint">Columns: pet context → needs → ingredients → raw materials → dosage forms. Dashed lines are the safety reasons.</div>
      </div>

      <Section title="Formula (per day)" count={f.lines.length}>
        <table className="grid formula-table">
          <thead>
            <tr>
              <th>ingredient</th>
              <th className="num">dose</th>
              <th>needs</th>
              <th>raw material</th>
              <th className="num">raw mass</th>
              <th>form</th>
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l) => (
              <FragmentRow key={l.ingredient} open={openLine === l.ingredient} onToggle={() => setOpenLine(openLine === l.ingredient ? null : l.ingredient)}>
                <>
                  <td>
                    <TypeDot type="ingredient" /> {index.name(l.ingredient)}
                    {status.get(l.ingredient) === "flagged" && <Badge tone="warn">flag</Badge>}
                  </td>
                  <td className="num mono">
                    {fmtNum(l.dose)} {l.unit}
                    {l.divided_doses > 1 && <span className="muted"> ÷{l.divided_doses}</span>}
                  </td>
                  <td>{l.needs.map((n) => index.name(n)).join(", ")}</td>
                  <td>{index.name(l.raw_material)}</td>
                  <td className="num mono">{fmtNum(l.raw_mass_mg)} mg</td>
                  <td>{index.name(l.component)}</td>
                </>
                <div className="line-detail">
                  <div className="label">Calculation</div>
                  <ul className="calc">
                    {l.calc.map((c) => (
                      <li key={c} className="mono small">
                        {c}
                      </li>
                    ))}
                  </ul>
                  <div className="label">Facts used</div>
                  <FactList facts={l.facts} index={index} onOpen={onOpen} />
                </div>
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="two-col">
        <Section title="Flags for vet review" count={f.flags.length}>
          {f.flags.length === 0 && <div className="muted">None</div>}
          <ul className="flag-list">
            {f.flags.map((fl, i) => (
              <li key={i}>
                <Badge tone={toneFor(fl.action)}>{fl.action.replace("_", " ")}</Badge> {fl.message}
                <FactList facts={fl.facts} index={index} onOpen={onOpen} compact />
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Excluded" count={f.excluded.length}>
          {f.excluded.length === 0 && <div className="muted">None</div>}
          <ul className="flag-list">
            {f.excluded.map((x) => (
              <li key={x.ingredient}>
                <strong>{index.name(x.ingredient)}</strong> — {x.reason.replace(/(condition|allergen|med|species):/g, "")}
                <FactList facts={x.facts} index={index} onOpen={onOpen} compact />
              </li>
            ))}
          </ul>
          {f.not_recommended.length > 0 && (
            <>
              <div className="label">Not recommended (evidence of no benefit)</div>
              <FactList facts={f.not_recommended} index={index} onOpen={onOpen} />
            </>
          )}
          {f.unmet_needs.length > 0 && (
            <>
              <div className="label">Unmet needs</div>
              <div className="chips">
                {f.unmet_needs.map((n) => (
                  <button key={n} className="chip bad" onClick={() => onOpen(n)}>
                    {index.name(n)}
                  </button>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      <div className="two-col">
        <Section title="Manufacturing" right={<Badge tone={f.manufacturing.feasible ? "good" : "bad"}>{f.manufacturing.feasible ? "feasible" : "not feasible"}</Badge>}>
          <div className="components">
            {f.manufacturing.components.map((c) => (
              <div key={c.form} className="component">
                <div className="component-title">{index.name(c.form)}</div>
                <div className="big-num">
                  {c.units_per_day} <span className="muted small">× {c.unit_mass_g} g / day</span>
                </div>
                <div className="muted small">{c.total_mass_g} g actives</div>
                <ul className="small">
                  {c.raw_materials.map((r) => (
                    <li key={r}>{index.name(r)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {f.manufacturing.issues.map((i) => (
            <div key={i} className="notice bad small">
              {i}
            </div>
          ))}
        </Section>
        <Section title="Closest in-market products" count={f.product_matches.length}>
          <ul className="products">
            {f.product_matches.map((m) => (
              <li key={m.product}>
                <div className="product-head">
                  <div className="score-bar">
                    <div style={{ width: `${Math.round(m.score * 100)}%` }} />
                  </div>
                  <button className="node-link" onClick={() => onOpen(m.product)}>
                    {m.name}
                  </button>
                  <span className="muted small">{m.units_per_day}/day</span>
                </div>
                <div className="chips">
                  {Object.entries(m.covers).map(([ing, r]) => (
                    <Badge key={ing} tone={r >= 0.8 ? "good" : r >= 0.4 ? "warn" : "bad"}>
                      {index.name(ing)} {Math.round(r * 100)}%
                    </Badge>
                  ))}
                  {m.missing.map((ing) => (
                    <Badge key={ing} tone="muted">
                      no {index.name(ing)}
                    </Badge>
                  ))}
                </div>
                {m.warnings.map((w) => (
                  <div key={w} className="small warn-text">
                    ⚠ {w.replace(/(ingredient|condition|allergen):/g, "")}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Every fact this formula relied on" count={f.facts_used.length}>
        <div className="chips">
          {f.facts_used.map((id) => {
            const { edge, node } = index.resolveFact(id);
            const label = edge ? `${REL_LABEL[edge.rel] ?? edge.rel}: ${index.name(edge.source)} → ${index.name(edge.target)}` : node ? node.id : id;
            return (
              <button key={id} className="chip" onClick={() => (edge ? onOpen(edge.source, edge.id) : onOpen(id))} title={id}>
                {label}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function FragmentRow({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: [JSX.Element, JSX.Element] }) {
  return (
    <>
      <tr className={`clickable ${open ? "open" : ""}`} onClick={onToggle}>
        {children[0]}
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={6}>{children[1]}</td>
        </tr>
      )}
    </>
  );
}

function FactList({ facts, index, onOpen, compact }: { facts: Fact[]; index: GraphIndex; onOpen: (f: string, s?: string) => void; compact?: boolean }) {
  if (!facts.length) return null;
  return (
    <ul className={`facts ${compact ? "compact" : ""}`}>
      {facts.map((x) => {
        const { edge } = index.resolveFact(x.edge);
        return (
          <li key={x.edge}>
            <button className="fact-kind" onClick={() => (edge ? onOpen(edge.source, edge.id) : onOpen(x.edge))} title="open in explorer">
              {REL_LABEL[x.kind] ?? x.kind.toLowerCase().replace("_", " ")}
            </button>
            {!compact && <span className="small">{x.statement}</span>}
            <span className="muted small"> · {x.sources.length} source{x.sources.length === 1 ? "" : "s"}</span>
            {x.curation && <Badge tone={toneFor(x.curation)}>{x.curation}</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

function PickedDetail({
  index, f, refId, status, onOpen, onClose,
}: { index: GraphIndex; f: Formula; refId: string; status?: IngredientStatus; onOpen: (f: string, s?: string) => void; onClose: () => void }) {
  const line = f.lines.find((l) => l.ingredient === refId);
  const ex = f.excluded.find((x) => x.ingredient === refId);
  const flags = f.flags.filter((x) => x.ingredient === refId);
  const neg = f.not_recommended.filter((x) => x.edge.split("|")[1] === refId);
  return (
    <div className="picked">
      <div className="picked-head">
        <TypeDot type={index.type(refId)} />
        <strong>{index.name(refId)}</strong>
        {status && <Badge tone={status === "excluded" ? "bad" : status === "flagged" ? "warn" : status === "chosen" ? "good" : "muted"}>{STATUS_LABEL[status]}</Badge>}
        <button className="link" onClick={() => onOpen(refId)}>
          open in explorer
        </button>
        <button className="close" onClick={onClose} aria-label="close">
          ×
        </button>
      </div>
      {line && (
        <>
          <div className="mono small">
            {fmtNum(line.dose)} {line.unit}/day via {index.name(line.raw_material)} ({fmtNum(line.raw_mass_mg)} mg)
          </div>
          <ul className="calc">
            {line.calc.map((c) => (
              <li key={c} className="mono small">
                {c}
              </li>
            ))}
          </ul>
          <FactList facts={line.facts} index={index} onOpen={onOpen} />
        </>
      )}
      {ex && (
        <>
          <p className="small">{ex.reason}</p>
          <FactList facts={ex.facts} index={index} onOpen={onOpen} />
        </>
      )}
      {flags.map((fl, i) => (
        <p key={i} className="small">
          <Badge tone="warn">{fl.action}</Badge> {fl.message}
        </p>
      ))}
      {neg.length > 0 && <FactList facts={neg} index={index} onOpen={onOpen} />}
      {status === "candidate" && (
        <p className="small muted">
          Passed the safety screen but was not picked: the needs it addresses were already covered by higher-scoring ingredients, or the active limit was reached.
        </p>
      )}
    </div>
  );
}
