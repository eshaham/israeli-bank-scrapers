# Changelog

All notable changes to this fork (`@hirez10/israeli-bank-scrapers`) are documented here. Release versions and Git tags are produced by [semantic-release](https://github.com/semantic-release/semantic-release) (`hirez-v*` tags).

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
