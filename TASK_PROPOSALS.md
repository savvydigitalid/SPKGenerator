# Task Proposals from Codebase Review

## 1) Typo fix task
**Title:** Correct legal phrase typo from `KERJASAMA` to `KERJA SAMA`

- **Issue found:** The SPK title renders `SURAT PERJANJIAN KERJASAMA` in both PDF and on-screen preview. In formal Indonesian this is typically written `KERJA SAMA`.
- **Where:** `src/App.jsx` title text in PDF generator and preview card.
- **Proposed change:** Replace all visible title occurrences of `KERJASAMA` with `KERJA SAMA` so the legal heading is consistent and formal.
- **Acceptance criteria:**
  - PDF title shows `SURAT PERJANJIAN KERJA SAMA`.
  - Preview title shows `SURAT PERJANJIAN KERJA SAMA`.
  - No other heading text regressions.

## 2) Bug fix task
**Title:** Fix off-by-one date rendering caused by `new Date('YYYY-MM-DD')`

- **Issue found:** The app parses date-only form values via `new Date(form.spkIssueDate)` and `new Date(form.uploadDeadline)`. In many time zones this can shift the displayed date by one day due to UTC interpretation of ISO date-only strings.
- **Where:** Multiple places in `src/App.jsx` (PDF generation, preview card, and SPK number creation).
- **Proposed change:** Parse date-only values as local calendar dates (e.g., custom parser splitting `YYYY-MM-DD` and constructing `new Date(year, monthIndex, day)`), then use that helper consistently.
- **Acceptance criteria:**
  - Entering `2026-04-09` displays `09/04/2026` in preview and PDF for all users regardless of browser timezone.
  - SPK number date segment matches the exact selected form date.

## 3) Comment/documentation discrepancy task
**Title:** Resolve section numbering gap between Pasal 2 and Pasal 5

- **Issue found:** The contract content jumps from `Pasal 2` directly to `Pasal 5` in both PDF and preview. This creates a structural/documentation discrepancy that can look like missing clauses.
- **Where:** `src/App.jsx` section titles and related comments (`// PASAL 2`, then `// PASAL 5`, `// PASAL 6`).
- **Proposed change (choose one and document):**
  1. Renumber existing sections to be consecutive (`Pasal 3`, `Pasal 4`) if no clauses are truly missing, or
  2. Add the missing Pasal 3 and Pasal 4 content if intended by legal template.
- **Acceptance criteria:**
  - Final contract uses coherent sequential section numbering.
  - Section comments in code match displayed section labels.

## 4) Test improvement task
**Title:** Add unit tests for tax calculation and date/document-number helpers

- **Issue found:** The repository currently has no automated tests, and core business logic (`computeAmounts`, `deriveRates`, `makeSpkNumber`) is untested.
- **Where:** `src/App.jsx` helper functions.
- **Proposed change:**
  - Extract pure helpers into `src/lib/spk.ts` or `src/lib/spk.js`.
  - Add test runner (Vitest) and create table-driven tests for:
    - non gross-up and gross-up scenarios,
    - tax scheme mapping,
    - SPK number formatting,
    - date parsing helper behavior across time zones.
- **Acceptance criteria:**
  - `npm test` executes and passes in CI/local.
  - Helper logic has deterministic tests for representative edge cases.
