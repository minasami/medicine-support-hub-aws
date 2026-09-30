# EPTTS Phase 1 CSV workshop

Route: `/industry/eptts`

## Purpose

Help pharmaceutical manufacturers and importers prepare EDA EPTTS Phase 1
CSV files for commissioning and packing without turning Medicine Support Hub
into a national reporting gateway.

Reference: Egyptian Drug Authority `EDREX:NP.CIP.004/2026` version 2/0.

## What this module does

- Serves the official 11-column header
- Downloads a compact BATCH003-style worked example
- Validates a local CSV in the browser
- Links manufacturers toward `/industry` profile claim

## What this module does not do

- Upload or proxy files to EPTTS / EDA
- Store serial numbers in the encyclopedia
- Report shipping, receiving, unpacking, dispensing, or destruction events
- Change company-claim, workspace, pharmacy, or NGO workflows

## Files

- `apps/web/src/lib/eptts-phase1.ts` — parser and rules
- `apps/web/src/lib/eptts-phase1.test.ts`
- `apps/web/src/pages/industry-eptts-workshop.tsx`
- Entry points: industry registration card, company workspace button

## Test

```bash
pnpm test:eptts-phase1
```

Validation checks local file structure and supported rules; it cannot confirm EDA acceptance, identifier ownership, or earlier uploads. The page does not submit or persist CSV contents.
