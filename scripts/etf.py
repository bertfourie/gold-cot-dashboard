"""ETF holdings fetchers.
GLD: pulls SSGA's official navhist XLSX (date, NAV, shares outstanding, total net assets) and converts AUM to tonnes using gold spot from yfinance.
SLV: BlackRock does not expose a clean historical CSV. Earlier versions attempted a price-ratio estimator anchored to a baseline AUM, but that produced wildly wrong numbers (off by 4x or more) because the baseline itself was wrong. The estimator has been removed. SLV close price still comes through via prices.py yfinance and populates ratio_data.json correctly. slv_tonnes is left as None.
"""
from __future__ import annotations
import io
import logging
import pandas as pd
import requests

LOG = logging.getLogger(__name__)

GLD_ARCHIVE_URL = "https://www.ssga.com/library-content/products/fund-data/etfs/us/navhist-us-en-gld.xlsx"
HEADERS = {"User-Agent": "Mozilla/5.0 gold-cot-dashboard/1.0"}
OZ_PER_TONNE = 32150.7466  # troy ounces per metric tonne

def _last_friday(date: pd.Timestamp) -> pd.Timestamp:
    """Snap a date back to the most recent Friday (week-ending convention)."""
    return (date - pd.Timedelta(days=(date.dayofweek - 4) % 7)).normalize()

def fetch_gld_weekly(min_date: str = "2024-01-01", spot_by_date: dict | None = None) -> list[dict]:
    """
    Returns weekly GLD records:
        [{date, gld_close, gld_tonnes, gld_tonnes_chg, gld_volume_m, ...}]
    The date is the week-ending Friday. The tonnes calculation requires gold spot prices
    keyed by week-ending Friday date string (YYYY-MM-DD). Pass via spot_by_date.
    Without it, tonnes will be None (the function will warn but not fail).

    NOTE: gold_spot is intentionally NOT included in the output.
    """
    LOG.info("Fetching SSGA GLD navhist XLSX ...")
    r = requests.get(GLD_ARCHIVE_URL, headers=HEADERS, timeout=60)
    r.raise_for_status()
    df = pd.read_excel(io.BytesIO(r.content), sheet_name=0, skiprows=3)
    LOG.info("SSGA XLSX columns: %s", list(df.columns))
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
    df["week_end"] = df["date"].apply(_last_friday)
    weekly = (
        df.groupby("week_end")
        .agg(
            gld_close=("gld_close", "last"),
            total_net_assets=("total_net_assets", "last"),
        )
        .reset_index()
        .rename(columns={"week_end": "date"})
        .sort_values("date")
        .reset_index(drop=True)
    )
    spot_by_date = spot_by_date or {}
    weekly["gold_spot"] = weekly["date"].apply(lambda d: spot_by_date.get(d.strftime("%Y-%m-%d")))
    missing_spot = weekly["gold_spot"].isna().sum()
    if missing_spot:
        LOG.warning("%d of %d weekly rows have no gold spot price; tonnes will be None for those", missing_spot, len(weekly))
    weekly["gld_tonnes"] = weekly["total_net_assets"] / weekly["gold_spot"] / OZ_PER_TONNE
    weekly["gld_tonnes"] = weekly["gld_tonnes"].round(1)
    weekly["gld_tonnes_chg"] = weekly["gld_tonnes"].diff().round(1)
    # Sanity check: GLD tonnes should be in the 500-2500 range
    valid_tonnes = weekly["gld_tonnes"].dropna()
    if len(valid_tonnes) > 0:
        latest = valid_tonnes.iloc[-1]
        if not (500 <= latest <= 2500):
            raise ValueError(
                f"GLD tonnes ({latest:.1f}) is outside the plausible 500-2,500 range; "
                f"the AUM/spot conversion is probably broken."
            )
    out: list[dict] = []
    for _, r in weekly.iterrows():
        out.append(
            {
                "date": r["date"].strftime("%Y-%m-%d"),
                "gld_close": float(round(r["gld_close"], 2)) if pd.notna(r["gld_close"]) else None,
                "gld_tonnes": float(r["gld_tonnes"]) if pd.notna(r["gld_tonnes"]) else None,
                "gld_tonnes_chg": float(r["gld_tonnes_chg"]) if pd.notna(r["gld_tonnes_chg"]) else None,
                "gld_volume_m": None,
            }
        )
    return out
