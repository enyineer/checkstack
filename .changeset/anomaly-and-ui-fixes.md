---
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/maintenance-backend": minor
---

## Anomaly Detection & UI Improvements

### Anomaly Detection Enhancements (Phase 2)
- **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
- **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
- **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
- **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
- **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
- **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

### Notification Identifiers
- **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
- **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

### UI Experience
- **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
- **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
- **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.
