---
name: pr-safety-review
description: Give a fast, reviewer-facing verdict on whether a PR or diff in this repo is safe to merge — SAFE, RISKY, or BREAKING — instead of a long research writeup. Checks for (1) unnecessary/stale comments, (2) whether existing working code paths still behave identically (backward compatibility), and (3) whether any new feature added alongside the core scraping logic degrades gracefully instead of risking the whole scrape on failure. Use this whenever the user asks to review a PR, look at a diff, check a pull request for breaking changes, asks "is this safe to merge/approve", pastes a GitHub PR URL/number and asks what to watch out for, or says they don't have time to dig into a PR themselves and just want the important part. Trigger even if they only give a PR number or link with no other instructions — that alone means they want this fast verdict, not an essay.
---

# PR Safety Review

A maintainer of this repo reviews a constant stream of community PRs (mostly scraper fixes/features) and does not have time to re-derive the control flow of every changed function by hand. This skill exists to do that derivation once, carefully, and hand back only the part a reviewer actually needs to act on: **does this change anything that already worked, and if it adds something new, can that new thing fail without taking the rest of the scraper down with it.**

The output is a verdict, not a report. If you catch yourself writing multiple paragraphs of narration about what you read, stop — compress it into the findings list. The reviewer will ask follow-up questions if they want the detail behind a specific finding.

## Step 1 — Get the actual diff

Don't review from the PR title/description alone — authors describe intent, not always the resulting control flow. Fetch:
- The diff itself (`get_diff` / `git diff`).
- Enough of the *surrounding* unchanged code (`get_file_contents` at the base ref, or `git show <base>:<path>`) to see what a changed function looked like **before**, not just the `+`/`-` lines in isolation. A three-line diff hunk is frequently only interpretable by seeing the `if/else` it's embedded in.
- If the change touches a scraper's core data path, check whether a `.test.ts` file exists for it and whether the diff touches test expectations too (see Check 1 below for why that matters).
- If it's a real PR (not a bare diff/local branch), a quick glance at CI status and existing review comments — these are nearly free to fetch and change what "safe to approve" actually means right now: a RISKY-but-otherwise-fine diff with red CI or an unresolved reviewer objection isn't ready regardless of what the code analysis says. Skip this for a diff with no PR behind it (nothing to fetch).

If given only a PR number/URL, resolve owner/repo from the current git remote unless told otherwise.

## Step 2 — Run the three checks

Do these as an analysis pass over the diff you just read, not as separate tool-heavy investigations. Each check below produces zero or more findings; a clean check produces none, and that's a fine outcome — don't invent a finding to look thorough.

### Check 1: Comments

Flag any comment that would still be true and useful if you deleted the sentence and let the reader look at the code — that's the test for "unnecessary." Concretely:
- Restates what the line already says (`// increment counter` above `count++`).
- References the current PR/task/issue instead of a durable property of the code (`// added for the frame fix`, `// see #1153`) — this kind of comment is true today and wrong the day after the next refactor.
- Is stale relative to the code it sits next to (describes a branch or parameter that no longer exists after this diff).

Do **not** flag a comment that explains a non-obvious *why*: a workaround for a specific upstream quirk, an invariant the surrounding code depends on, a reason a seemingly-simpler alternative was rejected. Removing a comment like that would cost the next reader real time re-deriving what the author already knew.

### Check 2: Backward compatibility

For each changed function, ask: **which callers/inputs exercised this code before, and does the diff change what they get back?** Walk the control flow (branches, fallback chains, `??`/`||` defaults) as it was, not as it's described, and compare to the new version. Before you can answer "which callers," check whether the changed file *is* a caller's dependency rather than a single scraper's own code — this repo shares base classes across scrapers on purpose (`base-isracard-amex.ts` backs both `isracard.ts` and `amex.ts`; `base-beinleumi-group.ts` backs eight bank scrapers at once — `hapoalim`, `leumi`, `discount`, `mizrahi`, `union-bank`, `yahav`, `behatsdaa`, `beyahad-bishvilha`). Check the changed file's actual importers (`grep -rl "from '\./<file>'" src/scrapers/`) rather than assuming from these examples — plenty of scrapers, like `visa-cal.ts`, aren't shared by anything. A change to shared code has as many "existing callers" as there are subclasses/importers, and a risk that's negligible for one of them can be real for another with different data shapes — a quick `grep`/import search for the changed file's other usages costs one tool call and tells you whether you're reviewing a single-scraper change or a blast-radius one. Then classify the whole diff into exactly one of:

- **safe** — the change only adds a new branch/field/fallback that fires in cases that were previously broken, empty, or unreached (e.g. a `case`/`else if` that only fires when every existing branch already fell through to `undefined`/an error; a new optional field added to a type that was already optional and always `undefined` for this caller). Existing inputs that used to produce a defined, correct result still produce the identical result.
- **risky** — an existing, already-working branch's behavior changes for at least some previously-handled inputs (a fallback's priority order changes in a way that's reachable by real data, a formula used by an already-working path is altered, a default value changes). This doesn't mean reject it — it means the reviewer needs to know a working path is being touched, and ideally the PR shows evidence (a test, a log) that the *specific* previously-working case still holds.
- **breaking** — a public type, return shape, exported function signature, or on-disk/serialized format changes in a way an existing consumer would notice without opening this diff (a field renamed or removed, a required field added, a return type narrowed, a function that used to resolve now rejects for previously-valid input).

A diff can easily contain more than one of the branches above at once — e.g. two of a fallback chain's four branches are truly untouched while a third one's priority shifted. Don't average that into one vague "mostly safe" impression: name both halves, in that order, every time — untouched first, then changed:
1. **Unchanged:** name the specific existing branch(es)/condition(s) that still take the exact same path they did before this diff (this is the reassurance the reviewer needs so they don't have to re-derive it themselves — skip this sentence only if the diff truly touches every existing branch, which is rare).
2. **Changed:** name the one that doesn't, and why.

Write it as two clauses even when "unchanged" feels obvious enough to skip — it's the sentence most often dropped under time pressure, and it's the one that tells the reviewer the finding's actual blast radius rather than just its existence. A reordering or condition change only counts as **risky** if you can point to a plausible real-world input that reaches the changed branch differently than before — a change that's only theoretically reachable through data the diff's own request/response shape rules out is safe, not risky, so say why it's unreachable if you conclude that.

### Check 3: New-feature safety (graceful degradation)

This repo's scrapers commonly bolt a new capability onto an already-working core flow — an extra field, an extra network fetch/page navigation, extra parsing of a page that wasn't touched before. The core flow (the part that already ships transactions to users) must survive the new part failing, because the new part is exercised against a live website/page structure that can change or vary per account in ways the author's one test account won't reveal.

For each such addition, trace what happens if it fails — throws, times out, or parses into garbage — and check:
1. **Is the failure contained?** The call is inside a `try/catch` (or equivalent) *at the right scope* — wrapping just the new feature's work, not accidentally swallowing errors from the core flow too. An `await` for the new feature sitting outside any guard, in a place where an unhandled rejection reaches the caller, means one flaky page load now fails an entire scrape that used to succeed.
2. **Does failure degrade to the old behavior, not a wrong answer?** On failure the new field(s) should end up absent/`undefined` (i.e., exactly what existing consumers already saw before this PR), not a fabricated value. A fallback formula that computes a plausible-looking but unverified number is worse than leaving the field empty — it fails silently in the wrong direction.
3. **Does the new feature mutate shared state the core flow still relies on afterward?** Look for: navigating the same browser `page` to a new URL (fine only if nothing after it depends on the prior page/URL — check what runs next), mutating an object the core path reads later, or reordering async work such that the new feature can win a race the old code didn't have.

If all three hold, the new feature is isolated and its own bugs are a quality issue, not a merge blocker. If any doesn't hold, that's the headline finding — it means shipping this PR risks regressing users who don't even care about the new feature.

Isolation from *failure* isn't the only cost worth naming, though — it's just the one that decides the verdict. A new capability can be perfectly safe by the three tests above and still change what every run of the scraper does: an extra unconditional network round-trip/page load, a new site dependency that can start failing tomorrow, added latency on every call. This repo already has a convention for that trade-off in places (e.g. `additionalTransactionInformation` / the `isracard-amex:skipAdditionalTransactionInformation` opt-in flag) — if a new always-on fetch has no equivalent opt-out where an existing similar feature does, that's worth one line in the closing summary even under a SAFE verdict. It's not a fourth tagged check; it's the kind of thing that belongs in the free-text line at the end of the output template.

## Step 3 — Output

Keep this to what a reviewer reads in ten seconds plus a skimmable list. Use exactly this shape:

```
## Verdict: SAFE | RISKY | BREAKING

- [comments] path/to/file.ts:123 — <one-line finding>
- [compat] path/to/file.ts:45 — <one-line finding>
- [feature-safety] path/to/file.ts:67 — <one-line finding>

<one or two sentences: the one thing to actually pay attention to before approving, or "nothing else to flag" if the list above is it>
```

Rules for this output:
- Every bullet is tagged with which check it came from (`comments`, `compat`, `feature-safety`) and anchored to a real `file:line` — a finding the reviewer can't jump to isn't actionable.
- Omit a section's bullets entirely if that check found nothing — don't write "No issues found" as a bullet, just leave it out.
- The verdict is for the *diff as a whole*: pick BREAKING if any single finding is breaking, else RISKY if any finding is risky, else SAFE. It reflects the code, not the process — CI/review-thread status never changes SAFE to RISKY or vice versa, it's separate information about whether *this* is a good time to act on that verdict.
- CI status and open review threads (see Step 1) don't get their own tag — they're not a code finding — but if CI is red on the latest commit, or there's an unresolved reviewer comment asking for a real change, say so in one clause in the closing line (e.g. "also: `validate` is currently failing on the latest commit" / "also: an unresolved comment from `<reviewer>` asks for X"). Say nothing about CI/threads at all if they're clean — that's the common case and doesn't need a "CI is green" bullet to prove it.
- If asked about multiple PRs in one request, give one verdict block per PR, in the order asked, with no shared preamble.
- This is the default depth. Only go longer than this if the user asks a specific follow-up question about one of the findings — then answer that question directly, still without re-padding the rest of the review.
