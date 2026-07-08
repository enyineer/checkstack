---
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/notification-common": minor
---

Include the latest incident and maintenance update text in subscriber
notifications. The update message is now escaped, single-lined, truncated, and
appended to the notification body as a blockquote, so subscribers see WHAT
changed rather than a generic "has been updated"/"has been scheduled".
Message-only updates (no status change) now notify too, and an incident's
initial message is carried into its "reported" notification. Maintenance now has
full parity with incidents: its update text reaches subscribers, internal-only
operator notes never notify or leak text, and a completion note is carried into
the "completed" notification.

The escaping/truncation helper (`sanitizeUpdateMessage` /
`buildUpdateMessageSuffix`) now lives in `@checkstack/notification-common` so
both domain backends share one implementation.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
