export const WORKSPACE_TABS = [
  { id: "transactions", label: "Transactions" },
  { id: "general-entries", label: "General Entries" },
  { id: "transfers", label: "Transfer Matching" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "gst", label: "GST Calculation" },
  { id: "pst", label: "PST Calculation" },
] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]["id"];

export function parseWorkspaceTab(raw: string | undefined): WorkspaceTabId {
  if (!raw || raw === "transactions") return "transactions";
  const found = WORKSPACE_TABS.find((t) => t.id === raw);
  return found?.id ?? "transactions";
}
