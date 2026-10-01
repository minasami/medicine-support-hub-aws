# Medicine Support Hub: Subscription and Medicine Access Prototype

## Inspiration
Medicine assistance programs need better coordination between requesters, pharmacies, organizations and supporters. This project explores how recurring digital subscriptions and clear status information could support that work.

## What it does
The AWS-hosted prototype includes a sponsor portal with RevenueCat Web SDK integration. Verified customer entitlements and local demo previews are displayed separately. A verified ad_free entitlement hides a sample promotional panel.

It also provides synthetic local notification examples for refill reminders, supporter updates and verification tasks. These are demonstrations, not operational campaigns or evidence of actual patient care.

## How it is built
React, TypeScript and Vite power the interface hosted on AWS Amplify. Appwrite remains the application backend. The database has not been migrated to AWS.

RevenueCat provides the checkout and customer-entitlement APIs. The code fails closed when verification fails. Provider configuration and a recorded sandbox transaction must be completed and verified before claiming a working end-to-end purchase in the submission.

## What remains planned
Pharmacy payouts, dispensing verification, patient allocation, audited impact reports, automatic notification campaigns, cross-device subscription identity and AWS database migration remain future work.

No guaranteed medicine quantity, certified bioequivalence, clinical safety outcome, funding multiplier, partner endorsement or real ad revenue is claimed.

## Judge testing
- Open /sponsor.
- Judge demo preview displays sample tier labels only. It does not create a purchase, trial, donation or paid access.
- When RevenueCat sandbox checkout is configured, use the checkout and refresh-access controls to inspect SDK-verified entitlements.
- Notification previews use synthetic text and local browser notifications.
- Sample message views have no monetary value.

## Before submitting
Verify current category eligibility, supported platform requirements, academic enrollment/email where applicable, repository visibility/license, and the public demo-video link. Document which parts were built for this event and the project's prior history. This text does not claim hackathon eligibility or a completed store release.

Do not submit claims of successful sandbox purchases until they have actually been tested and recorded.
