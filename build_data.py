#!/usr/bin/env python3
"""
build_data.py
=============
Bakes agora_data.json from the two MapAgora county-level CSVs.

Usage
-----
    python3 build_data.py \
        --counts cnty_counts_cov.csv \
        --types  cnty_civic_org_type.csv \
        --out    agora_data.json

Both source CSVs live in the public release of the dataset at:
  https://github.com/snfagora/american_civic_opportunity_datasets
  (data_outputs/cnty_counts_cov.csv)
  (data_outputs/cnty_civic_org_type.csv)

The script:
  1. Joins the two CSVs on the county FIPS code
  2. Computes national & state ranks and percentiles
  3. Pre-computes the four data-story payloads used on the front page
  4. Writes a single compact JSON file consumed by app.js

Run this whenever the underlying CSVs change.
"""
import argparse
import json
import sys
import pandas as pd


def rn(v, d=1):
    if pd.isna(v):
        return None
    return round(float(v), d)


def build(counts_path: str, types_path: str, out_path: str) -> None:
    cov = pd.read_csv(counts_path, dtype={"FIPS": str})
    typ = pd.read_csv(types_path, dtype={"FIPS": str})

    # Some FIPS appear twice in the counts file (cross-state addresses
    # whose secondary row has NA population). Keep the main row only.
    cov = (
        cov.dropna(subset=["TotalPopulation"])
        .drop_duplicates("FIPS", keep="first")
        .reset_index(drop=True)
    )

    # Ranks (1 = highest score)
    cov["nat_rank"] = (
        cov["civic_opp_sum_normalized"].rank(ascending=False, method="min").astype(int)
    )
    cov["state_rank"] = (
        cov.groupby("state")["civic_opp_sum_normalized"]
        .rank(ascending=False, method="min")
        .astype(int)
    )
    cov["state_n"] = cov.groupby("state")["FIPS"].transform("count").astype(int)
    cov["percentile"] = (cov["nat_rank"] / len(cov) * 100).round(1)

    # ---- per-county type breakdown ----
    type_groups: dict[str, list[dict]] = {}
    prim_lookup: dict[str, str] = {}
    for fips, g in typ.groupby("FIPS"):
        g2 = g.dropna(subset=["class"]).sort_values("n", ascending=False)
        type_groups[fips] = [
            {"c": r["class"], "n": int(r["n"]), "f": round(float(r["freq"]), 4)}
            for _, r in g2.iterrows()
        ]
        if g["primary_org_cat"].notna().any():
            prim_lookup[fips] = g["primary_org_cat"].dropna().iloc[0]
        elif len(type_groups[fips]) > 0:
            # Derive primary type from the highest-count category
            prim_lookup[fips] = type_groups[fips][0]["c"]

    # ---- per-county payload ----
    counties: dict[str, dict] = {}
    for _, r in cov.iterrows():
        fips = r["FIPS"]
        counties[fips] = {
            "st": r["state"],
            "pop": int(r["TotalPopulation"]),
            "n": int(r["n"]),
            "civic_org": int(r["civic_org_sum"]),
            "opp_score": rn(r["civic_opp_sum_normalized"]),
            "opp_idx": int(r["civic_opp_index"]),
            "nat_rank": int(r["nat_rank"]),
            "state_rank": int(r["state_rank"]),
            "state_n": int(r["state_n"]),
            "pct": rn(r["percentile"]),
            "mem_n": int(r["membership_sum"]),
            "vol_n": int(r["volunteer_sum"]),
            "evt_n": int(r["events_sum"]),
            "act_n": int(r["take_action_sum"]),
            "mem_pc": rn(r["membership_sum_normalized"]),
            "vol_pc": rn(r["volunteer_sum_normalized"]),
            "evt_pc": rn(r["events_sum_normalized"]),
            "act_pc": rn(r["take_action_sum_normalized"]),
            "pov": rn(r["POV150"]),
            "sng": rn(r["SNGPNT"]),
            "brd": rn(r["BROAD"]),
            "edu": rn(r["NOHSDP"]),
            "unp": rn(r["UNEMP"]),
            "min": rn(r["REMNRTY"]),
            "prim": prim_lookup.get(fips),
            "types": type_groups.get(fips, []),
        }

    # ---- STORY 1: U-curve by population quintile ----
    cov["pop_q"] = pd.qcut(cov["TotalPopulation"], 5, labels=False)
    q_labels = ["Smallest 20%", "2nd quintile", "Middle 20%", "4th quintile", "Largest 20%"]
    ucurve = []
    for i, lab in enumerate(q_labels):
        sub = cov[cov.pop_q == i]
        ucurve.append(
            {
                "label": lab,
                "pop_min": int(sub.TotalPopulation.min()),
                "pop_max": int(sub.TotalPopulation.max()),
                "mean": round(float(sub.civic_opp_sum_normalized.mean()), 1),
                "median": round(float(sub.civic_opp_sum_normalized.median()), 1),
                "n": int(len(sub)),
            }
        )

    # ---- STORY 2: adversity correlations ----
    adversity = []
    for col, label in [
        ("POV150", "Poverty rate (% below 150% FPL)"),
        ("NOHSDP", "Adults without HS diploma (%)"),
        ("UNEMP", "Unemployment (%)"),
        ("BROAD", "Households without broadband (%)"),
        ("SNGPNT", "Single-parent households (%)"),
        ("REMNRTY", "Racial/ethnic minority share (%)"),
    ]:
        r = cov[["civic_opp_sum_normalized", col]].corr().iloc[0, 1]
        adversity.append({"col": col, "label": label, "r": round(float(r), 3)})

    # Scatter (currently unused on the page but kept for future use)
    scatter = [
        {"x": rn(r["NOHSDP"]), "y": rn(r["civic_opp_sum_normalized"])}
        for _, r in cov.iterrows()
        if pd.notna(r["NOHSDP"]) and pd.notna(r["civic_opp_sum_normalized"])
    ]

    # ---- STORY 3: regional dominance ----
    prim_df = pd.DataFrame([{"FIPS": k, "prim": v} for k, v in prim_lookup.items()])
    prim_df = prim_df.merge(cov[["FIPS", "state"]], on="FIPS", how="inner")

    state_top = (
        prim_df.groupby(["state", "prim"])
        .size()
        .reset_index(name="n")
        .sort_values(["state", "n"], ascending=[True, False])
        .drop_duplicates("state", keep="first")
    )
    state_top_dict = {
        r["state"]: {"top": r["prim"], "n": int(r["n"])} for _, r in state_top.iterrows()
    }

    prim_national = prim_df["prim"].value_counts().to_dict()
    prim_national_pct = {
        k: round(v / len(prim_df) * 100, 1) for k, v in prim_national.items()
    }

    # ---- STORY 4: top / bottom 10 (with min population to filter noise) ----
    min_pop = 10_000
    elig = cov[cov.TotalPopulation >= min_pop].copy()
    top10 = elig.nlargest(10, "civic_opp_sum_normalized")
    bot10 = elig.nsmallest(10, "civic_opp_sum_normalized")

    def to_rank_list(df):
        return [
            {
                "fips": r["FIPS"],
                "state": r["state"],
                "score": round(float(r["civic_opp_sum_normalized"]), 1),
                "pop": int(r["TotalPopulation"]),
                "civic_org": int(r["civic_org_sum"]),
            }
            for _, r in df.iterrows()
        ]

    summary = {
        "n_counties": int(len(cov)),
        "n_orgs_total": int(cov["n"].sum()),
        "n_civic_orgs": int(cov["civic_org_sum"].sum()),
        "median_score": round(float(cov["civic_opp_sum_normalized"].median()), 1),
        "mean_score": round(float(cov["civic_opp_sum_normalized"].mean()), 1),
        "states_covered": int(cov["state"].nunique()),
    }

    payload = {
        "summary": summary,
        "counties": counties,
        "stories": {
            "ucurve": ucurve,
            "adversity": adversity,
            "scatter": scatter,
            "state_primary": state_top_dict,
            "national_primary_pct": prim_national_pct,
            "top10": to_rank_list(top10),
            "bot10": to_rank_list(bot10),
            "min_pop_for_extremes": min_pop,
        },
    }

    with open(out_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    import os

    print(f"Wrote {out_path}: {os.path.getsize(out_path):,} bytes")
    print(f"  counties:        {summary['n_counties']:,}")
    print(f"  total nonprofits:{summary['n_orgs_total']:,}")
    print(f"  civic-opp orgs:  {summary['n_civic_orgs']:,}")
    print(f"  states:          {summary['states_covered']}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--counts", required=True, help="path to cnty_counts_cov.csv")
    p.add_argument("--types", required=True, help="path to cnty_civic_org_type.csv")
    p.add_argument("--out", default="agora_data.json", help="output JSON path")
    args = p.parse_args()
    build(args.counts, args.types, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
