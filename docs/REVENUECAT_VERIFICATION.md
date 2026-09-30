# RevenueCat verification and release checklist

## Behavior
- SDK customer information is the only source of subscription entitlements.
- Missing configuration, missing exact package, checkout cancellation, malformed customer information, and failed refreshes never grant access.
- The browser stores an anonymous customer ID for same-browser reloads, not entitlements. Losing browser storage loses that identity; account linking and cross-device recovery are not implemented.
- Legacy demo entitlement and ad-credit storage is discarded.
- Demo previews are session-only and separate from verified access. Clearing demo state does not cancel or alter subscriptions.
- The sample ad panel is hidden only when RevenueCat returns an active, unexpired `ad_free` entitlement.
- Entitlements are refreshed on portal mount, focus, every minute while mounted, and when opening the modal. Expiry is also checked when state is read.
- UI checks are not backend authorization. No clinical API or patient data may rely on browser state for access control.

## Configuration
The repository uses RevenueCat Web SDK `@revenuecat/purchases-js`. This change does not configure native store billing.
Use the existing deployment configuration to supply the public SDK configuration; never place secret API keys in Vite variables.
- `VITE_REVENUECAT_PUBLIC_API_KEY`: actual Web Billing public SDK key.
- `VITE_REVENUECAT_PROJECT_ID`: associated RevenueCat project.
- `VITE_REVENUECAT_CHECKOUT_ENABLED=true`: explicit checkout rollout switch, disabled when absent.

No credentials or provider settings were changed in this PR.
The current offering must contain exact package identifiers:
- `tier_patient_sponsor` -> `patient_sponsor`
- `tier_medicine_angel` -> `medicine_angel`
- `tier_clinical_pro_annual` -> `clinical_pro`

Attach `ad_free` to the intended products if that feature is included. Access is never inferred from another entitlement.
Illustrative plan prices do not control billing. Configure currency, recurring prices and trials in RevenueCat, and review the actual checkout terms.

## Required release evidence
1. Use a dedicated sandbox configuration and synthetic customer.
2. Confirm offerings load, complete a sandbox purchase, and match customer ID, product and entitlement in RevenueCat.
3. Reload the same browser: verified access should return from RevenueCat without using legacy demo state.
4. Cancel checkout and simulate a network failure: no newly granted access.
5. Verify expiration or revocation removes access after refresh.
6. Redeem the demo code: only demo labels change; verified entitlements and ad-free access do not.
7. Record the real test flow. Do not claim verified live billing until this evidence exists.

## Checks
`node --test apps/web/src/lib/revenuecat-access.test.mjs`
`pnpm run typecheck`
`pnpm run build`

Official references:
- https://www.revenuecat.com/docs/web/web-billing/web-sdk
- https://www.revenuecat.com/docs/customers/customer-info

## Remaining work
Production payment suitability, account-linked identity, server-side authorization and fulfillment accounting are separate rollout requirements. AWS database migration is not part of this purchase-flow repair.
