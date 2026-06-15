---
"@checkstack/notification-smtp-backend": patch
---

Bump `nodemailer` from 8.x to 9.0.0 to remediate a vulnerability flagged in the
production image scan. The API surface used by this plugin (`createTransport`,
`Transporter`, `sendMail`) is unchanged, so there is no behavioral difference.
