---
"@checkstack/backend-api": patch
---

Link the "Checkstack" wordmark in email notification footers to
https://checkstack.dev.

The footer text ("This is an automated notification from Checkstack.") now
renders "Checkstack" as a link to the public site. The footer string is still
HTML-escaped first and only the trusted anchor is injected, so a custom footer
cannot introduce markup; a custom footer that does not mention "Checkstack" is
left untouched.
