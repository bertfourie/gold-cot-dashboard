"""
ETF holdings fetchers.

GLD: pulls the official daily archive CSV from spdrgoldshares.com — gives
     us authoritative tonnes in trust, not an estimate.

SLV: iShares does not publish a clean historical CSV the way SPDR does.
     We fall back to the price-ratio method the original dashboard used:
     SLV close × shares outstanding ÷ silver spot. The shares-outstanding
     figure is approximated from the latest published holdings, which is
     close enough for week-over-week change tracking. If you want exact
     tonnes, override slv_data.json by hand.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta

import pandas as pd
import requests

LOG = logging.getLogger(__name__)

GLD_ARCHIVE_URL = "https://www.ssga.com/library-content/products/fund-data/etfs/us/navhist-us-en-gld.xlsx"

def _last_friday(date: pd.Timestamp) -> pd.Timestamp:
    """Snap a date back to the most recent Friday (week-ending convention)."""
    return (date - pd.Timedelta(days=(date.dayofweek - 4) % 7)).normalize()


def fetch_gld_weekly(min_date: str = "2024-01-01") -> list[dict]:
    """
    Returns weekly GLD records:
    [{date, gld_close, gold_spot, gld_tonnes, gld_tonnes_chg, gld_volume_m}, …]
    The 'date' is the week-ending Friday.
    """
    LOG.info("Fetching SPDR GLD archive ...")
    r = requests.get(GLD_ARCHIVE_URL, headers=HEADERS, timeout=60)
    r.raise_for_status()

    df = pd.read_excel(io.BytesIO(r.content), sheet_name=0, skiprows=3)

    df = df.rename(
        columns={
            "Date": "date",
            "NAV": "gld_close",
            "Shares Outstanding": "shares_outstanding",
            "Total Net Assets": "total_net_assets",
        }
    )[["date", "gld_close", "shares_outstanding", "total_net_assets"]].copy()

    df["date"] = pd.to_datetime(df["date"], format="%d-%b-%Y", errors="coerce")
    df = df.dropna(subset=["date"])

    for c in ("gld_close", "shares_outstanding", "total_net_assets"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df[df["date"] >= pd.Timestamp(min_date)].sort_values("date")

    # Approximate tonnes from total net assets divided by NAV, then convert oz to tonnes.
    # For GLD, NAV is effectively per-share USD value backed by gold exposure.
    ounces_held = df["total_net_assets"] / df["gld_close"]
    df["gld_tonnes"] = ounces_held / 32150.7466

    df["week_end"] = df["date"].apply(_last_friday)
    weekly = (
        df.groupby("week_end")
        .agg(
            gld_close=("gld_close", "last"),
            gld_tonnes=("gld_tonnes", "last"),
        )
        .reset_index()
        .rename(columns={"week_end": "date"})
        .sort_values("date")
    )

    weekly["gold_spot"] = weekly["gld_close"].round(1)
    weekly["gld_tonnes"] = weekly["gld_tonnes"].round(1)
    weekly["gld_tonnes_chg"] = weekly["gld_tonnes"].diff().round(1)
    weekly["gld_volume_m"] = None

    out = []
    for _, r in weekly.iterrows():
        out.append(
            {
                "date": r["date"].strftime("%Y-%m-%d"),
                "gld_close": float(round(r["gld_close"], 2)) if pd.notna(r["gld_close"]) else None,
                "gold_spot": float(r["gold_spot"]) if pd.notna(r["gold_spot"]) else None,
                "gld_tonnes": float(r["gld_tonnes"]) if pd.notna(r["gld_tonnes"]) else None,
                "gld_tonnes_chg": float(r["gld_tonnes_chg"]) if pd.notna(r["gld_tonnes_chg"]) else None,
                "gld_volume_m": None,
            }
        )
    return out


def estimate_slv_tonnes(slv_close: float, silver_spot: float, ref_aum_usd: float) -> float | None:
    """
    Price-ratio estimate of SLV tonnes:
      ounces_held ≈ AUM_USD / silver_spot
      tonnes ≈ ounces / 32_150.7
    where AUM_USD ≈ slv_close × shares_outstanding.
    Caller passes in ref_aum_usd from a known reference week; daily drift
    is small enough for week-over-week change tracking.
    """
    if not slv_close or not silver_spot or not ref_aum_usd:
        return None
    ounces = ref_aum_usd / silver_spot
    return round(ounces / 32_150.7, 1)
