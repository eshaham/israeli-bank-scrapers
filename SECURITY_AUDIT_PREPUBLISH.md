# Security Audit Results

**Auditor role:** Pre-publication security review (read-only scan + tooling inspection).  
**Repository:** `israeli-bank-scrapers` (fork workspace as audited).  
**Date note:** Audit reflects workspace state at time of run; re-run before release if tree changes.

## Publication Verdict

**SAFE TO PUBLISH**

No **CRITICAL** findings (hardcoded live secrets, private keys, obvious backdoors, or malicious install hooks) were identified in tracked sources, CI configs, or sampled git history. Residual items below are **non-blocking** hygiene and operational-risk notes.

---

## Summary

| Category | Count / outcome |
|----------|-----------------|
| **Secrets Found (confirmed real)** | **0** |
| **PII / sensitive-pattern matches** | **Few** (mostly code field names, docs, or likely synthetic test data) |
| **Dangerous code findings (confirmed malicious)** | **0** |
| **Suspicious / review-worthy patterns** | **2** (unused import; test credentials shaped like real email) |
| **Dependency issues (`npm audit`)** | **0** vulnerabilities (current lockfile / tree) |
| **History issues (sampled)** | **No** `ghp_` / PEM headers found via targeted `git log -S` sampling |

---

## Critical Findings

**None.**

---

## High Findings

**None** in the sense of “must fix before any public push.”

---

## Medium / Low Findings

### M1 — Test fixture uses Gmail-shaped address (likely benign, style issue)

- **Type:** Possible PII-shaped placeholder in tests  
- **File:** `src/scrapers/one-zero.test.ts`  
- **Line:** ~34  
- **Masked evidence:** `e10***@gm***.com` (pattern only; not printing full string in audit log beyond structure)  
- **Classification:** **Likely synthetic** invalid-login test data; **uncertain** whether it could correspond to a real mailbox.  
- **Blocks publication:** **No**  
- **Remediation:** Replace with `invalid-user@example.com` (or similar RFC 2606-style domain) and a clearly fake password to avoid ambiguity.

### M2 — `.gitignore` covers `.env` but not all common variants

- **Type:** Config leak risk (local dev)  
- **File:** `.gitignore`  
- **Line:** ~58 (`/.env` entry)  
- **Evidence:** `.env.local`, `.env.production`, etc. are not explicitly listed.  
- **Classification:** **Likely benign** if team never creates those files; **suspicious pattern** if developers use Next/Vite-style env files.  
- **Blocks publication:** **No**  
- **Remediation:** Add `.env.*` or explicit `.env.local` / `.env.production.local` lines if the team uses them.

### M3 — `prepare:core` / `prepare:default` / `reset` run `git reset --hard`

- **Type:** Operational / safety (not secrecy)  
- **File:** `package.json` (`scripts`)  
- **Lines:** `prepare:core`, `prepare:default`, `reset`  
- **Evidence:** Scripts invoke `git reset --hard` before build/transform steps.  
- **Classification:** **Benign for automation**, **dangerous if run accidentally** on a dirty working tree.  
- **Blocks publication:** **No**  
- **Remediation:** Document prominently in maintainer docs; consider guard prompts or separate `danger-*` script names (future PR).

### M4 — Unused `child_process` import in utility

- **Type:** Dead code / minor noise  
- **File:** `utils/jscodeshift/index.js`  
- **Line:** 2 (`spawnSync` imported, unused in file body)  
- **Classification:** **Benign**; no evidence of execution path.  
- **Blocks publication:** **No**  
- **Remediation:** Remove unused import in a cleanup PR.

### M5 — CONTRIBUTING example JSON mentions `demouser` / `demopassword`

- **Type:** Documentation placeholder  
- **File:** `CONTRIBUTING.md`  
- **Evidence:** Example credentials block (clearly labeled demo-style).  
- **Classification:** **Likely benign**  
- **Blocks publication:** **No**

### M6 — Inherent product risk: bank automation library

- **Type:** Dual-use / abuse surface (not a code defect)  
- **Evidence:** Library automates financial institution access; callers supply live credentials at runtime.  
- **Classification:** **Expected** for this product class.  
- **Blocks publication:** **No**, but **disclosure**: publishers should expect scrutiny; downstream users must protect credentials and comply with institution ToS/law.

---

## False Positives / Benign Findings

| Pattern | Where | Rationale |
|---------|--------|-----------|
| `password`, `token`, `Bearer`, `InvalidPassword` in scrapers | Many `src/scrapers/*.ts` | Normal credential **types** and login flows; values come from caller, not hardcoded secrets. |
| `page.$eval` / `$$eval` | Scrapers, `elements-interactions.ts` | **Puppeteer DOM APIs**, not `eval()` on arbitrary server strings. |
| `js-tokens` in lockfile | `package-lock.json` | NPM package name, not auth tokens. |
| `secrets.GITHUB_TOKEN` in workflow | `.github/workflows/release.yml` | **GitHub Actions built-in** secret reference, not embedded PAT. |
| Test URLs with `token=secret` | `safe-error.test.ts`, `security-hardening.test.ts` | **Intentional** test strings for sanitization assertions. |
| `.npmrc` | repo root | Contains **only** `registry = https://registry.npmjs.org/` — no auth token observed. |

---

## Publication Surface Review

### What becomes public if the repo is pushed

- **Tracked:** Full `src/**` (TypeScript sources), tests, configs, `SECURITY.md`, `package.json`, lockfile, GitHub workflows, `utils/**`, docs.  
- **Untracked (this workspace):** Clean `git status` at audit time — no extra sensitive files pending commit.  
- **Gitignored (must stay untracked):** `src/tests/.tests-config.js` (per `src/tests/.gitignore` pattern), `node_modules/`, `lib/`, `.env` (if created). **Local `.tests-config.js` was not present** on the audit machine.

### npm package / tarball (`npm pack --dry-run`)

- **`files` field:** `lib/**/*`, `SECURITY.md` (per current `package.json`).  
- **Observed pack:** ~92 files under `lib/**` + metadata; **no** `src/tests` or `.tests-config` in listing.  
- **Assessment:** Published artifact path appears **clean** of test configs; still verify before each `npm publish`.

### CI

- **Node CI:** `npm ci`, `test:ci`, `prepare:core` — no embedded secrets in workflow YAML.  
- **Release:** OIDC/provenance-oriented publish; uses `secrets.GITHUB_TOKEN` (standard).

---

## Remediation Checklist

- [x] No hardcoded live API keys / PEM private keys found in sampled tree (re-check before release).  
- [ ] Optional: replace Gmail-shaped test email with `@example.com` (M1).  
- [ ] Optional: broaden `.env*` ignores if team uses multiple env files (M2).  
- [x] No malicious `postinstall` / `prepublish` in `package.json` dependencies (none found).  
- [x] No unresolved critical malicious-code indicators in reviewed paths.  
- [ ] If a **real** secret was ever committed, rotate it and consider history rewrite (not indicated by sampled `git log -S`).  
- [x] Package output reviewed via `npm pack --dry-run` (representative run).

---

## Recommended Next Actions

1. **Before any npm publish:** Run `npm pack --dry-run` and confirm tarball excludes tests and local configs.  
2. **Optional hygiene PR:** M1 (test email), M4 (unused import), M2 (`.gitignore`) — low priority.  
3. **Maintainer discipline:** Never commit `src/tests/.tests-config.js` or real `TESTS_CONFIG` JSON; keep live runs in private CI.  
4. **Re-run `npm audit`** on each dependency bump; current tree reported **0** issues.  
5. **If expanding git history audit:** Use secret-scanning tools (e.g. `gitleaks`, GitHub secret scanning) for full-history coverage beyond this manual sample.

---

## Phase 10 — Publish recommendation (no code changes applied)

1. **Recommendation:** **Publish is acceptable** from a secrets/malware/obvious-leak perspective, subject to normal operational hygiene (no real credentials in repo, careful npm publish).  
2. **Top 5 fixes (priority order):**  
   - (1) Enforce never committing `.tests-config.js` / real `TESTS_CONFIG` (process + optional CI check).  
   - (2) Replace ambiguous test email with `@example.com` (M1).  
   - (3) Remove unused `spawnSync` import (M4).  
   - (4) Consider `.env.*` gitignore hardening (M2).  
   - (5) Document danger of `prepare:core` / `git reset --hard` (M3).  
3. **Small remediation PR plan:** One optional “audit follow-up” PR: M1 + M4 + M2 (three small edits), no runtime scraper logic changes.
