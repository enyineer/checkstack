# Dashboard Overview Sheets Design

## Overview
Currently, clicking the "Active Incidents" or "Active Maintenances" cards on the dashboard redirects users to the respective management pages in the incident or maintenance plugins. This creates a permissions barrier, as users without manage access will encounter unauthorized errors. 

To gracefully degrade for non-admin users and improve UX for everyone, we will introduce slide-out overview sheets directly on the dashboard. These sheets will display a read-only list of active events using data already fetched by the dashboard, while gracefully gating the "Manage" navigation button behind access control checks.

## Architecture

### 1. Data Flow & State Management
- `Dashboard.tsx` already fetches active incidents and maintenances via the respective API clients. We will leverage this existing data.
- We will add standard React boolean state to `Dashboard.tsx` to control the visibility of the new sheets (e.g., `isIncidentSheetOpen`, `isMaintenanceSheetOpen`).
- The `onClick` handlers of the status cards will be updated to toggle these state variables instead of performing direct client-side routing.

### 2. Overview Sheet Components
We will create two new components in `@checkstack/dashboard-frontend`:
- `IncidentOverviewSheet.tsx`
- `MaintenanceOverviewSheet.tsx`

**Props Contract:**
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `incidents`/`maintenances`: The array of active events.
- `systems: System[]`: The catalog systems array, used to map system IDs to human-readable system names.

**Internal Layout:**
- Using the standard `@checkstack/ui` Sheet components (`Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`).
- The body will contain a scrollable list of simple cards.
- Each item card will display the event title, its severity/status (using existing badges where appropriate), and a comma-separated list of affected systems.

### 3. Graceful Degradation & Access Control
- In the `SheetHeader` of each overview component, we will place a "Manage" button.
- We will wrap this button in a permission check using `useHasAccess` from `@checkstack/frontend-api`.
- We will check `incidentAccess.incident.manage` for incidents, and `maintenanceAccess.maintenance.manage` for maintenances.
- If the user possesses the required permission, the button will render and link to the configuration page.
- If the user lacks the permission, the button will be hidden, leaving the read-only overview sheet as the sole interaction point.
