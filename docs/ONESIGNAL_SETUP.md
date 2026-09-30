# Notification prototype status

The web shell loads OneSignal Web SDK v16 and its worker. Loading an SDK does not establish that remote delivery or retention campaigns work.

The sponsor portal offers synthetic **local browser notification previews** through `triggerSimulatedNotification`. These are not OneSignal remote pushes. Demo buttons do not tag users as patients, paid sponsors, or bounty recipients.

Scheduled refill reminders, dispensing-triggered messages, donor streaks, and paid verification tasks are planned. Do not describe these as operational until an end-to-end delivery test and the corresponding backend workflow exist.

Before a production rollout:
- Verify domain registration and worker scope.
- Verify an actual OneSignal subscription separately from browser notification permission.
- Test a remote campaign against a consenting test subscriber.
- Use only non-sensitive notification text and minimize tags.
- Connect events to authenticated, verified application records.
