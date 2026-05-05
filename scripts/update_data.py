#!/usr/bin/env python3
"""
Weekly data refresh for the Gold COT Dashboard.
Run from the project root: python -m scripts.update_data

Updates these JSON files (next to index.html):
  - gold_cot_data.json      CFTC disaggregated, gold code 088691
  - silver_cot_data.json    CFTC disaggregated, silver code 084691
  - gld_data.json           SPDR GLD weekly tonnes
  - ratio_data.json         gold/silver spot, gs ratio, SLV close

Does NOT touch cb_data.json (central bank purchases, manual quarterly update).
Exits non-zero if any source fails, so GitHub Actions surfaces the failure.
"""
from __future__ import annotations
import json
import logging
import sys
import traceback
from pathlib import Path
import pandas as pd

# Allow `python -m scripts.update_data` to find sibling modules
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scripts import cftc, etf, indices, prices  # noqa: E402

LOG = logging.getLogger("update_data")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
    datefmt="%H:%M:%S",
)

def _write_json(path: Path, data: list | dict) -> None:
    path.write_text(json.dumps(data, indent=2, default=str))
    LOG.info("Wrote %s (%d rows)", path.name, len(data) if isinstance(data, list) else 1)

def _load_json(path: Path) -> list:
    if not path.exists(): return []
    try: return json.loads(path.read_text())
    except json.JSONDecodeError:
        LOG.warning("%s is corrupt, treating as empty", path.name)
        return []

def update_gold_cot(out_dir: Path) -> list[dict]:
    LOG.info("→ Gold COT")
    raw = cftc.fetch_gold()
    enriched = indices.williams_cot_index(raw, lookback=26)
    _write_json(out_dir / "gold_cot_data.json", enriched)
    return enriched

def update_silver_cot(out_dir: Path) -> list[dict]:
    LOG.info("→ Silver COT")
    raw = cftc.fetch_silver()
    enriched = indices.silver_cot_index(raw, lookback=26)
    _write_json(out_dir / "silver_cot_data.json", enriched)
    return enriched

def update_ratio(out_dir: Path) -> tuple[list[dict], dict]:
    """ratio_data.json combines weekly gold/silver spot, the GS ratio, SLV close.
    Returns records and a spot_by_date map so the GLD step downstream can use the same gold spot prices.
    """
    LOG.info("→ Gold/Silver ratio + SLV")
    px = prices.fetch_weekly_prices()
    spot_by_date: dict[str, float] = {}
    out: list[dict] = []
    for date, row in px.iterrows():
        date_s = date.strftime("%Y-%m-%d")
        spot = float(row["gold_spot"]) if pd.notna(row["gold_spot"]) else None
        if spot is not None:
            spot_by_date[date_s] = spot
        out.append(
            {
                "date": date_s,
                "gold_spot": spot,
                "silver_spot": float(row["silver_spot"]) if pd.notna(row["silver_spot"]) else None,
                "gs_ratio": float(row["gs_ratio"]) if pd.notna(row["gs_ratio"]) else None,
                "slv_close": float(row["slv_close"]) if pd.notna(row["slv_close"]) else None,
                "slv_tonnes": None,
            }
        )
    _write_json(out_dir / "ratio_data.json", out)
    return out, spot_by_date

def update_gld(out_dir: Path, spot_by_date: dict) -> list[dict]:
    LOG.info("→ GLD ETF holdings")
    data = etf.fetch_gld_weekly(spot_by_date=spot_by_date)
    _write_json(out_dir / "gld_data.json", data)
    return data

def main() -> int:
    out_dir = ROOT
    failures: list[str] = []
    
    # COT data is independent; run those first
    for label, fn in [
        ("gold_cot", update_gold_cot),
        ("silver_cot", update_silver_cot),
    ]:
        try:
            fn(out_dir)
        except Exception as e:  # noqa: BLE001
            LOG.error("%s update failed: %s", label, e)
            traceback.print_exc()
            failures.append(label)
    
    # Ratio step is needed before GLD, so it can pass spot prices
    try:
        _, spot_by_date = update_ratio(out_dir)
    except Exception as e:  # noqa: BLE001
        LOG.error("ratio update failed: %s", e)
        traceback.print_exc()
        failures.append("ratio")
        spot_by_date = {}
    
    # GLD step uses spot prices from ratio
    try:
        update_gld(out_dir, spot_by_date)
    except Exception as e:  # noqa: BLE001
        LOG.error("gld update failed: %s", e)
        traceback.print_exc()
        failures.append("gld")
    
    if failures:
        LOG.error("FAILED: %s", ", ".join(failures))
        return 1
    LOG.info("All updates OK")
    return 0

if __name__ == "__main__":
    sys.exit(main())
