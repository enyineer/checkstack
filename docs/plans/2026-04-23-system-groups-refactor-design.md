# System Groups Card Refactor Design

## Overview
The System Groups overview on the Checkstack dashboard currently uses a single-line layout for its system cards. When a system experiences multiple issues (e.g., an active incident, an SLO breach, and an unhealthy status), the dynamically rendered badges stack clumsily on the right side of the card, compressing the layout and increasing visual clutter. Furthermore, perfectly healthy systems display a green "Healthy" badge, which adds unnecessary noise when we only need to monitor for exceptions.

This document outlines the design for an "Exception-Based Badging" model and a "Two-Line Card Layout" to significantly improve the density, readability, and user experience of the System Groups dashboard.

## Approach

### 1. Exception-Based Badging (Plugins)
To reduce visual clutter, we will transition to an exception-based badging strategy. Plugins will only render their respective badges if a system is in an actionable or degraded state. Nominal states will return `null`.

- **Healthcheck Plugin (`SystemHealthBadge`)**: Returns `null` if the status is `"healthy"`. Only renders for `"degraded"`, `"unhealthy"`, or `"unknown"`.
- **SLO Plugin (`SystemSloBadge`)**: Returns `null` if the SLO is not currently breaching.
- **Incident Plugin (`SystemIncidentBadge`)**: Returns `null` if there are no active incidents affecting the system.
- **Maintenance Plugin (`SystemMaintenanceBadge`)**: Returns `null` if the system is not currently in a maintenance window.

By enforcing this across plugins, perfectly healthy systems will contribute zero badges to the extension slot, cleanly highlighting only the systems requiring attention.

### 2. Two-Line Card Layout (Dashboard)
The `Dashboard` component will be updated to accommodate the badges gracefully, regardless of how many plugins inject active warnings.

- **Layout Structure**: The system card (button) will change from a `flex-row` to a `flex-col` layout.
- **Top Row**: A full-width `flex` container holding the system icon and name on the left, and the `ChevronRight` icon on the far right.
- **Bottom Row (Slot Wrapper)**: The `SystemStateBadgesSlot` will be rendered beneath the system name. It will be wrapped in a container utilizing `flex-wrap gap-2` to allow multiple badges to wrap to a new line cleanly without compressing the card width.
- **Zero-Space Empty State**: The bottom row container will use the Tailwind `empty:hidden` utility. When the system is healthy and all plugins return `null`, the bottom row will collapse entirely, leaving the card looking like a sleek, standard list item.

## Benefits
- **Decoupled Architecture**: Preserves the `ExtensionSlot` pattern without tightly coupling the `SystemBadgeDataProvider` to arbitrary plugins like SLOs.
- **Information Hierarchy**: Draws the user's eye instantly to systems with issues by removing the noise of nominal "Healthy" badges.
- **Responsive Design**: Prevents layout breakage by giving badges an entire flex-wrapped row to expand into.
