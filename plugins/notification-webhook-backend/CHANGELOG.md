# @checkstack/notification-webhook-backend

## 0.1.0

### Minor Changes

- 43e4484: Add a generic outgoing webhook notification channel. Each user registers their
  own URL; Checkstack POSTs a stable, versioned JSON envelope for every
  notification they are subscribed to. User-supplied URLs are guarded against SSRF
  with the platform egress guard (blocking loopback, `0.0.0.0/8`, cloud-metadata,
  link-local, and IPv6 ULA hosts, while allowing internal RFC1918 receivers) plus
  `redirect: "error"`, and an optional shared secret enables HMAC-SHA256 request
  signing via the `X-Checkstack-Signature` header.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/backend-api@0.31.1
  - @checkstack/notification-backend@1.7.0
