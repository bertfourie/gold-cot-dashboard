"""
Spot prices and SLV close from Yahoo Finance via yfinance.

Tickers:
  GC=F  → COMEX gold futures front-month (proxy for gold spot)
  SI=F  → COMEX silver futures front-month (proxy for silver spot)
  SLV   → iShares Silver Trust ETF
  GLD   → SPDR Gold Shares ETF (we already get this from SPDR's CSV, kept here as a fallback)

Output is weekly (Friday close) so it lines up with the COT report cadence
and the SPDR archive.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

LOG = logging.getLogger(__name__)


def _weekly_close(ticker: str, start: str) -> pd.Series:
    """Fetch daily closes, resample to Friday week-end, return a Series indexed by date."""
    LOG.info("yfinance: %s from %s", ticker, start)
    df = yf.download(ticker, start=start, progress=False, auto_adjust=False)
    if df.empty:
        raise RuntimeError(f"yfinance returned no data for {ticker}")
    # yfinance can return a single-level or multi-level column index depending
    # on version; normalise.
    close = df["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    weekly = close.resample("W-FRI").last().dropna()
    return weekly


def fetch_weekly_prices(start: str = "2024-01-01") -> pd.DataFrame:
    """
    Returns DataFrame indexed by Friday with columns:
      gold_spot, silver_spot, slv_close, gld_close, gs_ratio
    """
    series = {
        "gold_spot": _weekly_close("GC=F", start),
        "silver_spot": _weekly_close("SI=F", start),
        "slv_close": _weekly_close("SLV", start),
        "gld_close": _weekly_close("GLD", start),
    }
    df = pd.concat(series, axis=1)
    df["gs_ratio"] = (df["gold_spot"] / df["silver_spot"]).round(2)
    df["gold_spot"] = df["gold_spot"].round(1)
    df["silver_spot"] = df["silver_spot"].round(3)
    df["slv_close"] = df["slv_close"].round(2)
    df["gld_close"] = df["gld_close"].round(2)
    return df.dropna(how="all")
