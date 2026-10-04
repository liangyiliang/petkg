import type { NodeType } from "./types";

export interface TypeStyle {
  label: string;
  color: string;
  shape: string; // cytoscape node shape
  family: "pet" | "knowledge" | "supply" | "evidence";
}

export const TYPE_STYLE: Record<NodeType, TypeStyle> = {
  species: { label: "Species", color: "#6366f1", shape: "ellipse", family: "pet" },
  breed: { label: "Breed", color: "#8b5cf6", shape: "ellipse", family: "pet" },
  lifestage: { label: "Life stage", color: "#a855f7", shape: "ellipse", family: "pet" },
  condition: { label: "Condition", color: "#ec4899", shape: "ellipse", family: "pet" },
  med: { label: "Medication", color: "#d946ef", shape: "ellipse", family: "pet" },
  allergen: { label: "Allergen", color: "#f59e0b", shape: "ellipse", family: "pet" },
  need: { label: "Health need", color: "#10b981", shape: "hexagon", family: "knowledge" },
  ingredient: { label: "Ingredient", color: "#0ea5e9", shape: "round-rectangle", family: "knowledge" },
  dose: { label: "Dose rule", color: "#14b8a6", shape: "round-tag", family: "knowledge" },
  limit: { label: "Safety limit", color: "#ef4444", shape: "round-tag", family: "knowledge" },
  rm: { label: "Raw material", color: "#f97316", shape: "round-diamond", family: "supply" },
  form: { label: "Dosage form", color: "#ca8a04", shape: "round-pentagon", family: "supply" },
  product: { label: "Product", color: "#65a30d", shape: "round-rectangle", family: "supply" },
  source: { label: "Source", color: "#94a3b8", shape: "rectangle", family: "evidence" },
};

export const TYPE_ORDER: NodeType[] = [
  "need", "ingredient", "dose", "limit", "condition", "med", "allergen", "species", "breed", "lifestage",
  "rm", "form", "product", "source",
];

export const REL_LABEL: Record<string, string> = {
  ADDRESSES: "addresses",
  INDICATES: "indicates",
  PREDISPOSED_TO: "predisposed to",
  TOXIC_TO: "toxic to",
  CONTRAINDICATED_IN: "contraindicated in",
  INTERACTS_WITH: "interacts with",
  CONFLICTS_WITH: "conflicts with",
  FOR_INGREDIENT: "for ingredient",
  FOR_SPECIES: "for species",
  FOR_NEED: "for need",
  PROVIDES: "provides",
  DERIVED_FROM: "derived from",
  COMPATIBLE_WITH: "compatible with",
  CONTAINS: "contains",
  HAS_INACTIVE: "has inactive",
  IN_FORM: "in form",
  CLAIMS: "claims",
  OF_SPECIES: "of species",
  SUBTYPE_OF: "subtype of",
};

/** Relations that carry safety meaning, drawn in warm colours. */
export const SAFETY_RELS = new Set(["TOXIC_TO", "CONTRAINDICATED_IN", "INTERACTS_WITH", "CONFLICTS_WITH"]);

export const GRADE_COLOR: Record<string, string> = {
  A: "#059669",
  B: "#10b981",
  C: "#6ee7b7",
  D: "#a7f3d0",
  NEG: "#94a3b8",
};

export function edgeColor(rel: string, props: Record<string, any>): string {
  if (rel === "ADDRESSES") return GRADE_COLOR[props.grade] ?? "#10b981";
  if (rel === "TOXIC_TO") return props.action === "exclude" ? "#dc2626" : "#f59e0b";
  if (rel === "CONTRAINDICATED_IN" || rel === "INTERACTS_WITH")
    return props.action === "exclude" || props.severity === "absolute" ? "#dc2626" : "#f59e0b";
  if (rel === "CONFLICTS_WITH") return "#a855f7";
  if (rel === "PREDISPOSED_TO") return "#c084fc";
  return "#94a3b8";
}

/** Short badge shown on edges and relation rows. */
export function edgeBadge(rel: string, p: Record<string, any>): string {
  switch (rel) {
    case "ADDRESSES":
      return `${p.grade} · ${short(p.species)}`;
    case "TOXIC_TO":
      return p.action;
    case "CONTRAINDICATED_IN":
      return `${p.severity} · ${p.action}`;
    case "INTERACTS_WITH":
      return p.action === "separate_dosing" ? `separate ${p.separate_hours}h` : `${p.severity} · ${p.action}`;
    case "PREDISPOSED_TO":
      return p.strength;
    case "INDICATES":
      return `P${p.priority}`;
    case "CONFLICTS_WITH":
      return p.action;
    case "PROVIDES":
      return p.fraction != null ? `${Math.round(p.fraction * 1000) / 10}%` : p.cfu_per_g != null ? `${p.cfu_per_g.toExponential(0)} CFU/g` : `${p.iu_per_g} IU/g`;
    case "CONTAINS":
      return p.amount_per_unit != null ? `${p.amount_per_unit} ${p.unit ?? ""}` : "";
    default:
      return "";
  }
}

export function short(id: string | null | undefined): string {
  if (!id) return "";
  return id.includes(":") ? id.split(":").slice(1).join(":") : id;
}

export function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}
