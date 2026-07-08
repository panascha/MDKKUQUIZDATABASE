# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MDKKUQUIZDATABASE is the admin/manager dashboard for MDKKUQUIZ, a medical exam quiz platform for KKU medical students (batch 52). Remote: github.com/panascha/MDKKUQUIZDATABASE.

**No build step, no npm, no bundler.** Plain HTML + vanilla JS + CSS served as static files. Open `index.html` directly in a browser or deploy by pushing to GitHub.

This repo is one of three sibling sub-repos in a parent monorepo (`MDKKUQUIZREAL` student quiz app, `MDKKUQUIZBACKEND` GAS backend). See the parent folder's `CLAUDE.md` for cross-repo context, deployment commands, and the `/deploy`, `/issuelist`, `/parse-elearning` slash commands.

## Deployment

```bash
git add <files>
git commit -m "..."
git push origin main
```

The GAS backend URL is hardcoded in `js/config.js` as `window.APPSCRIPT_URL`. Changing backends/URLs requires editing this file; normal backend updates (via `clasp deploy -i`) keep the same URL and need no change here.

## Architecture

Single `index.html` with sidebar navigation. CSS is split into modular files under `css/`, loaded in this order: `variables.css` → `layout.css` → `main.css` → `components.css` → `tables.css` → `modals.css` → `modal-report.css` → `modal-vote.css` → `structure.css` → `converter.css` → `responsive.css`.

**JS modules use regular `const`/`let`/`function` declarations — they are NOT on `window.*`** (unlike MDKKUQUIZREAL). Cross-file sharing relies on script load order in `index.html`; functions are not globally accessible by name from the browser console.

| File | Role & Key Functions |
|------|----------------------|
| `js/config.js` | `window.APPSCRIPT_URL`, `window.globalData`, admin session vars |
| `js/db.js` | IndexedDB admin cache (same pattern as REAL) |
| `js/api.js` | `sendWithRetry()` — data fetching from GAS (questions, structure, votes, reports, logs); missing `redirect:'follow'` at line ~8 — harmless in-browser since `fetch` follows redirects by default, add only for consistency |
| `js/app.js` | `initApp()`, `finalizeDataLoading()` (called twice by design — once for stale-cache display, once after fresh fetch — not a bug), admin login (username+password), idle timer, paste handler for image upload |
| `js/ui.js` | Section switching, auth UI update |
| `js/tables.js` | DataTables rendering for questions, reports, votes, logs |
| `js/question.js` | Add/edit question CRUD via GAS |
| `js/structure.js` | Subject/category tree management |
| `js/vote.js` | Vote approval/rejection |
| `js/report.js` | Report review and resolution |
| `js/splitter.js` | PDF batch-split logic — splits large PDFs into page-range batches before sending to Gemini (configurable `batch-limit`, prompts user via SweetAlert2 if PDF exceeds limit) |
| `js/gemini.js` | Gemini AI PDF→questions conversion — sends raw PDF pages as `inline_data` to Gemini REST API; parses JSON response into question objects; `GEMINI_API_BASE` + user-supplied key stored in `sessionStorage` |
| `js/extractor.js` | PDF image extraction via pdf.js — pulls embedded image objects (`paintImageXObject`/`paintJpegXObject`) from each page; falls back to full-page canvas render; deduplicates via 8×8 fingerprint hash |
| `js/queue.js` | Concurrent image upload queue — uploads extracted base64 images to GAS `uploadImage` action with concurrency=2, retry×3, exponential backoff; tracks status per `imgAssignments` entry |
| `js/converter.js` | Legacy data import/conversion tools; orchestrates the full PDF→Gemini→upload→save pipeline |
| `js/announcements.js` | Dynamic banner CRUD UI — add/edit/delete rows against the `Announcements` sheet via `addAnnouncement`/`editAnnouncement`/`deleteAnnouncement` GAS actions; consumed by REAL's `window.renderAnnouncementsUI()` |

**External CDN dependencies**: jQuery, Bootstrap 5.3, Font Awesome 6.4, DataTables 1.13, pdf.js 3.11 (loaded in `<head>` for extractor).

**PDF-to-questions workflow** (converter section): user uploads a PDF → `splitter.js` decides batch ranges → `gemini.js` sends each batch to Gemini API → parsed questions displayed → `extractor.js` pulls images per question → `queue.js` uploads images to Drive → `converter.js` saves finalized questions to GAS.

## Data Format

Questions use `///` as a multi-value separator:
- `q.img` — multiple image URLs joined by `///`
- `q.choices` — choice texts joined by `///`
- `q.category` — array of categoryIds

Image URLs from Google Drive are transformed via `window.transformUrl()` to use the direct download format.

## Key Invariants

- **Functions here are NOT on `window.*`** — the opposite convention from REAL. Don't assume cross-file access works the same way; check script load order in `index.html` when wiring new modules.
- **`///` is the data delimiter** for multi-value fields — never use commas or pipes inside question data.
- **Session token**: admin edit-modal calls send GAS-issued `sessionToken`, matching REAL's 30-day session system.
- Converter pipeline state (batch assignments, image dedup hashes, upload queue status) lives across `splitter.js`/`extractor.js`/`queue.js`/`converter.js` — changes to one often require checking the others for consistency.

## Known Open Issues (this repo)

- 🔴 Backend's `getAllData` (called by this dashboard) is served unauthenticated by GAS — verify session-gating expectations before relying on it for anything sensitive.
- 🟡 `js/api.js` missing `redirect:'follow'` — cosmetic only, `fetch` follows redirects by default.

Full cross-repo issue list: parent `Idea/active/code-review-2026-06-14.md` or `/issuelist`. Converter-specific planning docs: parent `Idea/DATABASE/combined-converter-plan.md`.
