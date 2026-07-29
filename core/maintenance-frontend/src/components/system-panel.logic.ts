import type { MaintenanceStatus } from "@checkstack/maintenance-common";

/** The minimum a window needs to expose for the system panel to summarise it. */
export interface PanelMaintenance {
  id: string;
  title: string;
  status: MaintenanceStatus;
}

/**
 * The group of windows the system panel leads with, and how to caption it.
 *
 * A running window always outranks an upcoming one: `in_progress` leads
 * whenever any exists, otherwise `scheduled` does. This mirrors the card's tone
 * choice so the number, the caption and the colour can never disagree.
 */
export interface MaintenancePanelSummary<T extends PanelMaintenance> {
  /** The leading group's windows. */
  lead: T[];
  /** Windows merely scheduled while another is already running. */
  trailingScheduled: T[];
  leadStatus: Extract<MaintenanceStatus, "in_progress" | "scheduled">;
  leadCaption: string;
  /**
   * The single leading window, when there is exactly one.
   *
   * With one window the count is nearly contentless - "1" tells the reader
   * nothing they cannot already see from the card being there at all - so the
   * panel spends the space on its TITLE and links straight to it. With two or
   * more there is no single thing to name, so the count is the honest summary.
   */
  soleLead?: T;
}

export function summariseMaintenancePanel<T extends PanelMaintenance>({
  maintenances,
}: {
  maintenances: readonly T[];
}): MaintenancePanelSummary<T> {
  const active = maintenances.filter((m) => m.status === "in_progress");
  const scheduled = maintenances.filter((m) => m.status === "scheduled");
  const leadingIsActive = active.length > 0;
  const lead = leadingIsActive ? active : scheduled;

  return {
    lead,
    trailingScheduled: leadingIsActive ? scheduled : [],
    leadStatus: leadingIsActive ? "in_progress" : "scheduled",
    leadCaption: leadingIsActive ? "in progress" : "scheduled",
    ...(lead.length === 1 ? { soleLead: lead[0] } : {}),
  };
}
