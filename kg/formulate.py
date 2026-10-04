"""Reference implementation of pipeline step 2 ("Choosing the formula").

Deterministic: same PetProfile + same KG version -> same formula. No LLM here.
Every decision is recorded as a `Fact` pointing at the KG edge and sources it
came from, so step 3 can explain the formula using only facts actually used.

    candidates  ->  safety screen  ->  selection  ->  dosing  ->  raw materials
                ->  manufacturability  ->  product matching
"""

from __future__ import annotations

import itertools
import math
from typing import Optional

from pydantic import BaseModel, Field

from . import schema as S
from .loader import KnowledgeGraph, edge_id

GRADE_WEIGHT = {"A": 4, "B": 3, "C": 2, "D": 1, "NEG": 0}
PRIORITY_WEIGHT = {1: 3, 2: 2, 3: 1}


# --------------------------------------------------------------------------
# Input / output models
# --------------------------------------------------------------------------


class NeedRequest(BaseModel):
    need: str
    priority: int = Field(2, ge=1, le=3)


class PetProfile(BaseModel):
    """What step 1 hands to step 2."""

    pet_id: str
    species: S.SpeciesId
    breed: Optional[str] = None
    age_years: float
    weight_kg: float = Field(gt=0)
    ideal_weight_kg: Optional[float] = Field(default=None, gt=0, description="dose on this if set (obese pets)")
    conditions: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    allergens: list[str] = Field(default_factory=list)
    needs: list[NeedRequest]

    model_config = {"use_enum_values": True}

    @property
    def dosing_weight(self) -> float:
        return self.ideal_weight_kg or self.weight_kg


class EngineConfig(BaseModel):
    min_grade: str = "C"
    max_actives: int = 6
    # how many distinct ingredients each need should get, by priority
    coverage_target: dict[int, int] = {1: 2, 2: 1, 3: 1}


class Fact(BaseModel):
    """A single KG fact the engine relied on."""

    kind: str  # e.g. ADDRESSES, TOXIC_TO, DOSE_RULE
    edge: str
    statement: str
    sources: list[str] = Field(default_factory=list)
    curation: Optional[str] = None


class Exclusion(BaseModel):
    ingredient: str
    reason: str
    facts: list[Fact]


class Flag(BaseModel):
    ingredient: Optional[str] = None
    action: str  # vet_review, monitor, separate_dosing, reduce_dose, info
    message: str
    facts: list[Fact] = Field(default_factory=list)


class FormulaLine(BaseModel):
    ingredient: str
    needs: list[str]
    dose: float
    unit: str
    dose_range: tuple[Optional[float], Optional[float]]
    ceiling: Optional[float]
    divided_doses: int
    raw_material: str
    raw_mass_mg: float
    component: Optional[str] = None  # form id once manufacturing is decided
    calc: list[str]
    facts: list[Fact]


class Component(BaseModel):
    form: str
    raw_materials: list[str]
    total_mass_g: float
    units_per_day: int
    unit_mass_g: float


class Manufacturing(BaseModel):
    feasible: bool
    components: list[Component] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)


class ProductMatch(BaseModel):
    product: str
    name: str
    units_per_day: float
    score: float
    covers: dict[str, float]  # ingredient -> delivered / formula target
    needs_covered: list[str]
    missing: list[str]
    warnings: list[str]


class Formula(BaseModel):
    pet_id: str
    kg_version: str
    life_stage: Optional[str]
    predispositions: list[str]
    lines: list[FormulaLine]
    excluded: list[Exclusion]
    flags: list[Flag]
    unmet_needs: list[str]
    not_recommended: list[Fact] = Field(default_factory=list)  # NEG evidence for a requested need
    manufacturing: Manufacturing
    product_matches: list[ProductMatch]
    facts_used: list[str]  # edge ids
    sources_used: list[str]


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------


def _fact(rel: str, e, statement: str) -> Fact:
    return Fact(kind=rel, edge=edge_id(rel, e), statement=statement, sources=list(e.sources),
                curation=e.curation.status if hasattr(e, "curation") else None)


def _scale(basis: str, value: Optional[float], w: float) -> Optional[float]:
    if value is None:
        return None
    if basis == "per_kg":
        return value * w
    if basis == "per_kg_0.75":
        return value * w ** 0.75
    if basis == "per_animal":
        return value
    raise ValueError(basis)


def _band(bands, w):
    for b in bands:
        if b.min_kg <= w and (b.max_kg is None or w < b.max_kg):
            return b
    return None


def size_class_for_weight(kg_: float) -> str:
    # AAHA-style adult size buckets used when the breed is unknown
    if kg_ < 5:
        return "toy"
    if kg_ < 10:
        return "small"
    if kg_ < 25:
        return "medium"
    if kg_ < 45:
        return "large"
    return "giant"


class Engine:
    def __init__(self, kg: KnowledgeGraph, config: EngineConfig | None = None):
        self.kg = kg
        self.cfg = config or EngineConfig()
        ix = lambda rel: kg.rel(rel)  # noqa: E731
        self.addresses = ix("ADDRESSES")
        self.toxic = ix("TOXIC_TO")
        self.contra = ix("CONTRAINDICATED_IN")
        self.interacts = ix("INTERACTS_WITH")
        self.conflicts = ix("CONFLICTS_WITH")
        self.dose_rules = ix("DOSE_RULE")
        self.limits = ix("SAFETY_LIMIT")
        self.predispositions = ix("PREDISPOSED_TO")

    # ---- context ---------------------------------------------------------
    def life_stage(self, pet: PetProfile) -> Optional[str]:
        size = None
        if pet.species == S.SpeciesId.dog.value:
            breed = self.kg.nodes.get(pet.breed) if pet.breed else None
            size = (breed.size_class if breed and breed.size_class else size_class_for_weight(pet.weight_kg))
        for ls in self.kg.of_type("lifestage"):
            if ls.species != pet.species:
                continue
            if ls.size_classes and size not in ls.size_classes:
                continue
            lo, hi = ls.age_years.min or 0, ls.age_years.max
            if lo <= pet.age_years and (hi is None or pet.age_years < hi):
                return ls.id
        return None

    def breed_predispositions(self, pet: PetProfile) -> list[S.PredisposedTo]:
        return [p for p in self.predispositions if p.breed == pet.breed]

    # ---- safety ---------------------------------------------------------
    def screen(self, ing_id: str, pet: PetProfile, life_stage: Optional[str], predisposed: set[str],
               formulating: bool = True):
        """Return (excluded: Exclusion|None, flags: list[Flag], dose_cap_fraction|None).

        formulating=False screens something already present (e.g. a product's
        inactive ingredient) for safety only, ignoring kind/regulatory status.
        """
        ing: S.Ingredient = self.kg.nodes[ing_id]
        flags: list[Flag] = []
        cap = None
        if not formulating:
            pass
        elif ing.kind != S.IngredientKind.active.value:
            return Exclusion(ingredient=ing_id, reason=f"{ing.kind} ingredient, never formulated", facts=[]), [], None
        elif ing.regulatory_status == "not_permitted":
            return Exclusion(ingredient=ing_id, reason=f"not permitted: {ing.regulatory_notes}", facts=[]), [], None

        for t in self.toxic:
            if t.ingredient == ing_id and t.species == pet.species:
                f = _fact("TOXIC_TO", t, f"{ing.name} hazard in {pet.species}: {t.signs}")
                if t.action == "exclude":
                    return Exclusion(ingredient=ing_id, reason=f"toxic to {pet.species}", facts=[f]), [], None
                msg = f.statement + (f" (threshold {t.threshold_mg_per_kg:g} mg/kg)" if t.threshold_mg_per_kg else "")
                flags.append(Flag(ingredient=ing_id, action="vet_review", message=msg, facts=[f]))

        targets = set(pet.conditions) | ({life_stage} if life_stage else set())
        for c in self.contra:
            if c.ingredient != ing_id or pet.species not in c.species:
                continue
            via_predisposition = c.target in predisposed and c.target not in targets
            if c.target not in targets and not (via_predisposition and c.applies_to_predisposition):
                continue
            who = "breed predisposition to " if via_predisposition else ""
            f = _fact("CONTRAINDICATED_IN", c, f"{ing.name} in {who}{c.target}: {c.rationale}")
            if c.severity == S.Severity.absolute.value or c.action == S.SafetyAction.exclude.value:
                return Exclusion(ingredient=ing_id, reason=f"contraindicated in {who}{c.target}", facts=[f]), [], None
            if c.action == S.SafetyAction.reduce_dose.value:
                cap = min(cap or 1.0, c.dose_cap_fraction)
            flags.append(Flag(ingredient=ing_id, action=c.action, message=f.statement, facts=[f]))

        for m in self.interacts:
            if m.ingredient != ing_id or m.medication not in pet.medications or pet.species not in m.species:
                continue
            f = _fact("INTERACTS_WITH", m, f"{ing.name} + {m.medication} ({m.severity}): {m.mechanism}")
            if m.action == S.SafetyAction.exclude.value:
                return Exclusion(ingredient=ing_id, reason=f"interacts with {m.medication}", facts=[f]), [], None
            msg = f.statement
            if m.action == S.SafetyAction.separate_dosing.value:
                msg += f" -> give at least {m.separate_hours:g} h apart"
            if m.action == S.SafetyAction.reduce_dose.value:
                cap = min(cap or 1.0, 0.5)
            flags.append(Flag(ingredient=ing_id, action=m.action, message=msg, facts=[f]))
        return None, flags, cap

    def raw_material_for(self, ing_id: str, pet: PetProfile):
        """Best raw material delivering ing_id that avoids the pet's allergens."""
        options, blocked = [], []
        for rm in self.kg.of_type("rm"):
            prov = next((p for p in rm.provides if p.ingredient == ing_id), None)
            if not prov:
                continue
            hit = set(rm.derived_from) & set(pet.allergens)
            (blocked if hit else options).append((rm, prov, hit))
        # preferred first, then the most concentrated
        options.sort(key=lambda t: (not t[0].preferred, -(t[1].fraction or 0), t[0].id))
        return (options[0] if options else None), blocked

    # ---- dosing -----------------------------------------------------------
    def dose(self, ing_id: str, needs: list[str], pet: PetProfile, cap_fraction: Optional[float]):
        ing: S.Ingredient = self.kg.nodes[ing_id]
        w = pet.dosing_weight
        rules = [r for r in self.dose_rules if r.ingredient == ing_id and r.species == pet.species]
        specific = [r for r in rules if r.need in needs]
        rules = specific or [r for r in rules if r.need is None]
        if not rules:
            return None
        calc, facts = [], []
        best = None
        for r in rules:
            if r.basis == S.DoseBasis.weight_band.value:
                b = _band(r.bands, w)
                if b is None:
                    continue
                lo = tgt = hi = b.amount
                calc.append(f"{r.id}: weight band {b.min_kg}-{b.max_kg or '∞'} kg -> {b.amount:g} {r.unit}")
            else:
                lo, tgt, hi = (_scale(r.basis, v, w) for v in (r.min, r.target, r.max))
                calc.append(f"{r.id}: {r.target:g} {r.unit} x {self._basis_label(r.basis, w)} = {tgt:,.1f} {r.unit}")
            facts.append(_fact("DOSE_RULE", r, calc[-1]))
            if best is None or tgt > best[1]:
                best = (lo, tgt, hi, r)
        if best is None:
            return None
        lo, tgt, hi, rule = best

        ceiling = None  # safety ceiling only; the rule's max is the efficacy range, not a safety bound
        for lim in self.limits:
            if lim.ingredient == ing_id and lim.species == pet.species:
                v = lim.max if lim.basis == "per_animal" else _scale(lim.basis, lim.max, w)
                line = f"{lim.id}: {lim.kind} {lim.max:g} {lim.unit} x {self._basis_label(lim.basis, w)} = {v:,.1f}"
                calc.append(line)
                facts.append(_fact("SAFETY_LIMIT", lim, line))
                if cap_fraction is not None:
                    v *= cap_fraction
                    calc.append(f"relative contraindication caps at {cap_fraction:.0%} of limit -> {v:,.1f}")
                ceiling = v if ceiling is None else min(ceiling, v)
        if cap_fraction is not None and not any(l.ingredient == ing_id and l.species == pet.species
                                                for l in self.limits):
            ceiling = (hi or tgt) * cap_fraction
            calc.append(f"no safety limit on file; capping at {cap_fraction:.0%} of rule max -> {ceiling:,.1f}")
        dose = tgt if ceiling is None else min(tgt, ceiling)
        if lo is not None and dose < lo:
            return {"error": f"effective dose {lo:,.1f} {rule.unit} exceeds ceiling {ceiling:,.1f}",
                    "calc": calc, "facts": facts}
        if dose < tgt:
            calc.append(f"target {tgt:,.1f} clipped to ceiling {dose:,.1f}")
        return {"dose": dose, "unit": rule.unit, "range": (lo, hi), "ceiling": ceiling,
                "divided": rule.divided_doses, "calc": calc, "facts": facts, "dose_unit": ing.dose_unit}

    @staticmethod
    def _basis_label(basis: str, w: float) -> str:
        if basis == "per_kg":
            return f"{w:g} kg"
        if basis == "per_kg_0.75":
            return f"{w:g}^0.75 = {w ** 0.75:.2f} kg^0.75"
        return "1 animal"

    @staticmethod
    def raw_mass_mg(amount: float, unit: str, prov: S.Provision, overage: float) -> float:
        if unit == "CFU":
            mass = amount / prov.cfu_per_g * 1000
        elif unit == "IU":
            mass = amount / prov.iu_per_g * 1000
        else:
            mg = {"mg": amount, "mcg": amount / 1000, "g": amount * 1000, "mL": amount * 920}[unit]
            mass = mg / prov.fraction
        return mass * (1 + overage)

    # ---- manufacturing ------------------------------------------------------
    def _pack(self, form: S.DosageForm, rms: list[tuple[S.RawMaterial, float]], species: str) -> Optional[Component]:
        use = form.use_for(species)
        total = sum(m for _, m in rms) / 1000  # g
        oil = sum(m for rm, m in rms if rm.physical_form == "oil") / 1000
        cap = form.unit_mass_g.max * form.max_active_load
        units = max(1, math.ceil(total / cap - 1e-9))
        if form.max_oil_fraction is not None and oil:
            if form.max_oil_fraction == 0:
                return None
            units = max(units, math.ceil(oil / (form.unit_mass_g.max * form.max_oil_fraction) - 1e-9))
        if units > use.max_units_per_day:
            return None
        unit_mass = max(form.unit_mass_g.min or 0, total / units / form.max_active_load)
        if use.max_daily_mass_g is not None and unit_mass * units > use.max_daily_mass_g:
            return None
        return Component(form=form.id, raw_materials=[rm.id for rm, _ in rms], total_mass_g=round(total, 3),
                         units_per_day=units, unit_mass_g=round(unit_mass, 2))

    def _compatible(self, rm: S.RawMaterial, form: S.DosageForm) -> bool:
        if form.id not in {f.form for f in rm.compatible_forms}:
            return False
        if rm.heat_max_c is not None and form.process_max_temp_c is not None and form.process_max_temp_c > rm.heat_max_c:
            return False
        return True

    def manufacture(self, pet: PetProfile, lines: list[FormulaLine]) -> Manufacturing:
        if not lines:
            return Manufacturing(feasible=False, issues=["empty formula"])
        forms = [f for f in self.kg.of_type("form") if pet.species in f.species]
        rms = [(self.kg.nodes[l.raw_material], l.raw_mass_mg) for l in lines]
        issues = []
        for rm, _ in rms:
            if not any(self._compatible(rm, f) for f in forms):
                issues.append(f"{rm.id} has no dosage form usable for {pet.species}")
        if issues:
            return Manufacturing(feasible=False, issues=issues)

        best: Optional[list[Component]] = None
        # one component, then kits of 2-3 (e.g. soft chew + oil pump + enteric tablet)
        for k in (1, 2, 3):
            for combo in itertools.combinations(forms, k):
                for assignment in itertools.product(range(k), repeat=len(rms)):
                    groups = [[] for _ in range(k)]
                    ok = True
                    for (rm, m), slot in zip(rms, assignment):
                        if not self._compatible(rm, combo[slot]):
                            ok = False
                            break
                        groups[slot].append((rm, m))
                    if not ok or any(not g for g in groups):
                        continue
                    comps = [self._pack(f, g, pet.species) for f, g in zip(combo, groups)]
                    if any(c is None for c in comps):
                        continue
                    key = (len(comps), sum(c.units_per_day for c in comps))
                    if best is None or key < (len(best), sum(c.units_per_day for c in best)):
                        best = comps
            if best:
                break
        if not best:
            return Manufacturing(feasible=False, issues=["no single form or kit of up to 3 forms fits the daily mass within unit limits"])
        by_rm = {rm: c.form for c in best for rm in c.raw_materials}
        for l in lines:
            l.component = by_rm[l.raw_material]
        return Manufacturing(feasible=True, components=best)

    # ---- products --------------------------------------------------------
    def match_products(self, pet: PetProfile, lines: list[FormulaLine], excluded: dict[str, Exclusion],
                       wanted_needs: list[str], ls: Optional[str], predisposed: set[str]) -> list[ProductMatch]:
        out = []
        targets = {l.ingredient: l for l in lines}
        for p in self.kg.of_type("product"):
            if pet.species not in p.species:
                continue
            band = _band([b for b in p.dosing if b.phase == "maintenance"], pet.dosing_weight)
            if band is None:
                continue
            warnings, covers = [], {}
            for c in p.actives:
                if c.ingredient in excluded:
                    warnings.append(f"contains {c.ingredient}, excluded for this pet: {excluded[c.ingredient].reason}")
            for x in p.inactives_of_note:
                if x in pet.allergens:
                    warnings.append(f"contains allergen {x}")
                if x in excluded:
                    warnings.append(f"contains {x}: {excluded[x].reason}")
                elif x.startswith("ingredient:"):
                    ex, _, _ = self.screen(x, pet, ls, predisposed, formulating=False)
                    if ex:
                        warnings.append(f"contains {x}: {ex.reason}")
            for ing, line in targets.items():
                amt = sum((c.amount_per_unit or 0) * band.units_per_day for c in p.actives
                          if c.ingredient == ing and c.unit == line.unit)
                if amt:
                    covers[ing] = round(amt / line.dose, 2)
                    if line.ceiling and amt > line.ceiling * 1.0001:
                        warnings.append(f"{ing}: delivers {amt:,.0f} {line.unit}, above ceiling {line.ceiling:,.0f}")
            missing = [i for i in targets if i not in covers]
            p_needs = sorted({a.need for a in self.addresses for c in p.actives
                              if a.ingredient == c.ingredient and a.species == pet.species
                              and a.need in wanted_needs and GRADE_WEIGHT[a.grade] >= GRADE_WEIGHT[self.cfg.min_grade]})
            if not covers:
                continue
            # adequacy: each formula ingredient counts up to 1.0 if delivered at >= 80 % of target
            adequacy = sum(min(1.0, r / 0.8) for r in covers.values()) / max(1, len(targets))
            unsafe = any(w.startswith("contains") for w in warnings)
            score = 0.0 if unsafe else round(adequacy, 3)
            display = p.name if p.name.lower().startswith(p.brand.lower()) else f"{p.brand} {p.name}"
            out.append(ProductMatch(product=p.id, name=display, units_per_day=band.units_per_day,
                                    score=score, covers=covers, needs_covered=p_needs, missing=missing,
                                    warnings=warnings))
        out.sort(key=lambda m: (-m.score, m.product))
        return out[:5]

    # ---- main --------------------------------------------------------------
    def formulate(self, pet: PetProfile) -> Formula:
        ls = self.life_stage(pet)
        preds = self.breed_predispositions(pet)
        predisposed = {p.condition for p in preds}
        need_prio = {n.need: n.priority for n in pet.needs}
        min_w = GRADE_WEIGHT[self.cfg.min_grade]

        # 1. candidates: ingredient -> {need: Addresses}
        cands: dict[str, dict[str, S.Addresses]] = {}
        for a in self.addresses:
            if a.species == pet.species and a.need in need_prio and GRADE_WEIGHT[a.grade] >= min_w:
                cands.setdefault(a.ingredient, {})[a.need] = a

        # 2. safety screen
        excluded: dict[str, Exclusion] = {}
        flags: list[Flag] = []
        flags_by_ing: dict[str, list[Flag]] = {}
        caps: dict[str, Optional[float]] = {}
        rm_choice = {}
        for ing in sorted(cands):
            ex, fl, cap = self.screen(ing, pet, ls, predisposed)
            if ex is None:
                choice, blocked = self.raw_material_for(ing, pet)
                if choice is None:
                    why = ", ".join(sorted({a for _, _, h in blocked for a in h})) or "no raw material on file"
                    ex = Exclusion(ingredient=ing, reason=f"every raw material blocked ({why})", facts=[])
                else:
                    rm_choice[ing] = choice
            if ex:
                excluded[ing] = ex
            else:
                caps[ing] = cap
                flags_by_ing[ing] = fl
        eligible = {i: n for i, n in cands.items() if i not in excluded}

        # 3. greedy weighted set cover with per-priority coverage targets
        deficit = {n: self.cfg.coverage_target.get(p, 1) for n, p in need_prio.items()}
        chosen: list[str] = []
        while len(chosen) < self.cfg.max_actives:
            best, best_key = None, None
            for ing, by_need in eligible.items():
                if ing in chosen or self._conflicts(ing, chosen):
                    continue
                gain = sum(GRADE_WEIGHT[a.grade] * PRIORITY_WEIGHT[need_prio[n]]
                           for n, a in by_need.items() if deficit[n] > 0)
                if gain <= 0:
                    continue
                key = (gain, max(GRADE_WEIGHT[a.grade] for a in by_need.values()), ing)
                if best_key is None or key[:2] > best_key[:2] or (key[:2] == best_key[:2] and ing < best):
                    best, best_key = ing, key
            if best is None:
                break
            chosen.append(best)
            for n in eligible[best]:
                deficit[n] -= 1

        for a_ing in chosen:
            flags.extend(flags_by_ing.get(a_ing, []))
        for a_ing in chosen:
            for other, c in self._conflict_edges(a_ing, chosen):
                flags.append(Flag(ingredient=a_ing, action=c.action, message=f"{a_ing} with {other}: {c.notes}",
                                  facts=[_fact("CONFLICTS_WITH", c, c.notes)]))

        # 4-5. dose + raw material
        lines: list[FormulaLine] = []
        for ing in chosen:
            served = sorted(eligible[ing], key=lambda n: need_prio[n])
            d = self.dose(ing, served, pet, caps.get(ing))
            if d is None or "error" in d:
                reason = d["error"] if d else "no dose rule for this species"
                excluded[ing] = Exclusion(ingredient=ing, reason=reason, facts=d["facts"] if d else [])
                continue
            rm, prov, _ = rm_choice[ing]
            mass = self.raw_mass_mg(d["dose"], d["unit"], prov, rm.overage)
            facts = [_fact("ADDRESSES", eligible[ing][n],
                           f"{self.kg.nodes[ing].name} -> {n} (grade {eligible[ing][n].grade}): {eligible[ing][n].effect}")
                     for n in served] + d["facts"]
            lines.append(FormulaLine(ingredient=ing, needs=served, dose=round(d["dose"], 3), unit=d["unit"],
                                     dose_range=d["range"], ceiling=d["ceiling"], divided_doses=d["divided"],
                                     raw_material=rm.id, raw_mass_mg=round(mass, 1), calc=d["calc"], facts=facts))

        # cumulative check: secondary contributions (e.g. mussel powder also brings EPA/DHA)
        flags.extend(self._cumulative(pet, lines))

        negative = [_fact("ADDRESSES", a, f"{self.kg.nodes[a.ingredient].name} -> {a.need}: evidence of no benefit. {a.effect}")
                    for a in self.addresses if a.grade == "NEG" and a.species == pet.species and a.need in need_prio]

        covered = {n for l in lines for n in l.needs}
        unmet = [n for n in need_prio if n not in covered]
        mfg = self.manufacture(pet, lines)
        matches = self.match_products(pet, lines, excluded, list(need_prio), ls, predisposed)

        all_facts = [f for l in lines for f in l.facts] + [f for e in excluded.values() for f in e.facts] + \
                    [f for fl in flags for f in fl.facts]
        return Formula(pet_id=pet.pet_id, kg_version=self.kg.version, life_stage=ls,
                       predispositions=sorted(predisposed), lines=lines, excluded=list(excluded.values()),
                       flags=flags, unmet_needs=unmet, not_recommended=negative, manufacturing=mfg, product_matches=matches,
                       facts_used=sorted({f.edge for f in all_facts}),
                       sources_used=sorted({s for f in all_facts for s in f.sources}))

    def _conflict_edges(self, ing: str, chosen: list[str]):
        for c in self.conflicts:
            for x, y in ((c.a, c.b), (c.b, c.a)):
                if x == ing and y in chosen and x < y:
                    yield y, c

    def _conflicts(self, ing: str, chosen: list[str]) -> bool:
        return any(c.action == "avoid_combination" and {c.a, c.b} & {ing} and ({c.a, c.b} - {ing}) & set(chosen)
                   for c in self.conflicts)

    def _cumulative(self, pet: PetProfile, lines: list[FormulaLine]) -> list[Flag]:
        out = []
        by_ing = {l.ingredient: l for l in lines}
        for l in lines:
            rm: S.RawMaterial = self.kg.nodes[l.raw_material]
            for p in rm.provides:
                if p.ingredient == l.ingredient or p.ingredient not in by_ing or p.fraction is None:
                    continue
                target = by_ing[p.ingredient]
                if target.unit not in ("mg",):
                    continue
                extra = l.raw_mass_mg / (1 + rm.overage) * p.fraction
                total = target.dose + extra
                if target.ceiling and total > target.ceiling:
                    out.append(Flag(ingredient=p.ingredient, action="reduce_dose",
                                    message=f"{rm.id} adds {extra:,.0f} mg {p.ingredient}; total {total:,.0f} "
                                            f"exceeds ceiling {target.ceiling:,.0f}"))
        return out
