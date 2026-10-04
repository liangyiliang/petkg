// Shapes returned by server/app.py. Formula types mirror kg/formulate.py.

export type NodeType =
  | "species" | "breed" | "lifestage" | "condition" | "need" | "allergen" | "ingredient"
  | "med" | "form" | "rm" | "product" | "source" | "dose" | "limit";

export interface KGNode {
  id: string;
  type: NodeType;
  kind: string;
  name: string;
  props: Record<string, any>;
}

export interface KGEdge {
  id: string;
  rel: string;
  source: string;
  target: string;
  props: Record<string, any>;
}

export interface GraphPayload {
  version: string;
  nodes: KGNode[];
  edges: KGEdge[];
}

export interface Meta {
  version: string;
  node_counts: Record<string, number>;
  relation_counts: Record<string, number>;
  curation: Record<string, number>;
  warnings: string[];
  reload_problems: string[];
}

export interface NeedRequest { need: string; priority: number }

export interface PetProfile {
  pet_id: string;
  species: string;
  breed?: string | null;
  age_years: number;
  weight_kg: number;
  ideal_weight_kg?: number | null;
  conditions: string[];
  medications: string[];
  allergens: string[];
  needs: NeedRequest[];
}

export interface EngineConfig { min_grade: string; max_actives: number }

export interface Fact {
  kind: string;
  edge: string;
  statement: string;
  sources: string[];
  curation: string | null;
}

export interface Exclusion { ingredient: string; reason: string; facts: Fact[] }
export interface Flag { ingredient: string | null; action: string; message: string; facts: Fact[] }

export interface FormulaLine {
  ingredient: string;
  needs: string[];
  dose: number;
  unit: string;
  dose_range: [number | null, number | null];
  ceiling: number | null;
  divided_doses: number;
  raw_material: string;
  raw_mass_mg: number;
  component: string | null;
  calc: string[];
  facts: Fact[];
}

export interface Component {
  form: string;
  raw_materials: string[];
  total_mass_g: number;
  units_per_day: number;
  unit_mass_g: number;
}

export interface ProductMatch {
  product: string;
  name: string;
  units_per_day: number;
  score: number;
  covers: Record<string, number>;
  needs_covered: string[];
  missing: string[];
  warnings: string[];
}

export interface Formula {
  pet_id: string;
  kg_version: string;
  life_stage: string | null;
  predispositions: string[];
  lines: FormulaLine[];
  excluded: Exclusion[];
  flags: Flag[];
  unmet_needs: string[];
  not_recommended: Fact[];
  manufacturing: { feasible: boolean; components: Component[]; issues: string[] };
  product_matches: ProductMatch[];
  facts_used: string[];
  sources_used: string[];
}
