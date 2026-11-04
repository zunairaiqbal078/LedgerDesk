/** Browser events so HTML-style sidebar/topbar can drive the workspace panes. */
export const CONVERTER_EVENTS = {
  importStatement: "ledgerdesk:import-statement",
  openSaveConversion: "ledgerdesk:open-save-conversion",
  addBlankRow: "ledgerdesk:add-blank-row",
  applyDateFormat: "ledgerdesk:apply-date-format",
  /** Clear current bank workspace for a fresh import (New). */
  newConversion: "ledgerdesk:new-conversion",
  /** Download CSV of current transaction grid (Export). */
  exportConversion: "ledgerdesk:export-conversion",
  preferredFolderChanged: "ledgerdesk:preferred-folder-changed",
  /** Sidebar connected-account change; workspace may prompt before switching. */
  requestActiveBankChange: "ledgerdesk:request-active-bank-change",
  /** Workspace cancelled a pending bank switch — reset sidebar dropdown. */
  activeBankChangeCancelled: "ledgerdesk:active-bank-change-cancelled",
} as const;

export function dispatchConverterEvent(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
