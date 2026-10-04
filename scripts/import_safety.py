"""One-off importer: safety research YAML -> data/edges/{toxicity,contraindications,interactions}.yaml.

Kept in the repo so the mapping from research vocabulary to KG ids is reviewable.
Re-running overwrites the three edge files and data/sources/safety.yaml.
"""

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1])

# research ingredient vocabulary -> KG ingredient ids ([] = deliberately not imported)
ING = {
    "xylitol": ["xylitol"], "alpha_lipoic_acid": ["alpha_lipoic_acid"],
    "allium_onion_garlic_leek_chive": ["allium_garlic_onion"], "garlic": ["allium_garlic_onion"],
    "tea_tree_oil_melaleuca": ["tea_tree_oil"], "essential_oils_group": ["essential_oils"], "essential_oils": ["essential_oils"],
    "eucalyptus_oil": ["essential_oils"], "sage_oil": ["essential_oils"], "hyssop_oil": ["essential_oils"],
    "pennyroyal": ["essential_oils"], "wintergreen_oil": ["essential_oils"], "wormwood": ["essential_oils"],
    "birch_oil": ["essential_oils"], "cedar_oil": ["essential_oils"], "camphor_unverified": [], "rosemary_oil_unverified": [],
    "propylene_glycol": ["propylene_glycol"], "propylene_glycol_cat": ["propylene_glycol"],
    "grape": ["grape_raisin_tartaric_acid"], "raisin": [], "sultana": [], "currant_vitis": [], "tamarind": [],
    "cream_of_tartar_potassium_bitartrate": [], "tartaric_acid": [], "grape_seed_extract_vet_review": [],
    "vitamin_d3_cholecalciferol": ["vitamin_d3"], "vitamin_d3": ["vitamin_d3"], "vitamin_d3_supplemental": ["vitamin_d3"],
    "vitamin_d2": [], "calcitriol_containing_products": [],
    "iron_elemental": ["iron"], "iron": ["iron"], "iron_ferrous_sulfate": ["iron"],
    "vitamin_a_retinol": ["vitamin_a"], "vitamin_a_high_dose": ["vitamin_a"], "vitamin_a_high_dose_incl_cod_liver_oil": ["vitamin_a"],
    "white_willow_bark_salicin": ["white_willow_bark"], "white_willow_bark": ["white_willow_bark"], "meadowsweet_unverified": [],
    "meadowsweet": [], "wintergreen_oil_methyl_salicylate": ["essential_oils"], "aspirin_like_salicylates": [], "wintergreen": ["essential_oils"],
    "5_htp_5_hydroxytryptophan_griffonia": ["five_htp"], "5_htp": ["five_htp"],
    "caffeine": ["caffeine_methylxanthines"], "guarana": ["caffeine_methylxanthines"], "yerba_mate": [], "kola_nut": [],
    "green_tea_extract_caffeinated": ["caffeine_methylxanthines"], "cocoa_theobromine": ["caffeine_methylxanthines"], "cacao": [],
    "green_tea_extract_egcg_decaffeinated": ["green_tea_extract"], "green_tea_extract_egcg": ["green_tea_extract"],
    "macadamia_nut": ["macadamia"], "hops_humulus_lupulus": ["hops"], "hops": ["hops"],
    "ephedra_ma_huang": ["ephedra"], "ephedrine": [], "synephrine_bitter_orange_unverified": [], "ephedra": ["ephedra"],
    "synephrine_unverified": [], "yohimbe_yohimbine": ["yohimbe"], "yohimbe": ["yohimbe"],
    "kava_piper_methysticum": ["kava"], "kava": ["kava"], "nutmeg_myristicin": ["nutmeg"],
    "benzoic_acid": ["benzoic_acid"], "sodium_benzoate": [], "zinc_high_dose": ["zinc"], "zinc": ["zinc"],
    "omega3_fish_oil_high_dose": ["omega3_epa_dha"], "omega3_fish_oil": ["omega3_epa_dha"], "fish_oil": ["omega3_epa_dha"],
    "salmon_oil": [], "glucosamine": ["glucosamine"],
    # allergen-driven exclusions are handled at raw-material level (derived_from), not here
    "glucosamine_crustacean_derived": [], "green_lipped_mussel_perna_canaliculus": [], "krill_oil": [], "chitosan": [],
    "copper_any_form": ["copper"], "copper_rich_ingredients_liver_organ_meat_shellfish": [], "copper_supplemental": ["copper"],
    "silymarin_milk_thistle": ["silybin"], "silymarin_silybin_milk_thistle": ["silybin"],
    "brewers_yeast": ["brewers_yeast"], "yeast_extract": ["brewers_yeast"], "nucleotides": [], "organ_meats_liver_kidney": [],
    "sardine_anchovy_fish_meal": [], "high_purine_protein_powders": [], "organ_meats": [], "high_purine_ingredients": ["brewers_yeast"],
    "dl_methionine": ["dl_methionine"], "ammonium_chloride": [], "cranberry_high_dose": ["cranberry_pac"],
    "vitamin_c_high_dose": ["vitamin_c"], "vitamin_c_ascorbic_acid_supplemental": ["vitamin_c"], "cranberry_extract": ["cranberry_pac"],
    "calcium_supplemental": ["calcium_carbonate"], "potassium_citrate": ["potassium_citrate"], "sodium_bicarbonate": [],
    "alkalinizing_supplements": [], "calcium_carbonate": ["calcium_carbonate"], "calcium_lactate_gluconate": [],
    "calcium_containing_phosphate_binders": ["chitosan_calcium_carbonate"], "chitosan_calcium_carbonate_binders": ["chitosan_calcium_carbonate"],
    "chitosan_calcium_binders": ["chitosan_calcium_carbonate"], "calcium": ["calcium_carbonate"], "phosphate_binders": ["chitosan_calcium_carbonate"],
    "bone_meal": ["bone_meal_phosphates"], "dicalcium_phosphate": [], "sodium_phosphate": [], "phosphorus_rich_protein_powders": [],
    "phosphorus_supplements": [], "potassium_gluconate_citrate": [], "potassium_gluconate": ["potassium_citrate"],
    "melatonin": ["melatonin"], "molasses": [], "honey": [], "glucose_syrup": [], "maltodextrin_high_load": [],
    "mct_oil_coconut_oil": ["mct_oil"], "mct_oil": ["mct_oil"], "coconut_oil": [],
    "probiotics_live_bacteria": ["enterococcus_faecium_sf68", "bifidobacterium_longum_bl999", "multistrain_probiotic"],
    "probiotics_live": ["enterococcus_faecium_sf68", "bifidobacterium_longum_bl999", "multistrain_probiotic"],
    "synbiotics": [], "saccharomyces_boulardii": [],
    "vitamin_e_high_dose": ["vitamin_e"], "turmeric_curcumin": ["curcumin"], "curcumin_high_dose": ["curcumin"],
    "ginkgo": ["ginkgo_biloba"], "ginkgo_biloba": ["ginkgo_biloba"], "ginger_high_dose": [],
    "st_johns_wort_hypericum": ["st_johns_wort"], "st_johns_wort": ["st_johns_wort"],
    "salt_sodium_chloride": ["sodium_chloride"], "sodium_chloride_salt": ["sodium_chloride"], "high_sodium_treat_bases": [], "high_sodium_supplements": [],
    "potassium_supplements": ["potassium_citrate"], "potassium_chloride": ["potassium_citrate"], "salt_substitutes": [],
    "kelp": ["kelp_iodine"], "seaweed": [], "iodine": ["kelp_iodine"], "potassium_iodide": [], "bladderwrack": [],
    "soy_isoflavones_genistein": ["soy_isoflavones"], "soy_isoflavones": ["soy_isoflavones"],
    "flavored_chewable_bases_pork_liver_chicken_beef": [], "gelatin": [], "collagen": [], "chicken_cartilage": [],
    "egg_membrane": [], "fish_protein": [], "dairy_colostrum": [], "whey": [], "flavored_chewable_bases": [], "beef_gelatin": [],
    "l_theanine": [], "l_tryptophan": [], "l_tryptophan_high_dose": ["l_tryptophan"],
    "magnesium": [], "aluminum": [], "sucralfate": [], "antacids": [], "mineral_supplements": [], "dairy_colostrum_unverified": [],
    "oral_absorbents_kaolin_activated_charcoal": [], "soy_unverified": [], "high_fibre_unverified": [],
    "magnesium_hydroxide": [], "aluminum_hydroxide": [], "magnesium_supplements_unverified": [],
    "same_s_adenosylmethionine": ["same"], "tyramine_rich_ingredients_aged_cheese_yeast_extract_unverified": [],
    "high_chloride_supplements": [], "electrolyte_powders": [], "valerian": [], "chromium_picolinate": [],
    "psyllium": ["psyllium"], "insoluble_fibre_cellulose": [], "soluble_fibre": [], "cinnamon_cassia": [],
    "licorice_root_glycyrrhizin": [], "hawthorn_crataegus_unverified": [], "beta_carotene": [], "n_acetylcysteine": [],
    "selenium_high_dose": [], "coq10_high_dose": ["coenzyme_q10"], "high_dose_polyphenols": [], "none_documented": [],
    "glucuronidation_dependent_compounds": [],
}
# cat glucuronidation caution list -> vet_review TOXIC_TO edges
GLUC_CAT = {"curcumin": "curcumin", "egcg_green_tea": "green_tea_extract", "silymarin_silybin": "silybin"}

COND = {"any": None, "critically_ill": "immunosuppressed",
        "gallbladder_disease_biliary_obstruction": "gallbladder_disease", "shellfish_allergy": None}
DRUG = {"d_penicillamine": "d_penicillamine", "allopurinol": "allopurinol", "oclacitinib_unverified": None}


def as_list(x):
    return x if isinstance(x, list) else [x]


def map_ing(name, unmapped):
    if name not in ING:
        unmapped.add(name)
        return []
    return [f"ingredient:{i}" for i in ING[name]]


sources = {}


def cite(cits, level):
    out = []
    typ = {"controlled_study_target_species": "controlled_trial", "extrapolated_human": "study",
           "mechanistic_theoretical": "review", "consensus_guideline": "consensus_guideline",
           "reference_text": "textbook", "case_series_target_species": "case_report",
           "regulatory": "regulatory", "case_report_target_species": "case_report"}[level]
    for c in cits:
        ref = (c.get("ref") or "").strip()
        if c.get("pmid"):
            sid = f"source:pmid_{str(c['pmid']).strip()}"
        elif c.get("doi"):
            sid = "source:doi_" + re.sub(r"[^a-z0-9]+", "_", c["doi"].lower()).strip("_")
        else:
            sid = "source:" + re.sub(r"[^a-z0-9]+", "_", ref.lower())[:60].strip("_")
        rec = sources.setdefault(sid, {"id": sid, "type": typ, "citation": ref or sid})
        if c.get("pmid"):
            rec["pmid"] = str(c["pmid"]).strip()
        if c.get("doi"):
            rec["doi"] = c["doi"]
        if c.get("url"):
            rec["url"] = c["url"]
        if not c.get("verified"):
            rec["notes"] = "not verified in research pass"
        m = re.search(r"(19|20)\d\d", ref)
        if m:
            rec["year"] = int(m.group(0))
        out.append(sid)
    if not out:  # reasoned rule with no citation: say so explicitly instead of dropping it
        out.append("source:freyja_curator_reasoning")
    return list(dict.fromkeys(out))


def species(sp):
    return ["species:dog", "species:cat"] if sp in ("both", None) else [f"species:{sp}"]


def curation(x, extra=""):
    note = f"evidence_level={x['evidence_level']}; strength={x.get('evidence_strength', '?')}"
    if x.get("notes"):
        note += "; " + str(x["notes"]).strip()
    return {"status": "draft", "notes": (note + extra)[:500]}


def main():
    d = yaml.safe_load(SRC.read_text())
    unmapped, skipped = set(), []
    tox, contra, inter = {}, {}, {}

    for x in d["species_toxicity"]:
        names = as_list(x["ingredient"])
        ids = [i for n in names for i in map_ing(n, unmapped)]
        if x["ingredient"] == "glucuronidation_dependent_compounds":
            ids = [f"ingredient:{GLUC_CAT[m]}" for m in x["members"]["theoretical_caution_no_cat_toxicity_data"] if m in GLUC_CAT]
        act = {"exclude": "exclude", "vet_review": "vet_review", "dose_cap": "dose_cap"}[x["filter_action"]]
        thr = None
        for t in as_list(x.get("toxic_dose") or []):
            if isinstance(t, dict) and isinstance(t.get("threshold_mg_per_kg"), (int, float)):
                thr = t["threshold_mg_per_kg"] if thr is None else min(thr, t["threshold_mg_per_kg"])
        signs = ", ".join(map(str, x.get("clinical_signs") or [])) or str(x.get("notes", ""))[:200]
        for ing in dict.fromkeys(ids):
            for sp in species(x["species"]):
                key = (ing, sp)
                e = {"ingredient": ing, "species": sp, "action": act, "signs": signs[:300] or "see notes",
                     "evidence_strength": x["evidence_level"], "sources": cite(x["citations"], x["evidence_level"]),
                     "curation": curation(x)}
                if thr is not None:
                    e["threshold_mg_per_kg"] = thr
                rank = {"exclude": 0, "dose_cap": 1, "vet_review": 2}
                if key not in tox or rank[act] < rank[tox[key]["action"]]:
                    tox[key] = e

    for x in d["condition_contraindications"]:
        if x["severity"] == "none":
            skipped.append(f"safe-in record kept out of filter: {x['id']}")
            continue
        conds = [COND.get(c, c) for c in as_list(x["condition"])]
        ids = [i for n in as_list(x["ingredient"]) for i in map_ing(n, unmapped)]
        action = {"exclude": "exclude", "vet_review": "vet_review", "monitor": "monitor",
                  "reduce_dose": "reduce_dose"}[x["action"]]
        for c in conds:
            if c is None:
                skipped.append(f"{x['id']}: condition handled elsewhere")
                continue
            for ing in dict.fromkeys(ids):
                e = {"ingredient": ing, "target": f"condition:{c}", "species": species(x["species"]),
                     "severity": x["severity"], "action": action, "rationale": str(x["rationale"]).strip()[:400],
                     "evidence_strength": x["evidence_strength"],
                     "sources": cite(x["citations"], x["evidence_level"]), "curation": curation(x)}
                if action == "reduce_dose":
                    e["dose_cap_fraction"] = 0.5
                    e["curation"]["notes"] += "; dose_cap_fraction 0.5 is a Freyja default, not from the source"
                if c in ("copper_storage_hepatopathy", "urate_urolithiasis"):
                    e["applies_to_predisposition"] = True
                key = (ing, e["target"], tuple(e["species"]))
                contra.setdefault(key, e)

    for x in d["drug_interactions"]:
        ids_by_ing = {n: map_ing(n, unmapped) for n in as_list(x["ingredient"])}
        for drug in as_list(x["drug"]):
            drug = DRUG.get(drug, drug)
            if drug is None:
                continue
            for name, ids in ids_by_ing.items():
                sev, act = x.get("severity"), x.get("action")
                if x.get("severity_by_ingredient", {}).get(name):
                    sev = x["severity_by_ingredient"][name]["severity"]
                    act = x["severity_by_ingredient"][name]["action"]
                if x.get("recommended_default"):
                    act = x["recommended_default"]
                hours = None
                if act and act.startswith("separate_dosing_by_hours="):
                    hours = float(act.split("=")[1])
                    act = "separate_dosing"
                act = {"avoid": "exclude", "monitor": "monitor", "separate_dosing": "separate_dosing",
                       "reduce_dose": "reduce_dose", None: "vet_review"}[act]
                for ing in ids:
                    e = {"ingredient": ing, "medication": f"med:{drug}", "severity": sev or "moderate",
                         "action": act, "mechanism": str(x["mechanism"]).strip()[:400],
                         "evidence_strength": x["evidence_strength"],
                         "sources": cite(x["citations"], x["evidence_level"]), "curation": curation(x)}
                    if hours:
                        e["separate_hours"] = hours
                    inter.setdefault((ing, drug), e)

    hdr = "# Generated by scripts/import_safety.py from the safety research pass (2026-10-03). Edit here, not in the script.\n"
    (ROOT / "data/edges/toxicity.yaml").write_text(hdr + yaml.safe_dump(list(tox.values()), sort_keys=False, width=110))
    (ROOT / "data/edges/contraindications.yaml").write_text(hdr + yaml.safe_dump(list(contra.values()), sort_keys=False, width=110))
    (ROOT / "data/edges/interactions.yaml").write_text(hdr + yaml.safe_dump(list(inter.values()), sort_keys=False, width=110))
    (ROOT / "data/sources/safety.yaml").write_text(hdr + yaml.safe_dump(list(sources.values()), sort_keys=False, width=110))
    print(f"toxicity {len(tox)}  contraindications {len(contra)}  interactions {len(inter)}  sources {len(sources)}")
    print("unmapped:", sorted(unmapped))
    print("\n".join(skipped))
    used = sorted({e["ingredient"] for e in [*tox.values(), *contra.values(), *inter.values()]})
    print("ingredients referenced:", used)


if __name__ == "__main__":
    main()
