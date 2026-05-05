"""
Fetches the CFTC Disaggregated Futures-Only Commitments of Traders report
via the public Socrata API and reshapes it into the JSON schema the
dashboard already understands.

CFTC contract market codes:
  Gold COMEX:   088691
  Silver COMEX: 084691

Released every Friday ~3:30pm ET, covering positions as of Tuesday close.
"""
from __future__ import annotations

import logging
import time
from typing import Iterable

import pandas as pd
import requests

LOG = logging.getLogger(__name__)

# Socrata endpoint for "Disaggregated Futures Only"
SOCRATA_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"

# Polite User-Agent so the CFTC ops folks know who we are
HEADERS = {
    "User-Agent": "gold-cot-dashboard/1.0 (+https://github.com)",
    "Accept": "application/json",
}

GOLD_CODE = "088691"
SILVER_CODE = "084691"


def _fetch_raw(contract_code: str, limit: int = 5000) -> pd.DataFrame:
    """Pull all rows for a contract, newest first."""
    params = {
        "cftc_contract_market_code": contract_code,
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": limit,
    }
    LOG.info("Fetching CFTC %s ...", contract_code)
    # Three retries with exponential backoff — Socrata is reliable but not perfect
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            r = requests.get(SOCRATA_URL, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return pd.DataFrame(r.json())
        except (requests.RequestException, ValueError) as e:
            last_err = e
            wait = 2**attempt
            LOG.warning("CFTC fetch attempt %d failed: %s (retrying in %ds)", attempt + 1, e, wait)
            time.sleep(wait)
    raise RuntimeError(f"CFTC fetch failed after 3 attempts: {last_err}")


def _to_int(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").fillna(0).astype(int)


def _gold_record(row: pd.Series) -> dict:
    """Map one Socrata row → the schema gold_cot_data.json uses."""
    comm_long = int(row["prod_merc_positions_long"]) + int(row["swap_positions_long_all"])
    comm_short = int(row["prod_merc_positions_short"]) + int(row["swap__positions_short_all"])
    mm_long = int(row["m_money_positions_long_all"])
    mm_short = int(row["m_money_positions_short_all"])
    other_long = int(row["other_rept_positions_long"])
    other_short = int(row["other_rept_positions_short"])
    nr_long = int(row["nonrept_positions_long_all"])
    nr_short = int(row["nonrept_positions_short_all"])
    oi = int(row["open_interest_all"])

    return {
        "date": str(row["report_date_as_yyyy_mm_dd"])[:10],
        "open_interest": oi,
        "comm_long": int(row["prod_merc_positions_long"]),
        "comm_short": int(row["prod_merc_positions_short"]),
        "swap_long": int(row["swap_positions_long_all"]),
        "swap_short": int(row["swap__positions_short_all"]),
        "mm_long": mm_long,
        "mm_short": mm_short,
        "other_long": other_long,
        "other_short": other_short,
        "nr_long": nr_long,
        "nr_short": nr_short,
        "comm_net": comm_long - comm_short,
        "mm_net": mm_long - mm_short,
        "other_net": other_long - other_short,
        "nr_net": nr_long - nr_short,
        # Position-to-OI ratios — used for the Williams stochastic calc
        "comm_oi_ratio": (comm_long - comm_short) / oi if oi else 0.0,
        "mm_oi_ratio": (mm_long - mm_short) / oi if oi else 0.0,
        "other_oi_ratio": (other_long - other_short) / oi if oi else 0.0,
        "nr_oi_ratio": (nr_long - nr_short) / oi if oi else 0.0,
    }


def _silver_record(row: pd.Series) -> dict:
    """Slimmer schema used by silver_cot_data.json."""
    comm_long = int(row["prod_merc_positions_long"]) + int(row["swap_positions_long_all"])
    comm_short = int(row["prod_merc_positions_short"]) + int(row["swap__positions_short_all"])
    mm_long = int(row["m_money_positions_long_all"])
    mm_short = int(row["m_money_positions_short_all"])
    other_long = int(row["other_rept_positions_long"])
    other_short = int(row["other_rept_positions_short"])
    nr_long = int(row["nonrept_positions_long_all"])
    nr_short = int(row["nonrept_positions_short_all"])
    return {
        "date": str(row["report_date_as_yyyy_mm_dd"])[:10],
        "oi": int(row["open_interest_all"]),
        "comm_net": comm_long - comm_short,
        "mm_net": mm_long - mm_short,
        "other_net": other_long - other_short,
        "nr_net": nr_long - nr_short,
        "comm_long": comm_long,
        "comm_short": comm_short,
        "mm_long": mm_long,
        "mm_short": mm_short,
        # cot indices are recomputed downstream
    }


def fetch_gold() -> list[dict]:
    df = _fetch_raw(GOLD_CODE)
    if df.empty:
        raise RuntimeError("CFTC returned no rows for gold")
    df = df.sort_values("report_date_as_yyyy_mm_dd").reset_index(drop=True)
    return [_gold_record(r) for _, r in df.iterrows()]


def fetch_silver() -> list[dict]:
    df = _fetch_raw(SILVER_CODE)
    if df.empty:
        raise RuntimeError("CFTC returned no rows for silver")
    df = df.sort_values("report_date_as_yyyy_mm_dd").reset_index(drop=True)
    return [_silver_record(r) for _, r in df.iterrows()]
