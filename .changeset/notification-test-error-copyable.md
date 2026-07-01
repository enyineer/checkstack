---
"@checkstack/notification-frontend": patch
---

Show a copyable error when a notification channel test fails. Testing a
configured channel returned `{ success, error }`, but the frontend discarded
the result - a failed test cleared the spinner and gave no feedback, so
operators had to open the browser network console to see why. The channel card
now surfaces the full error inline in a dismissible callout with a copy button
(and a success toast on a passing test). The message is shown untruncated,
unlike toasts which cap at ~100 characters, so the actual transport error is
readable and shareable.
