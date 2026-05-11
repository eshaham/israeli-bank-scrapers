# Bank Yahav scraper - flow, dates, and debugging

This document describes how the Yahav scraper in this package works, how to interpret host-app logs (for example finance dashboards that wrap `createScraper`), and how to debug DOM issues **without** putting credentials or personal data in the repository.

## End-to-end flow

1. **Login** at `login.yahav.co.il` with username, password, and national ID.
2. **Navigate** to account details and the statement / current-account transactions view.
3. **Effective start date** - `fetchData` computes:
   - `defaultStartMoment = now - 3 months + 1 day`
   - `startMoment = max(defaultStartMoment, moment(options.startDate))`  
   So the scraper never asks the bank for a window **earlier** than that default, even if `startDate` is older.
4. **`searchByDates`** - sets the bank UI range:
   - **Calendar mode:** year grid, month grid, then a **non-`pmu-disabled`** day cell matching the start day; errors if year or day cannot be selected.
   - **Input mode:** fills the **first** `div.date-options-cell` input with "from" and the **second** (when present) with "to" (today), so the wrong field is not updated alone.
5. **Optional search button** - Hebrew-labelled buttons (e.g. search / display) are clicked when present so the grid refreshes after date changes.
6. **`getAccountTransactions`** - scrolls the transaction list to stabilize virtualized rows, then reads each `.entire-content-ctr` row using **direct child** text (with a `:scope > div` fallback), parses columns with `parseYahavTransactionRowCells` (see `src/scrapers/yahav-parse.ts`), and deduplicates identical rows.

## Environment: `YAHAV_DEBUG_DOM`

Set `YAHAV_DEBUG_DOM=1` (or `true`) in the process environment when running a local harness.

The scraper logs (to stderr):

- Current page URL after the statement header is ready.
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
- Use a **small, untracked** script that calls `createScraper({ companyId: 'yahav', startDate: ... })` and prints only counts or redacted summaries.
- Never commit `.env.local`, export files with real transactions, or log dumps that include account numbers.

## Code map

| Area | File |
| ---- | ---- |
| Browser automation, scroll, date UI | `src/scrapers/yahav.ts` |
| Row column heuristics (date / ref / amounts) | `src/scrapers/yahav-parse.ts` |
| Unit tests for parsing | `src/scrapers/yahav-parse.test.ts` |

## Related upstream / fork notes

Statement layout and Angular components on Yahav change from time to time. If parsing fails after a bank deploy, capture anonymized HTML structure (class names and nesting only) and open an issue on the fork with `YAHAV_DEBUG_DOM` counts and behaviour.
