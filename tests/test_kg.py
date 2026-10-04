from pathlib import Path

import pytest
import yaml

from kg import schema as S
from kg.formulate import Engine, PetProfile
from kg.loader import load

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def kg():
    return load()


@pytest.fixture(scope="module")
def pets():
    raw = yaml.safe_load((ROOT / "examples" / "pets.yaml").read_text())
    return {p["pet_id"]: PetProfile.model_validate(p) for p in raw}


@pytest.fixture(scope="module")
def formulas(kg, pets):
    eng = Engine(kg)
    return {pid: eng.formulate(p) for pid, p in pets.items()}


# ---- integrity ---------------------------------------------------------------

def test_loads_without_errors(kg):
    assert kg.version
    assert len(kg.nodes) > 100


def test_every_edge_cites_a_source(kg):
    for rel, edges in kg.edges.items():
        for e in edges:
            assert e.sources, f"{rel} edge without sources"


def test_hazards_are_never_recommended(kg):
    hazards = {n.id for n in kg.of_type("ingredient") if n.kind == "hazard"}
    assert not [a for a in kg.rel("ADDRESSES") if a.ingredient in hazards]


def test_toxic_ingredients_have_no_dose_rule_for_that_species(kg):
    toxic = {(t.ingredient, t.species) for t in kg.rel("TOXIC_TO") if t.action == "exclude"}
    clash = [r.id for r in kg.rel("DOSE_RULE") if (r.ingredient, r.species) in toxic]
    assert not clash


def test_dose_targets_are_below_safety_limits(kg):
    limits = {(l.ingredient, l.species, l.basis): l.max for l in kg.rel("SAFETY_LIMIT")}
    for r in kg.rel("DOSE_RULE"):
        cap = limits.get((r.ingredient, r.species, r.basis))
        if cap is not None and r.target is not None:
            assert r.target <= cap, r.id


def test_absolute_contraindication_requires_exclude():
    with pytest.raises(ValueError):
        S.ContraindicatedIn(ingredient="ingredient:x", target="condition:y", severity="absolute",
                            action="monitor", rationale="r", sources=["source:z"])


# ---- engine behaviour on the synthetic pets ----------------------------------

def _ingredients(f):
    return {l.ingredient for l in f.lines}


def _excluded(f):
    return {e.ingredient: e.reason for e in f.excluded}


def test_formulas_are_deterministic(kg, pets):
    eng = Engine(kg)
    a = eng.formulate(pets["demo-luna"]).model_dump()
    b = eng.formulate(pets["demo-luna"]).model_dump()
    assert a == b


def test_every_need_is_covered_or_reported(formulas, pets):
    for pid, f in formulas.items():
        wanted = {n.need for n in pets[pid].needs}
        covered = {n for l in f.lines for n in l.needs}
        assert wanted == covered | set(f.unmet_needs), pid


def test_doses_never_exceed_ceiling(formulas):
    for f in formulas.values():
        for l in f.lines:
            if l.ceiling is not None:
                assert l.dose <= l.ceiling + 1e-6, (f.pet_id, l.ingredient)


def test_every_line_is_explained_by_addresses_and_dose_facts(formulas):
    for f in formulas.values():
        for l in f.lines:
            kinds = {x.kind for x in l.facts}
            assert {"ADDRESSES", "DOSE_RULE"} <= kinds, (f.pet_id, l.ingredient)
            assert all(x.sources for x in l.facts)


def test_cat_never_gets_alpha_lipoic_acid(formulas):
    assert "ingredient:alpha_lipoic_acid" not in _ingredients(formulas["demo-miso"])


def test_allergen_derived_raw_materials_are_not_used(kg, formulas, pets):
    f, pet = formulas["demo-pepper"], pets["demo-pepper"]
    for l in f.lines:
        assert not set(kg.nodes[l.raw_material].derived_from) & set(pet.allergens)


def test_probiotic_with_antibiotic_is_separated(formulas):
    f = formulas["demo-pepper"]
    probiotics = {l.ingredient for l in f.lines if "probiotic" in l.ingredient or "faecium" in l.ingredient
                  or "bifidobacterium" in l.ingredient}
    if probiotics:
        assert any(fl.action == "separate_dosing" and fl.ingredient in probiotics for fl in f.flags)


def test_formulas_are_manufacturable(formulas):
    for f in formulas.values():
        assert f.manufacturing.feasible, (f.pet_id, f.manufacturing.issues)


def test_negative_evidence_is_reported_not_formulated(formulas):
    f = formulas["demo-miso"]  # cat with a joint need: glucosamine is NEG in cats
    assert "ingredient:glucosamine" not in _ingredients(f)
    assert any("glucosamine" in x.edge for x in f.not_recommended)


def test_flags_only_concern_chosen_ingredients(formulas):
    for f in formulas.values():
        chosen = _ingredients(f)
        assert all(fl.ingredient in chosen for fl in f.flags if fl.ingredient), f.pet_id


def test_breed_predisposition_triggers_precautionary_exclusion(kg):
    """A Bedlington with no diagnosis still never gets copper."""
    eng = Engine(kg)
    pet = PetProfile(pet_id="t", species="species:dog", breed="breed:bedlington_terrier", age_years=4,
                     weight_kg=9, needs=[{"need": "need:skin_coat_barrier", "priority": 1}])
    ex, _, _ = eng.screen("ingredient:copper", pet, eng.life_stage(pet), {p.condition for p in eng.breed_predispositions(pet)})
    assert ex is not None and "predisposition" in ex.reason


def test_drug_interaction_exclusion(kg):
    """SAMe + selegiline is an 'avoid' interaction: SAMe must not appear."""
    eng = Engine(kg)
    pet = PetProfile(pet_id="t", species="species:dog", age_years=12, weight_kg=20,
                     conditions=["condition:hepatopathy"], medications=["med:selegiline"],
                     needs=[{"need": "need:hepatic_support", "priority": 1}, {"need": "need:cognitive_aging", "priority": 2}])
    f = eng.formulate(pet)
    assert "ingredient:same" not in _ingredients(f)
    assert "ingredient:same" in _excluded(f)


def test_cat_powder_and_oil_respect_daily_mass(kg, formulas):
    f = formulas["demo-miso"]
    for c in f.manufacturing.components:
        use = kg.nodes[c.form].use_for("species:cat")
        if use.max_daily_mass_g:
            assert c.units_per_day * c.unit_mass_g <= use.max_daily_mass_g + 1e-6
