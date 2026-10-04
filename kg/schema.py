"""Typed schema for the Freyja supplement knowledge graph.

The graph holds population-level knowledge only (what ingredients do, for which
species, at what dose, and when they are unsafe). Individual pet records live in
the operational database and are passed to the engine as a `PetProfile`.

Every node has a globally unique id of the form ``<type>:<slug>``. Every edge
and every reified relation (DoseRule, SafetyLimit) carries ``sources`` and a
``curation`` block, so any fact the engine uses can be traced back to a
citation and to the person who reviewed it.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --------------------------------------------------------------------------
# Enumerations
# --------------------------------------------------------------------------


class SpeciesId(str, Enum):
    dog = "species:dog"
    cat = "species:cat"


class EvidenceGrade(str, Enum):
    """Strength of species-specific evidence that an ingredient helps a need.

    A   multiple RCTs or a systematic review in the target species, consistent
    B   at least one controlled trial in the species, or mixed RCT results
    C   uncontrolled studies in the species, or strong cross-species data
    D   mechanistic / in-vitro / expert opinion only
    NEG good species evidence of no effect (kept so it is never recommended)
    """

    A = "A"
    B = "B"
    C = "C"
    D = "D"
    NEG = "NEG"


class IngredientKind(str, Enum):
    active = "active"  # may be dosed in a formula
    excipient = "excipient"  # carrier, palatant, binder; screened but not dosed
    hazard = "hazard"  # never formulated; exists so screens can catch it


class DoseBasis(str, Enum):
    per_kg = "per_kg"  # amount x BW(kg)
    per_kg_0_75 = "per_kg_0.75"  # amount x BW(kg)^0.75 (metabolic body weight)
    per_animal = "per_animal"  # fixed amount regardless of size
    weight_band = "weight_band"  # look up table of (min_kg, max_kg) -> amount


class Unit(str, Enum):
    mg = "mg"
    mcg = "mcg"
    g = "g"
    IU = "IU"
    CFU = "CFU"
    mL = "mL"


class Severity(str, Enum):
    absolute = "absolute"  # remove the ingredient
    relative = "relative"  # keep only with an action (cap, vet review, monitor)


class SafetyAction(str, Enum):
    exclude = "exclude"
    vet_review = "vet_review"
    reduce_dose = "reduce_dose"
    monitor = "monitor"
    separate_dosing = "separate_dosing"


class InteractionSeverity(str, Enum):
    major = "major"
    moderate = "moderate"
    minor = "minor"


class CurationStatus(str, Enum):
    draft = "draft"  # entered from literature, not yet reviewed
    reviewed = "reviewed"  # checked by a second curator
    vet_approved = "vet_approved"  # signed off by a veterinary nutritionist


class SourceType(str, Enum):
    systematic_review = "systematic_review"
    rct = "rct"
    controlled_trial = "controlled_trial"
    observational = "observational"
    case_report = "case_report"
    study = "study"  # primary study, design not yet classified
    review = "review"
    textbook = "textbook"
    regulatory = "regulatory"
    consensus_guideline = "consensus_guideline"
    product_label = "product_label"
    industry = "industry"
    internal = "internal"  # Freyja outcome data (step 4 feedback)


# --------------------------------------------------------------------------
# Shared building blocks
# --------------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class Curation(_Strict):
    status: CurationStatus = CurationStatus.draft
    reviewer: Optional[str] = None
    reviewed_on: Optional[date] = None
    notes: Optional[str] = None


class Range(_Strict):
    min: Optional[float] = None
    max: Optional[float] = None

    @model_validator(mode="after")
    def _ordered(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"range min {self.min} > max {self.max}")
        return self


class Provenance(_Strict):
    """Mixed into every edge / reified fact."""

    sources: list[str] = Field(default_factory=list, description="source:* ids")
    curation: Curation = Field(default_factory=Curation)


# --------------------------------------------------------------------------
# Nodes
# --------------------------------------------------------------------------


class Node(_Strict):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    description: Optional[str] = None


class Species(Node):
    metabolic_exponent: float = 0.75
    notes: Optional[str] = None


class LifeStage(Node):
    species: SpeciesId
    # Age window in years. For dogs the senior threshold depends on size class.
    age_years: Range
    size_classes: list[str] = Field(default_factory=list, description="empty = all")
    sources: list[str] = Field(default_factory=list)


class Breed(Node):
    species: SpeciesId
    size_class: Optional[Literal["toy", "small", "medium", "large", "giant"]] = None
    adult_weight_kg: Optional[Range] = None


class Condition(Node):
    category: str
    physiological_state: bool = False  # e.g. pregnancy: not a disease, still gates safety
    species: list[SpeciesId] = Field(default_factory=lambda: [SpeciesId.dog, SpeciesId.cat])


class HealthNeed(Node):
    """Output of step 1 rules, input to step 2. The unit of formulation."""

    parent: Optional[str] = None  # need:* id for a broader need
    customer_label: str


class Allergen(Node):
    """Protein / material source a pet may be allergic to (beef, fish, shellfish ...)."""


class Ingredient(Node):
    kind: IngredientKind
    category: str  # fatty_acid, glycosaminoglycan, botanical, probiotic, vitamin ...
    dose_unit: Optional[Unit] = None  # unit DoseRules are written in
    regulatory_status: Literal["permitted", "restricted", "not_permitted"] = "permitted"
    regulatory_notes: Optional[str] = None
    sources: list[str] = Field(default_factory=list)


class Medication(Node):
    drug_class: str
    examples: list[str] = Field(default_factory=list)


class SpeciesUse(_Strict):
    """Practical administration limits for one species."""

    species: SpeciesId
    max_units_per_day: int
    max_daily_mass_g: Optional[float] = None  # e.g. cats refuse food with > ~1 g powder on it
    acceptance: Literal["high", "moderate", "low"] = "moderate"


class DosageForm(Node):
    unit_mass_g: Range
    max_active_load: float = Field(ge=0, le=1, description="fraction of unit mass that can be actives")
    max_oil_fraction: Optional[float] = Field(default=None, ge=0, le=1)
    process_max_temp_c: Optional[float] = None  # peak temperature the blend sees
    species_use: list[SpeciesUse]
    notes: Optional[str] = None
    sources: list[str] = Field(default_factory=list)

    @property
    def species(self) -> list[str]:
        return [u.species for u in self.species_use]

    def use_for(self, species: str) -> Optional[SpeciesUse]:
        return next((u for u in self.species_use if u.species == species), None)


class Provision(_Strict):
    """How much of an ingredient a raw material delivers."""

    ingredient: str  # ingredient:* id
    fraction: Optional[float] = Field(default=None, gt=0, le=1, description="w/w")
    cfu_per_g: Optional[float] = None
    iu_per_g: Optional[float] = None

    @model_validator(mode="after")
    def _exactly_one(self):
        given = [v for v in (self.fraction, self.cfu_per_g, self.iu_per_g) if v is not None]
        if len(given) != 1:
            raise ValueError("Provision needs exactly one of fraction / cfu_per_g / iu_per_g")
        return self


class FormCompatibility(_Strict):
    form: str  # form:* id
    notes: Optional[str] = None


class RawMaterial(Node):
    """A purchasable input. Formulas are dosed in ingredients, built from raw materials."""

    physical_form: Literal["powder", "oil", "liquid", "granule", "paste"]
    provides: list[Provision]
    derived_from: list[str] = Field(default_factory=list, description="allergen:* ids")
    heat_max_c: Optional[float] = None
    moisture_sensitive: bool = False
    light_sensitive: bool = False
    oxidation_sensitive: bool = False
    requires_enteric_coating: bool = False
    palatability: Literal["good", "neutral", "poor"] = "neutral"
    overage: float = Field(default=0.0, ge=0, description="extra fraction added to cover shelf-life loss")
    compatible_forms: list[FormCompatibility]
    preferred: bool = False
    sources: list[str] = Field(default_factory=list)


class WeightBand(_Strict):
    min_kg: float = 0
    max_kg: Optional[float] = None
    units_per_day: float
    phase: Literal["maintenance", "loading"] = "maintenance"


class ProductComponent(_Strict):
    ingredient: Optional[str] = None  # ingredient:* id, None if it does not map
    label_name: str
    amount_per_unit: Optional[float] = None
    unit: Optional[Unit] = None
    verified: bool = True


class Product(Node):
    brand: str
    manufacturer: str
    species: list[SpeciesId]
    form: str  # form:* id
    unit_name: str
    actives: list[ProductComponent]
    inactives_of_note: list[str] = Field(default_factory=list, description="ingredient:* or allergen:* ids")
    dosing: list[WeightBand] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list, description="need:* ids")
    nasc_seal: Optional[bool] = None
    source_url: str
    retrieved: date
    verification: Literal["label_confirmed", "retailer_listing", "unverified"]
    notes: Optional[str] = None


class Source(_Strict):
    id: str
    type: SourceType
    citation: str
    year: Optional[int] = None
    pmid: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None


# --------------------------------------------------------------------------
# Edges (all carry provenance)
# --------------------------------------------------------------------------


class Addresses(Provenance):
    """Ingredient -> HealthNeed, for one species."""

    ingredient: str
    need: str
    species: SpeciesId
    grade: EvidenceGrade
    effect: str
    mechanism: Optional[str] = None
    onset_weeks: Optional[float] = None
    caveats: Optional[str] = None


class Indicates(Provenance):
    """Condition -> HealthNeed. Bridge used by the step-1 rules."""

    condition: str
    need: str
    priority: Literal[1, 2, 3] = 2  # 1 = primary


class PredisposedTo(Provenance):
    """Breed -> Condition."""

    breed: str
    condition: str
    strength: Literal["strong", "moderate", "reported"] = "moderate"
    genetic_test: Optional[str] = None


class ToxicTo(Provenance):
    """Ingredient -> Species hazard.

    exclude    never formulate for this species
    vet_review allowed only after vet review (e.g. phenolics in cats, theoretical)
    dose_cap   safe below a threshold; the dose must stay well under it
    """

    ingredient: str
    species: SpeciesId
    action: Literal["exclude", "vet_review", "dose_cap"] = "exclude"
    threshold_mg_per_kg: Optional[float] = None
    signs: str
    evidence_strength: Optional[str] = None
    notes: Optional[str] = None


class ContraindicatedIn(Provenance):
    """Ingredient -> Condition or LifeStage."""

    ingredient: str
    target: str  # condition:* or lifestage:* id
    species: list[SpeciesId] = Field(default_factory=lambda: [SpeciesId.dog, SpeciesId.cat])
    severity: Severity
    action: SafetyAction
    dose_cap_fraction: Optional[float] = Field(default=None, gt=0, le=1,
                                               description="for reduce_dose: fraction of SUL allowed")
    applies_to_predisposition: bool = False  # also fire if the breed is merely predisposed
    rationale: str
    evidence_strength: Optional[str] = None

    @model_validator(mode="after")
    def _consistent(self):
        if self.severity == Severity.absolute.value and self.action != SafetyAction.exclude.value:
            raise ValueError("absolute contraindications must use action=exclude")
        if self.action == SafetyAction.reduce_dose.value and self.dose_cap_fraction is None:
            raise ValueError("reduce_dose needs dose_cap_fraction")
        return self


class InteractsWith(Provenance):
    """Ingredient -> Medication (drug class)."""

    ingredient: str
    medication: str
    species: list[SpeciesId] = Field(default_factory=lambda: [SpeciesId.dog, SpeciesId.cat])
    severity: InteractionSeverity
    action: SafetyAction
    separate_hours: Optional[float] = None
    mechanism: str
    evidence_strength: Optional[str] = None

    @model_validator(mode="after")
    def _hours(self):
        if self.action == SafetyAction.separate_dosing.value and not self.separate_hours:
            raise ValueError("separate_dosing needs separate_hours")
        return self


class ConflictsWith(Provenance):
    """Ingredient <-> Ingredient issue when blended or co-dosed."""

    a: str
    b: str
    kind: Literal["absorption_competition", "chemical_degradation", "process_incompatibility",
                  "redundant_mechanism", "additive_risk"]
    action: Literal["separate_units", "avoid_combination", "vet_review", "monitor"]
    notes: str


# --------------------------------------------------------------------------
# Reified relations (become nodes in a property graph)
# --------------------------------------------------------------------------


class DoseBand(_Strict):
    min_kg: float = 0
    max_kg: Optional[float] = None
    amount: float


class DoseRule(Provenance):
    """How much of an ingredient to give one species, optionally for one need."""

    id: str
    ingredient: str
    species: SpeciesId
    need: Optional[str] = None  # None = applies to any need
    basis: DoseBasis
    unit: Unit
    min: Optional[float] = None
    target: Optional[float] = None
    max: Optional[float] = None
    bands: list[DoseBand] = Field(default_factory=list, description="for basis=weight_band")
    divided_doses: int = 1
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _shape(self):
        if self.basis == DoseBasis.weight_band.value:
            if not self.bands:
                raise ValueError(f"{self.id}: weight_band rule needs bands")
        elif self.target is None:
            raise ValueError(f"{self.id}: target dose required")
        lo, hi = self.min, self.max
        if self.target is not None and ((lo is not None and self.target < lo) or (hi is not None and self.target > hi)):
            raise ValueError(f"{self.id}: target outside [min, max]")
        return self


class SafetyLimit(Provenance):
    """Hard ceiling for an ingredient in a species (e.g., NRC safe upper limit)."""

    id: str
    ingredient: str
    species: SpeciesId
    basis: DoseBasis
    unit: Unit
    max: float
    kind: Literal["safe_upper_limit", "noael", "regulatory_max", "company_policy"]
    notes: Optional[str] = None
