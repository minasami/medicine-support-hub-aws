# RevenueCat dashboard audit

Observed September 30, 2026 in the signed-in Medicine Support Hub project (`proj8b481083`). No provider settings were changed and no purchase was performed.

## Verified state
- No web providers are configured.
- The Web page reports: "You don't have permission to add app configurations."
- The collaborator list shows the Mina account as Administrator and a separate Owner account. This audit does not infer why the web configuration control remains restricted.
- Default offering: `default` (`ofrng4eba64b0df`).
- Its Test Store packages are `$rc_monthly`, `$rc_annual`, and `$rc_lifetime`, containing `monthly`, `yearly`, and `lifetime`.
- The active entitlement list contains `create_an_app_called_medicine_support_hub_pro`, associated with three products.
- The app expects different packages and entitlements; the existing starter offering cannot satisfy that mapping.
- The current source uses the RevenueCat Web SDK. Test Store setup alone does not establish a working web checkout.

## Required mapping
| Exact app package identifier | Required entitlement | Prototype reference price |
|---|---|---|
| tier_patient_sponsor | patient_sponsor | USD 4.99/month |
| tier_medicine_angel | medicine_angel | USD 14.99/month |
| tier_clinical_pro_annual | clinical_pro | USD 49.99/year |

These are prototype reference prices, not verified provider prices or medicine-funding promises. Attach `ad_free` explicitly to the intended products; the code does not infer it from another entitlement.

## Configuration sequence
1. Resolve the Web configuration restriction with the project owner. Do not bypass the disabled/restricted workflow or transfer ownership to work around it.
2. Configure an appropriate web billing sandbox supported by the Web SDK. Keep real charges disabled.
3. Create sandbox products with agreed billing periods and explicit entitlements.
4. Create the exact packages above in an offering and select it for the test application.
5. Supply the correct public SDK configuration only in a test deployment. Never use a secret API key as a Vite variable.
6. Enable checkout only for that test deployment after reviewing its provider environment.
7. Complete one sandbox transaction using a synthetic customer, verify the provider transaction and requested entitlement, then test cancellation and same-browser reload.
8. Record evidence before claiming end-to-end billing works.

Existing Test Store resources should remain intact. A native Test Store route would require separate native SDK integration and device testing; it is not demonstrated by the current Web SDK.

## Other submission gaps
- At audit time the public repository's main branch has no root license file and GitHub reports no detected license. The package metadata says MIT, but that is not a substitute for a repository license file. Confirm the intended license and attribution before adding one.
- OneSignal award evidence needs an actual deployed campaign, not the local notification preview. No campaign was sent during this work.
- PR #4 remains a draft; no merge or production deployment was performed.

## October 1 follow-up

Rechecked the signed-in Web page on October 1, 2026: it still shows no web providers and the same permission restriction. Checkout remains unverified; this follow-up did not change provider settings or perform a purchase.

The organizer's [deadline extension announcement](https://revenuecat-shipaton-2026.devpost.com/updates) confirms submissions close October 1, 2026 at noon Pacific daylight time (19:00 UTC / 22:00 Cairo). The rules page still contains older dates in its body. Do not assume this announcement waives category, platform, licensing, SDK, or award requirements.

Immediate order of work:
1. Project owner resolves the Web configuration restriction and sets up the sandbox provider.
2. Complete the package/entitlement mapping and sandbox verification sequence above.
3. Resolve the repository license and Next Gen eligibility evidence; prepare a public demo under two minutes using only verified features.
4. Review PR #4 for merge/deployment separately. Do not claim the draft changes are live.
5. Finalize the submission before the extended deadline. Claim OneSignal award requirements only after actual deployment evidence exists.
