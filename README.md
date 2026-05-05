# Gold COT Dashboard

A self-updating dashboard combining the Larry Williams Commercial Index with
Wyckoff Spring readiness analysis for COMEX gold and silver futures.

The dashboard auto-refreshes every Saturday morning (UTC) by pulling fresh
data from the CFTC, SPDR Gold Shares, and Yahoo Finance, then committing the
updated JSON files back to this repo. Hosting on GitHub Pages is free and
serves the static frontend.

## What's in here

```
.
├── index.html              ← Dashboard UI (Chart.js)
├── app.js                  ← Frontend logic
├── styles.css
│
├── gold_cot_data.json      ← Auto-updated weekly
├── silver_cot_data.json    ← Auto-updated weekly
├── ratio_data.json         ← Auto-updated weekly (gold/silver + SLV)
├── gld_data.json           ← Auto-updated weekly (GLD ETF tonnes)
├── cb_data.json            ← Manual quarterly (central bank purchases)
│
├── scripts/                ← Python pipeline
│   ├── update_data.py      ← Main entry point
│   ├── cftc.py             ← Socrata API → COT data
│   ├── etf.py              ← SPDR archive → GLD tonnes
│   ├── prices.py           ← yfinance → spot + ETF closes
│   └── indices.py          ← Williams stochastic COT index
│
├── .github/workflows/
│   └── update-data.yml     ← Saturday 02:00 UTC cron
│
└── requirements.txt
```

## How it works

The frontend is the same as before — pure HTML/CSS/JS, no build step. The
only change is that all five data files now live as standalone JSON instead
of being baked into `app.js`. The dashboard fetches them in parallel on load.

The Python pipeline replaces the manual "ask Perplexity" step:

1. **CFTC**: Socrata API at `publicreporting.cftc.gov/resource/72hh-3qpy.json`
   filtered to gold (`088691`) and silver (`084691`).
2. **GLD tonnage**: SPDR's official `GLD_US_archive_EN.csv` — actual holdings,
   not the price-ratio estimate the original dashboard used.
3. **Spot prices**: `yfinance` for `GC=F`, `SI=F`, `GLD`, `SLV`, resampled
   to Friday close to align with the COT cadence.
4. **Williams COT Index**: 26-week stochastic of (net position ÷ open
   interest), recomputed in Python with output that matches the original
   JS implementation byte-for-byte (verified against historical data).

## Setup — first time

### 1. Push this repo to GitHub

```bash
git init
git add .
git commit -m "Initial dashboard"
git branch -M main
git remote add origin git@github.com:YOUR-USERNAME/gold-cot-dashboard.git
git push -u origin main
```

### 2. Enable GitHub Pages

In the repo on github.com:

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**
4. Save

Your dashboard will be live at
`https://YOUR-USERNAME.github.io/gold-cot-dashboard/` within a minute or two.

### 3. Allow Actions to write to the repo

The workflow needs permission to commit updated data files back:

1. **Settings → Actions → General**
2. Under **Workflow permissions**, select **Read and write permissions**
3. Save

### 4. Trigger the first run

1. **Actions** tab → **Update COT data** workflow
2. Click **Run workflow** → **Run workflow** (the green button)
3. Wait ~2 minutes. Successful run? Data is fresh. Failed? Click into the run
   to see logs.

From this point the cron handles itself. You'll see a new auto-commit appear
each Saturday from `cot-bot`.

## Updating central bank data (quarterly, manual)

The World Gold Council publishes quarterly `Gold Demand Trends` reports
(typically late January, late April, late July, late October). When a new
one comes out:

1. Open `cb_data.json`
2. Append a new entry, e.g. for Q1 2026:

```json
{
  "period": "2026-Q1",
  "quarter_end": "2026-03-31",
  "cb_net_t": 244.0,
  "cb_total_t": 36833.8
}
```

`cb_total_t` is the running total of all central bank gold (the previous
quarter's `cb_total_t` plus this quarter's `cb_net_t`). Source the figures
from the WGC `Gold Demand Trends` PDF or the IMF IFS database.

3. Commit and push. The dashboard picks it up on next page load.

## Running locally

To preview the dashboard or test the pipeline before pushing:

```bash
# Install
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Refresh data
python -m scripts.update_data

# Serve the dashboard (any static server works)
python -m http.server 8000
# → open http://localhost:8000
```

## Troubleshooting

**Workflow fails with 403 on the push step.** You haven't set Workflow
permissions to read/write — see step 3 above.

**CFTC fetch returns no rows.** Socrata occasionally rate-limits unauthenticated
clients. The script retries 3× with backoff. If it still fails, register for
a free Socrata app token at `https://evergreen.data.socrata.com/signup` and add
`X-App-Token` to the request headers in `scripts/cftc.py`.

**SPDR archive URL changes.** SPDR has restructured the URL once or twice over
the years. If `etf.py` 404s, check
[spdrgoldshares.com → Historical Data](https://www.spdrgoldshares.com/usa/historical-data/)
for the current archive link and update `GLD_ARCHIVE_URL`.

**Dashboard loads but charts are empty.** Open the browser console (F12).
You're probably hitting a `fetch()` failure on one of the JSON files —
typically because the file is in a different folder than `index.html`.
All five JSON files must live next to `index.html`.

## Methodology notes

The Wyckoff Spring readiness gauge uses these thresholds (from `app.js`):

- Commercials COT Index ≥ 80% — smart money has covered shorts into longs
- Managed Money COT Index ≤ 30% — trend-followers flushed out
- Non-Reportables COT Index ≤ 40% — retail capitulated

A Spring is signalled only when **all three** conditions hold simultaneously.
This is conservative by design — single-group signals are too noisy in metals
markets. The "overall readiness" percentage is the mean of each group's
progress toward its target and is meant as a directional gauge, not a trade
trigger.

The 26-week lookback is Williams's original spec. Some practitioners overlay
a 156-week (3-year) view to filter cycle artefacts; you can change the
default in `scripts/indices.py` and `app.js` together.
