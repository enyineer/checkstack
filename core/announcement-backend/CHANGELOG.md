# @checkstack/announcement-backend

## 0.2.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/auth-backend@0.4.15
- @checkstack/command-backend@0.1.16

## 0.2.0

### Minor Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

### Patch Changes

- Updated dependencies [dee86ec]
  - @checkstack/announcement-common@0.2.0
