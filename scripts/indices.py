"""
Williams COT Index calculation — mirrors the JS implementation in app.js
exactly, so the dashboard sees identical numbers whether they were computed
client-side or by this pipeline.

Formula:
  For each week i and each trader group:
    cot_index = (oi_ratio_i - min(window)) / (max(window) - min(window)) × 100
  where window = previous `lookback` weeks (default 26).
  If max == min, the index is 50 (no information in the window).
"""
from __future__ import annotations


def williams_cot_index(records: list[dict], lookback: int = 26) -> list[dict]:
    """
    Adds *_cot_index fields for each of comm/mm/other/nr based on each record's
    *_oi_ratio. Returns a NEW list (does not mutate input).
    """
    keys = [
        ("comm_oi_ratio", "comm_cot_index"),
        ("mm_oi_ratio", "mm_cot_index"),
        ("other_oi_ratio", "other_cot_index"),
        ("nr_oi_ratio", "nr_cot_index"),
    ]
    n = len(records)
    out: list[dict] = []
    for i, rec in enumerate(records):
        new = dict(rec)
        start = max(0, i - lookback + 1)
        window = records[start : i + 1]
        for src_key, dst_key in keys:
            vals = [w[src_key] for w in window]
            mn, mx = min(vals), max(vals)
            rng = mx - mn
            if rng == 0:
                new[dst_key] = 50.0
            else:
                new[dst_key] = round((rec[src_key] - mn) / rng * 100, 1)
        out.append(new)
    return out


def silver_cot_index(records: list[dict], lookback: int = 26) -> list[dict]:
    """
    Silver records don't carry pre-computed oi_ratio fields; compute them from
    the net positions and OI on the fly.
    """
    # First, derive oi_ratios
    enriched = []
    for r in records:
        oi = r.get("oi") or 1
        enriched.append(
            {
                **r,
                "comm_oi_ratio": r["comm_net"] / oi,
                "mm_oi_ratio": r["mm_net"] / oi,
                "other_oi_ratio": r["other_net"] / oi,
                "nr_oi_ratio": r["nr_net"] / oi,
            }
        )
    indexed = williams_cot_index(enriched, lookback)
    # Strip the helper oi_ratio fields back out — silver schema doesn't keep them
    for rec in indexed:
        for k in ("comm_oi_ratio", "mm_oi_ratio", "other_oi_ratio", "nr_oi_ratio"):
            rec.pop(k, None)
    return indexed
