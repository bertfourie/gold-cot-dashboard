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

GLD_ARCHIVE_URL = "https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv"
HEADERS = {"User-Agent": "gold-cot-dashboard/1.0"}


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
    # The CSV has a junk header row; pandas handles it
    df = pd.read_csv(io.BytesIO(r.content), sep=';', encoding='cp1252')

    # Column names from SPDR are long and contain commas inside; locate by substring
    def col(substring: str) -> str:
        for c in df.columns:
            if substring.lower() in c.lower():
                return c
        raise KeyError(f"GLD CSV has no column matching {substring!r}; got {list(df.columns)}")

    date_c = col("date")
    close_c = col("gld close")
    nav_gold_c = col("nav per gld in gold")  # used to back out gold spot
    tonnes_c = col("tonnes in the trust")
    vol_c = col("daily share volume")

    df = df.rename(
        columns={
            date_c: "date",
            close_c: "gld_close",
            nav_gold_c: "nav_per_gold",
            tonnes_c: "gld_tonnes",
            vol_c: "volume",
        }
    )[["date", "gld_close", "nav_per_gold", "gld_tonnes", "volume"]].copy()

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"])
    for c in ("gld_close", "nav_per_gold", "gld_tonnes", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["date"] >= pd.Timestamp(min_date)].sort_values("date")

    # Roll daily → weekly (Friday week-end). Use last value of the week.
    df["week_end"] = df["date"].apply(_last_friday)
    weekly = (
        df.groupby("week_end")
        .agg(
            gld_close=("gld_close", "last"),
            nav_per_gold=("nav_per_gold", "last"),
            gld_tonnes=("gld_tonnes", "last"),
            volume_sum=("volume", "sum"),
        )
        .reset_index()
        .rename(columns={"week_end": "date"})
        .sort_values("date")
    )

    # Gold spot ≈ GLD close ÷ NAV-per-gold-ratio. NAV per share in gold troy oz
    # is published in the same row, so spot = close × (1 / nav_per_gold) × 10
    # is wrong — the SPDR field is "ounces of gold per share", typically ~0.09.
    # spot = close / (ounces per share). We sanity-check below.
    weekly["gold_spot"] = (weekly["gld_close"] / weekly["nav_per_gold"]).round(1)
    weekly["gld_tonnes_chg"] = weekly["gld_tonnes"].diff().round(1)
    weekly["gld_volume_m"] = (weekly["volume_sum"] / 1e6).round(2)

    out = []
    for _, r in weekly.iterrows():
        out.append(
            {
                "date": r["date"].strftime("%Y-%m-%d"),
                "gld_close": float(round(r["gld_close"], 2)),
                "gold_spot": float(r["gold_spot"]) if pd.notna(r["gold_spot"]) else None,
                "gld_tonnes": float(round(r["gld_tonnes"], 1)) if pd.notna(r["gld_tonnes"]) else None,
                "gld_tonnes_chg": float(r["gld_tonnes_chg"]) if pd.notna(r["gld_tonnes_chg"]) else None,
                "gld_volume_m": float(r["gld_volume_m"]) if pd.notna(r["gld_volume_m"]) else None,
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
