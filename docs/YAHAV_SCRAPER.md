# Bank Yahav scraper - flow, dates, and debugging

This document describes how the Yahav scraper in this package works, how to interpret host-app logs (for example finance dashboards that wrap `createScraper`), and how to debug DOM issues **without** putting credentials or personal data in the repository.

## End-to-end flow

1. **Login** at `login.yahav.co.il` with username, password, and national ID.
2. **Navigate** to account details, then **`#/main/accounts/current/`** (full current-account transactions page — same as the bank’s “תנועות בחשבון עו״ש” URL).
3. **Effective start date** - `fetchData` computes:
   - `defaultStartMoment = now - N months + 1 day`, where **N** defaults to **4** or **`YAHAV_STATEMENT_MONTHS_BACK`** (clamped to `1`–`24`) when set in the process environment.
   - `startMoment = max(defaultStartMoment, moment(options.startDate))`  
   So the scraper never asks the bank for a window **earlier** than that default, even if `startDate` is older.
4. **`searchByDates`** — ensures **`#/main/accounts/current/`**, sets the statement **scope** dropdown away from **`בחר`** (preview ~5 rows) via **`selectYahavStatementScopeAllIfPresent`**, applies the date filter via **`applyYahavDateFilterOnly`** (inputs + calendar fallback), **asserts** from/to on screen, then **`enforceYahavStatementLoaded`** (retries scope + dates up to 3× if the list is still a short preview).
5. **Optional search button** - Hebrew-labelled buttons (e.g. search / display) are clicked when present so the grid refreshes after date changes.
6. **`getAccountTransactions`** - **`expandYahavStatementTable`** only scans **`main` / list area** (avoids clicking global nav “הצג”). Then scroll helpers (including CDK **`scrollToOffset`**, synthetic **`WheelEvent`**, in-page `requestAnimationFrame` scroll capture), then collects `.list-item-holder .entire-content-ctr` rows into `parseYahavTransactionRowCells`. With **`YAHAV_DEBUG_DOM`**, logs **`dom text probe`**: how many `DD/MM/2026` strings appear in `document.body.innerText` and whether **`משכורת`** is present — helps tell “data not in DOM yet” vs “wrong row selector”.

## Salary-style descriptions (finance apps)

Many dashboards classify **salary** when the bank description contains **`משכורת`**, often as **`מעסיק/משכורת`** (employer slash salary). The scraper passes through the bank’s `description` unchanged after parsing. If salaries are missing, first confirm the **same account and date range** in the Yahav website shows those lines; then widen `startDate` / `YAHAV_STATEMENT_MONTHS_BACK` and re-run.

## Environment: `YAHAV_STATEMENT_MONTHS_BACK`

Integer number of months for the rolling default window (see step 3). Example: `YAHAV_STATEMENT_MONTHS_BACK=9 node your-script.js`.

## Environment: `YAHAV_DEBUG_NET`

Set to `1` or `true` to log **response URLs** (and content-type) for `digital.yahav.co.il` while `fetchAccountData` runs. Useful to discover REST endpoints if DOM virtualization still hides rows. Does not log response bodies.

## Environment: `YAHAV_STRICT_STATEMENT` and `YAHAV_MIN_STATEMENT_ROWS`

After date search, **`enforceYahavStatementLoaded`** checks that the page is on the current-account URL, scope is not **`בחר`**, list row count is at least **`YAHAV_MIN_STATEMENT_ROWS`** (default **10**, max 30), and the oldest visible date is not newer than the requested **`startDate`**.

- **`YAHAV_STRICT_STATEMENT=0`** or **`false`** — log incomplete snapshots but do not throw (legacy permissive behaviour).
- Default (unset) — throw with a JSON snapshot if the statement still looks like a preview. Finance apps that previously got only ~5 rows should see a clear error instead of silent partial data.

## Environment: `YAHAV_DEBUG_DOM`

Set `YAHAV_DEBUG_DOM=1` (or `true`) in the process environment when running a local harness.

The scraper logs (to stderr):

- Current page URL after the statement header is ready.
- **`dom text probe`** before collection: `dates2026` (rough count of `DD/MM/2026` in `document.body.innerText`) and `hasSalaryWord` (whether **`משכורת`** appears). If the bank site shows many May rows but `dates2026` stays low and `hasSalaryWord` is false, the page text never received the full statement — focus on search / expand / network, not row CSS alone.
- Row-selector probes and counts.
- Final parsed transaction count.

No passwords or IDs are logged.

## Interpreting finance-app style logs

Many apps log fields similar to:

| Field | Meaning |
| ----- | ------- |
| `transactionsFetched` | Rows returned by the scraper library after parsing. |
| `transactionsParsed` | Same pipeline after normalization in the app (often equals fetched). |
| `transactionsPersisted` | Rows actually inserted; can be `0` if all rows were deduplicated. |
| `duplicatesSkipped` | Rows treated as already present in the database. |
| `dataWindow.from` / `to` | The app's notion of sync window (often aligned with `startDate` / run time), not necessarily each row's booking date. |

If the **bank UI** shows more rows than `transactionsFetched`, suspect **virtualized lists** (only a subset in the DOM until scrolled) or an **incomplete date refresh** before scrape. The scraper mitigates this by scrolling the list and by setting both from/to inputs when the UI exposes two fields.

## Local live validation (do not commit secrets)

- Keep credentials in `.env.local` or another **git-ignored** file on your machine.
- For a **tracked** smoke check (May + salary-like descriptions), run **`node utils/yahav-may-salary-smoke.cjs`** from the repo root (loads `.env.local` if present, sets `YAHAV_STATEMENT_MONTHS_BACK=6` unless already set; exits `0` only when at least two May Jerusalem-month rows match `/משכורת|/משכורת|שכר/` in the description).
- You can still use a **small, untracked** script for other experiments. Never commit `.env.local`, export files with real transactions, or log dumps that include account numbers.

## Code map

| Area | File |
| ---- | ---- |
| Browser automation, scroll, date UI | `src/scrapers/yahav.ts` |
| Row column heuristics (date / ref / amounts), concatenated single-cell rows | `src/scrapers/yahav-parse.ts` |
| Local range test (1 May → today, `.env.local`) | `utils/yahav-live-may1-today.cjs` |
| Local May salary smoke (optional) | `utils/yahav-may-salary-smoke.cjs` |
| Unit tests for parsing | `src/scrapers/yahav-parse.test.ts` |

## Related upstream / fork notes

Statement layout and Angular components on Yahav change from time to time. If parsing fails after a bank deploy, capture anonymized HTML structure (class names and nesting only) and open an issue on the fork with `YAHAV_DEBUG_DOM` counts and behaviour.
