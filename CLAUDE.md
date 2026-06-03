# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **static HTML/JS web application** for HR document management — specifically a Thai-language Job Description (JD) form with a multi-step digital signature and approval workflow. The app is deployed to GitHub Pages on every push to `main`.

There is no build step, no package manager, and no framework. Open any `.html` file directly in a browser or serve with a local static server (e.g. `python3 -m http.server 8080`).

## Architecture: Multi-Step Approval Workflow

The four HTML pages represent sequential steps in the JD approval process:

```
index.html → (email link) → approval.html → (email link) → preview.html → contract.html
Step 1: Requestor fills JD         Step 2: Manager approves       Step 3: HR signs      Step 4: Contract view
```

Each page after `index.html` is loaded via URL query `?id=DOCUMENT_ID`, where the ID is a Firestore document key.

**Document status flow in Firestore:**
- `APPLICANT_SUBMITTED` — set by `index.html` when requestor submits
- `APPROVED` — set by `approval.html` when manager approves
- `COMPLETED` — set by `preview.html` when HR completes signing

## External Services

- **Firebase Firestore** — all form data and signatures (base64 image strings) are stored in the `job_descriptions` collection. Config is in [js/firebase-config.js](js/firebase-config.js). The project ID is `jd-online-1ee75`.
- **EmailJS** — sends notification emails between steps. Config (service ID, template ID, public key, recipient email) lives in [js/mailjs-config.js](js/mailjs-config.js).
- **html2pdf.js** (CDN) — used by `exportPDF()` in [js/pdf-export.js](js/pdf-export.js) and `exportContractPDF()` in [js/contract.js](js/contract.js) to generate downloadable A4 PDFs.

## Signature System

Each form has up to 4 signature boxes (IDs 1–4):
- **sig1** — Requested By (requestor, editable on `index.html`)
- **sig2** — HR Dept (editable only on `preview.html`)
- **sig3** — Approver (editable only on `approval.html`)
- **sig4** — Employee acknowledgement (editable on `index.html`)

Each box supports two modes toggled by radio button: **draw** (HTML5 Canvas) or **upload** (file input resized to JPEG base64). `initSignatureBox(id)` in [js/script.js](js/script.js) sets up both modes; `preview.js` has its own local copy of this function. Signatures are stored as base64 data URLs in the Firestore `signatures` sub-object.

On `index.html`, sig2 and sig3 are locked (pointer-events disabled) — only the HR and Manager pages can fill those. On `approval.html` and `preview.html`, all inputs are disabled by default and only the relevant signature box is re-enabled.

## PDF Export

`exportPDF()` temporarily replaces all `<input>`, `<textarea>`, and `<select>` elements with `<span>` text nodes (because html2pdf cannot render form controls), renders `.container` to PDF, then restores the original elements. Elements with class `.no-print` are hidden during export.

## Key Files

| File | Role |
|------|------|
| [js/script.js](js/script.js) | Core form logic: textarea auto-expand, auto-numbering, `collectFormData()`, `initSignatureBox()`, Firestore save + email trigger |
| [js/firebase-config.js](js/firebase-config.js) | Firebase initialization; exports global `db` |
| [js/mailjs-config.js](js/mailjs-config.js) | EmailJS config; exposes `window.sendEmailToHR()` and `window.sendApprovalEmail()` |
| [js/pdf-export.js](js/pdf-export.js) | `exportPDF()` — shared across index and preview pages |
| [js/approval.js](js/approval.js) | Step 2 approval page: loads Firestore doc, enables sig3 only |
| [js/preview.js](js/preview.js) | Step 3 HR preview: loads Firestore doc, enables sig2 only |
| [js/contract.js](js/contract.js) | Step 4 contract view: renders read-only contract template + PDF export |
| [css/style.css](css/style.css) | All styles including `.no-print` media query rules |

## Deployment

Push to `main` → GitHub Actions ([.github/workflows/static.yml](.github/workflows/static.yml)) deploys the entire repo to GitHub Pages automatically. No build step required.
