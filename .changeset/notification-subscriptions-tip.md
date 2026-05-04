---
"@checkstack/notification-frontend": patch
---

Add a `<Tip>` next to the title in the notification-subscriptions modal
that explains the two things that confuse first-time users: (1) the
difference between subscribing to an individual system vs. subscribing
to a whole group (groups auto-include systems added later), and (2) the
difference between "Subscribe to all" and toggling specific rows for
just the event types they care about. Tip id:
`notification.subscriptions.intro`.
