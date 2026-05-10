# Changelog

All notable changes to this fork (`@hirez10/israeli-bank-scrapers`) are documented here. Release versions and Git tags are produced by [semantic-release](https://github.com/semantic-release/semantic-release) (`hirez-v*` tags).

**Source of truth for published releases:** [GitHub Releases — HirezRa/israeli-bank-scrapers](https://github.com/HirezRa/israeli-bank-scrapers/releases). Target / current publish line: **`1.0.16`** (tag [`hirez-v1.0.16`](https://github.com/HirezRa/israeli-bank-scrapers/releases/tag/hirez-v1.0.16) when released). If this file lags CI, follow GitHub.

## [1.0.16] (2026-05-10)

### English

- **Release hygiene:** Bump package semver to **1.0.16** and align README, CONTRIBUTING, and this changelog with the publish line (`@hirez10/israeli-bank-scrapers`).

### עברית

- סנכרון גרסה 1.0.16 ותיעוד (README, CONTRIBUTING, CHANGELOG) מול קו הפרסום.

## [1.0.15] (2026-05-09)

### English

- **Yahav:** Support **input-based** date filter layouts (range controls that use plain input fields, not only calendar / `date-picker` UIs). ([#25](https://github.com/HirezRa/israeli-bank-scrapers/issues/25))

### עברית

- יהב: סינון לפי תאריכים כשהממשק מציג שדות קלט (לא רק לוח שנה).

## [1.0.14] (2026-05-07)

### English

- **Dependencies:** Refresh lockfile, bump declared minimums, align `typescript-eslint` and related tooling. ([#24](https://github.com/HirezRa/israeli-bank-scrapers/issues/24))

### עברית

- תלות: עדכון lockfile ורצפת גרסאות מינימלית.

## [1.0.13] (2026-05-07)

### English

- **Yahav:** Avoid a long default timeout when the loading spinner element is **absent** (wait for disappear only if present). ([#23](https://github.com/HirezRa/israeli-bank-scrapers/issues/23))

### עברית

- יהב: המתנה לספינר רק אם קיים — בלי לשרוף timeout מלא.

## [1.0.12] (2026-05-07)

### English

- **Yahav:** Wait for `date-picker` in the DOM and **scroll into view** before click. ([#22](https://github.com/HirezRa/israeli-bank-scrapers/issues/22))

### עברית

- יהב: המתנה ל־date-picker ב־DOM וגלילה לפני לחיצה.

## [1.0.11] (2026-05-07)

### English

- **Yahav:** Resilient **from-date** picker after bank layout change (no brittle fixed column index). ([#21](https://github.com/HirezRa/israeli-bank-scrapers/issues/21))

### עברית

- יהב: בורר תאריך "מ־" עמיד יותר לשינויי ממשק.

## [1.0.10] — Yahav DOM parsing and live-check diagnostics (May 2026)

### English

- **Yahav transaction rows:** Collect column text from all direct child elements (not only `div`); try alternative selectors until parsed rows exist; scroll list containers to support virtualized rows.
- **Column semantics:** Skip duplicate `DD/MM/YYYY` cells when locating reference/description; place debit/credit after the two semantic columns; detect description vs reference order (text vs numeric reference pattern).
- **Diagnostics:** Set `YAHAV_DEBUG_DOM=1` to log selector counts and frame URL when debugging empty results (no credentials). `yahav-live-check` prints a hint when this is enabled.

### עברית

- יהב: חילוץ עמודות משורת תנועות, גלילה, ופרסור גמיש של אסמכתא/תיאור מול תאריכים כפולים.
- `YAHAV_DEBUG_DOM=1` לאבחון DOM בלי סיסמאות.

## Yahav — statement row parsing and from-date calendar (May 2026)

### English

- **Transaction rows:** Use **direct child** `div` columns for each row instead of all nested `div` descendants, so date/debit/credit columns stay aligned (wrong dates could hide a month in downstream filters).
- **Calendar:** When choosing the start day, skip `pmu-disabled` cells (other-month days) so the first matching day is not a trailing/leading day from an adjacent month. Fail loudly if the year or day cannot be selected.

### עברית

- פרסור שורות דוח: עמודות לפי ילדים ישירים בלבד.
- בוחן תאריך: בחירת יום בלוח רק בתאים שאינם `pmu-disabled`, ושגיאה אם בחירת שנה/יום נכשלת.

## Maintenance — npm dependency refresh (May 2026)

### English

- Ran `npm update` within existing semver ranges and committed the updated `package-lock.json` (no vulnerabilities reported by `npm audit` at refresh time).
- Raised declared minimum versions in `package.json` where the lockfile resolved newer patch/minor releases: `puppeteer` ^24.43.0, `prettier` ^3.8.3, `@types/node` ^25.6.1, `typescript-eslint` ^8.59.2.
- **Deferred** (separate migration PR): ESLint 10, Jest 30, TypeScript 6, major bumps for `cross-env`, `husky`, `fs-extra`, `moment-timezone`.
- **Toolchain:** `@typescript-eslint` 8.59.x surfaced new `no-unnecessary-type-assertion` findings; removed redundant assertions (and an unused import in `visa-cal.ts`).

### עברית

- עדכון `npm` בתחום ה-semver הקיים ועדכון `package-lock.json`.
- שדרוגי major לא בוצעו במסגרת זו.

## Yahav — from-date picker selector (May 2026)

### English

**Symptom:** Sync failed after successful login with:

`Waiting for selector div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2) failed`

**Cause:** The scraper used a fixed positional selector, `div.date-options-cell:nth-child(7)`, to open the “from” date control on the account statement screen. Bank Yahav changed the layout (number/order of cells in that row), so the seventh column no longer contained the `date-picker`.

**Fix:** Locate the first `div.date-options-cell` that contains a `date-picker`, then click the same inner `span` as before (`:scope > div:nth-child(1) > span:nth-child(2)`). This avoids depending on a brittle column index.

**Code:** `src/scrapers/yahav.ts` — function `openYahavFromDatePicker`.

### עברית

**תסמין:** אחרי התחברות תקינה, הסנכרון נכשל עם שגיאת `waitForSelector` על בורר התאריך.

**סיבה:** הקוד הסתמך על העמודה השביעית בשורת האפשרויות (`nth-child(7)`). שינוי בממשק האתר שינה את מספר או סדר התאים, והבורר כבר לא היה באותו אינדקס.

**תיקון:** לחיצה על בורר התאריך הראשון שנמצא בתוך תא `.date-options-cell` שמכיל `date-picker`, בלי לנחש מספר עמודה קבוע.

## Yahav — `date-picker` wait / visibility (May 2026)

### English

**Symptom:** After release `hirez-v1.0.11`, some runs failed with:

`Waiting for selector div.date-options-cell date-picker failed`

(often with `visible: true` implied by the scraper helper).

**Cause:** The bank UI can attach `date-picker` to the DOM before Puppeteer considers it **visible** (layout, animation, overflow, or parent visibility). Waiting only for a **visible** compound selector times out even though the control is present.

**Fix:**

1. Wait for **DOM presence** via `page.waitForFunction` — any `date-picker` under `div.date-options-cell` or `.statement-options`.
2. **Scroll into view** and click the inner `span` (with fallbacks), or click the host `date-picker` if needed.
3. After the statement header is ready, wait for **`.loading-bar-spinner`** to disappear when present so the date row is stable.

**Resilience flow (high level):**

```mermaid
flowchart TD
  A[Statement screen ready] --> B{Spinner on page?}
  B -->|yes| C[Wait until spinner hidden]
  B -->|no| D[Wait for date-picker in DOM]
  C --> D
  D --> E[Scroll + click first from-date control]
  E --> F[Calendar / .pmu-days]
```

### עברית

**תסמין:** כשל `waitForSelector` על `div.date-options-cell date-picker`.

**סיבה:** האלמנט יכול להיות ב-DOM אך עדיין לא מסומן כ-visible עבור Puppeteer, ולכן המתנה ל-selector "גלוי" נכשלת.

**תיקון:** המתנה לנוכחות ב-DOM, גלילה לתצוגה, לחיצה עם מספר ניסיונות ל-span פנימי, והמתנה לסיום ספינר טעינה לפני בורר התאריך.

## Yahav — loading spinner wait (May 2026)

### English

**Symptom:** Some runs failed with a generic Puppeteer timeout, e.g. `Waiting failed: 30000ms exceeded`, during `fetch_transactions`, even after the date-picker visibility fix.

**Cause:** `waitUntilElementDisappear('.loading-bar-spinner')` was called unconditionally. In Puppeteer, waiting for an element to become **hidden** when it **never exists** in the DOM can consume the full default timeout (~30s).

**Fix:** Only call `waitUntilElementDisappear` for `.loading-bar-spinner` when the element is present (`waitYahavLoadingSpinnerGoneIfPresent`). Use the same helper after navigation, before/after date search, and on the statement screen.

### עברית

**תסמין:** timeout כללי של ~30 שניות בשלב איסוף תנועות.

**סיבה:** המתנה להיעלמות ספינר שלא הופיע בכלל ב-DOM.

**תיקון:** המתנה להיעלמות הספינר רק אם הוא קיים.

## Yahav — live-account fallback triggers for date calendar (May 2026)

### English

- During a real-account live check, login succeeded but fetch timed out after ~45s.
- Root cause: the old date-opening path expected a `date-picker` trigger variant that was not consistently clickable.
- Fix: iterate multiple date-trigger selectors in statement options, click each candidate, and verify the calendar actually opened (`.pmu-days`) before proceeding.
- Failure message now points to the exact stage: failed to open date picker / calendar missing.

### עברית

- בבדיקה חיה עם חשבון אמיתי: ההתחברות הצליחה, אך שלב איסוף התנועות נתקע ב-timeout.
- נוספה לוגיקת fallback לבוררי פתיחת לוח תאריכים, עם אימות שהלוח נפתח בפועל.

## Yahav — input fallback when calendar widget is absent (May 2026)

### English

- Live-run diagnostics showed pages where `.statement-options` exists and date inputs exist, but no `date-picker` and no `.pmu-days` popup can be opened.
- Root cause: waiting/clicking for calendar UI only; some Yahav layouts expose plain input fields for date range.
- Fix:
  1. Scope-independent DOM wait for date triggers (`document.querySelector(...)` instead of `.statement-options` only).
  2. If no known trigger opens `.pmu-days`, fallback to direct date input (`DD/MM/YYYY`) with `input/change/blur` events.
  3. Stage-labeled errors (`runYahavStage`) to avoid generic `Waiting failed...` loops.
- Added a secure local command `npm run yahav:live-check` for real-account validation without printing secrets.

### עברית

- בריצה חיה זוהו מסכים שבהם אין `date-picker` ואין popup של `.pmu-days`, אך יש שדות `input` לתאריך.
- נוספה נפילה חכמה: אם לוח השנה לא נפתח, הסקרייפר ממלא את תאריך ה־"מתאריך" ישירות בשדה input.
- נוספו הודעות שגיאה עם שלב מדויק כדי למנוע לופ תיקונים עם timeout כללי.
