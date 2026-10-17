"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkAddRulesAction,
  bulkDeleteRulesAction,
  bulkEditRulesAction,
  deleteRuleAction,
  fillMissingPredefinedRulesAction,
  importRulesBatchAction,
  saveRuleAction,
  toggleRuleAction,
  type ActionResult,
} from "@/app/actions/books";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { parseImportFile } from "@/lib/import-parser";
import { parseRulesFromImportMatrix } from "@/lib/rules-import";

type StarterRule = {
  name: string;
  descriptionMatch: string;
  accountName: string;
  taxCodes: string[];
  provinceTaxCodes: string[];
};

export type RuleRow = {
  id: string;
  name: string;
  descriptionMatch: string;
  matchType: "CONTAINS" | "STARTS" | "EXACT" | "REGEX";
  appliesTo: "BOTH" | "BANK" | "CREDIT_CARD";
  applyDeposit: boolean;
  applyWithdrawal: boolean;
  accountNumber: string | null;
  accountName: string | null;
  taxCodes: string[];
  provinceTaxCodes: string[];
  taxMode: "INCLUSIVE" | "EXCLUSIVE" | "KEEP";
  active: boolean;
  isBuiltIn: boolean;
  learned: boolean;
};

type AccountOption = { number: string; name: string };
type TaxOption = { code: string; name: string; kind?: string };

type RuleDraft = Omit<RuleRow, "accountNumber" | "accountName"> & {
  accountNumber: string;
  accountName: string;
  isNew?: boolean;
};

function toDraft(r: RuleRow): RuleDraft {
  return {
    ...r,
    accountNumber: r.accountNumber ?? "",
    accountName: r.accountName ?? "",
  };
}

function blankDraft(): RuleDraft {
  return {
    id: "",
    name: "",
    descriptionMatch: "",
    matchType: "CONTAINS",
    appliesTo: "BOTH",
    applyDeposit: true,
    applyWithdrawal: true,
    accountNumber: "",
    accountName: "",
    taxCodes: [],
    provinceTaxCodes: [],
    taxMode: "INCLUSIVE",
    active: true,
    isBuiltIn: false,
    learned: false,
    isNew: true,
  };
}

export function RulesManager({
  rules,
  accounts,
  taxCodes,
  canEdit,
  starterRules = [],
  starterRulesVisible = false,
}: {
  rules: RuleRow[];
  accounts: AccountOption[];
  taxCodes: TaxOption[];
  canEdit: boolean;
  starterRules?: StarterRule[];
  starterRulesVisible?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => rules.map(toDraft));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDrafts(rules.map(toDraft));
    const liveIds = new Set(rules.map((r) => r.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rules]);

  const existingNames = useMemo(
    () => new Set(drafts.map((d) => d.name.trim()).filter(Boolean)),
    [drafts],
  );
  const missingStarterCount = useMemo(
    () => starterRules.filter((r) => !existingNames.has(r.name)).length,
    [starterRules, existingNames],
  );

  const gstOptions = useMemo(
    () => taxCodes.filter((t) => !t.kind || t.kind === "GST_HST" || t.kind === "NONE" || t.kind === "OTHER"),
    [taxCodes],
  );
  const pstOptions = useMemo(() => taxCodes.filter((t) => t.kind === "PST"), [taxCodes]);

  const filtered = useMemo(() => {
    const terms = query
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const rows = drafts.map((d, index) => ({ d, index }));
    if (!terms.length) return rows;
    return rows.filter(({ d }) => {
      const hay = `${d.name} ${d.descriptionMatch} ${d.accountName}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [drafts, query]);

  const visibleIds = filtered.map(({ d }) => d.id).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function updateDraft(index: number, patch: Partial<RuleDraft>) {
    setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setAccountFromPick(index: number, value: string) {
    const [number, ...rest] = value.split("||");
    const name = rest.join("||");
    updateDraft(index, { accountNumber: number || "", accountName: name || "" });
  }

  function setGstCode(index: number, code: string) {
    updateDraft(index, { taxCodes: code ? [code] : [] });
  }

  function setPstCode(index: number, code: string) {
    updateDraft(index, { provinceTaxCodes: code ? [code] : [] });
  }

  function toggleDepositWithdrawal(index: number, field: "applyDeposit" | "applyWithdrawal", checked: boolean) {
    const row = drafts[index];
    if (!row) return;
    const next = { ...row, [field]: checked };
    if (!next.applyDeposit && !next.applyWithdrawal) {
      toast.warning("A rule must apply to Deposit, Withdrawal, or both.");
      updateDraft(index, { [field]: true });
      return;
    }
    updateDraft(index, { [field]: checked });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function addRow() {
    setDrafts((prev) => [...prev, blankDraft()]);
  }

  function removeRow(index: number) {
    const row = drafts[index];
    if (!row) return;
    if (row.id && !row.isNew) {
      if (!confirm(`Delete rule “${row.name || "Untitled"}”?`)) return;
      startTransition(async () => {
        const fd = new FormData();
        fd.set("id", row.id);
        const result = await deleteRuleAction(fd);
        if (!result.ok) {
          toast.error(result.error ?? "Delete failed");
          return;
        }
        setDrafts((prev) => prev.filter((_, i) => i !== index));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        toast.success(result.message ?? "Rule deleted.");
        router.refresh();
      });
      return;
    }
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function fillPredefinedRules() {
    startTransition(async () => {
      const result = await fillMissingPredefinedRulesAction();
      if (result.ok) {
        toast.success(result.message ?? "Predefined rules added.");
        setStarterOpen(false);
        router.refresh();
      } else toast.error(result.error ?? "Could not add predefined rules.");
    });
  }

  function saveAll() {
    startTransition(async () => {
      let saved = 0;
      for (const row of drafts) {
        const descriptionMatch = row.descriptionMatch.trim();
        if (!descriptionMatch) continue;
        const fd = new FormData();
        if (row.id && !row.isNew) fd.set("id", row.id);
        fd.set("name", row.name.trim() || descriptionMatch.split(",")[0]?.trim() || descriptionMatch);
        fd.set("descriptionMatch", descriptionMatch);
        fd.set("matchType", row.matchType);
        fd.set("appliesTo", row.appliesTo);
        if (row.applyDeposit) fd.set("applyDeposit", "on");
        if (row.applyWithdrawal) fd.set("applyWithdrawal", "on");
        fd.set("accountNumber", row.accountNumber.trim());
        fd.set("accountName", row.accountName.trim());
        fd.set("taxCodes", row.taxCodes.join(", "));
        fd.set("provinceTaxCodes", row.provinceTaxCodes.join(", "));
        fd.set("taxMode", row.taxMode);
        if (row.active) fd.set("active", "on");
        const result: ActionResult = await saveRuleAction(undefined, fd);
        if (!result.ok) {
          toast.error(result.error ?? `Failed to save rule`);
          return;
        }
        saved += 1;
      }
      toast.success(`Saved ${saved} rule${saved === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  async function onImportFile(file: File) {
    try {
      const matrix = await parseImportFile(file);
      const { rules: imported, skipped, unknownTaxCells } = parseRulesFromImportMatrix(matrix, {
        taxCodes,
        accounts,
      });
      const fd = new FormData();
      fd.set("rules", JSON.stringify(imported));
      const result = await importRulesBatchAction(fd);
      if (result.ok) {
        let msg = result.message ?? "Rules imported.";
        if (skipped) msg += ` Skipped ${skipped} empty row(s).`;
        if (unknownTaxCells) msg += ` ${unknownTaxCells} tax cell(s) did not match your tax library.`;
        toast.success(msg);
        router.refresh();
      } else toast.error(result.error ?? "Import failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read rules file.");
    }
  }

  function bulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected rules?`)) return;
    const idsToDelete = new Set(selected);
    const fd = new FormData();
    fd.set("ids", [...idsToDelete].join(","));
    startTransition(async () => {
      const result = await bulkDeleteRulesAction(fd);
      if (result.ok) {
        setDrafts((prev) => prev.filter((row) => !row.id || !idsToDelete.has(row.id)));
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
        setBulkEditOpen(false);
        router.refresh();
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  async function submitPaste(formData: FormData) {
    const result = await bulkAddRulesAction(undefined, formData);
    if (result.ok) {
      toast.success(result.message ?? "Added");
      setPasteOpen(false);
      router.refresh();
    } else toast.error(result.error ?? "Paste failed");
  }

  return (
    <div className="settings-page">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xls"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportFile(file);
          e.target.value = "";
        }}
      />

      <div className="settings-head">
        <h1>Transaction Rules</h1>
        <button type="button" className="btn-converter btn-light btn-sm" onClick={() => router.push("/app")}>
          Back to Transactions
        </button>
      </div>

      <p className="hint">
        Rules are saved for the <strong>active client</strong> only. Predefined Canada merchant rules are not listed
        until you click <strong>Add predefined rules</strong> — then you can edit or delete them. Deleted predefined
        rules stay gone until you add them again from that button. Description Match is required. Click Save Rules after
        editing the table.
      </p>

      {canEdit ? (
        <div className="settings-toolbar" style={{ marginTop: 0, marginBottom: 14 }}>
          <button type="button" className="btn-converter btn-light" onClick={addRow}>
            + Add Rule
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            onClick={() => {
              setStarterOpen(true);
              setPasteOpen(false);
              setBulkEditOpen(false);
            }}
          >
            + Add predefined rules
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            onClick={() => {
              setPasteOpen(true);
              setBulkEditOpen(false);
              setStarterOpen(false);
            }}
          >
            Bulk paste add
          </button>
          <button type="button" className="btn-converter btn-primary" onClick={() => fileRef.current?.click()}>
            Import Rules — CSV / Excel
          </button>
          <button type="button" className="btn-converter btn-green" disabled={pending} onClick={saveAll}>
            {pending ? "Saving…" : "Save Rules"}
          </button>
        </div>
      ) : null}

      {canEdit && starterOpen && starterRules.length > 0 ? (
        <div className="settings-paste-box">
          <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800 }}>
            Predefined rules ({starterRules.length})
          </h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            {starterRulesVisible
              ? missingStarterCount > 0
                ? `${missingStarterCount} predefined rule${missingStarterCount === 1 ? "" : "s"} can still be added for this client.`
                : "All predefined rules are already on this client. Bulk-delete removes them until you add them again here."
              : "Click below to add the predefined Canada merchant rules for this client. Nothing is shown in the table until you confirm."}
          </p>
          <DualScrollArea
            className="settings-table-wrap"
            style={{ marginBottom: 12 }}
            mainStyle={{ maxHeight: 280 }}
          >
            <table className="list-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: "28%" }}>Rule</th>
                  <th>Match</th>
                  <th style={{ width: "22%" }}>Category</th>
                  <th style={{ width: 88 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {starterRules.map((r) => {
                  const present = existingNames.has(r.name);
                  return (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td style={{ fontSize: 12 }}>{r.descriptionMatch}</td>
                      <td>{r.accountName}</td>
                      <td>{present ? "In library" : "Missing"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DualScrollArea>
          <div className="settings-paste-actions">
            <button
              type="button"
              className="btn-converter btn-green"
              disabled={pending}
              onClick={fillPredefinedRules}
            >
              {pending
                ? "Adding…"
                : starterRulesVisible
                  ? missingStarterCount > 0
                    ? `Add ${missingStarterCount} to this client`
                    : "Show rules list (already complete)"
                  : `Add predefined rules (${starterRules.length})`}
            </button>
            <button type="button" className="btn-converter btn-light" onClick={() => setStarterOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div className="settings-filter-row">
        <input
          type="search"
          placeholder="Search rules (comma-separated terms)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {canEdit && selected.size > 0 ? (
        <div className="selection-bar">
          <span>{selected.size} selected</span>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={() => setBulkEditOpen(true)}>
            Bulk edit
          </button>
          <button type="button" className="btn-converter btn-danger btn-sm" disabled={pending} onClick={bulkDelete}>
            Bulk delete
          </button>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {canEdit && pasteOpen ? (
        <div className="settings-paste-box">
          <p className="hint" style={{ marginBottom: 10 }}>
            Paste one value per line. Line 1 from each column creates rule 1, and so on.
          </p>
          <form action={submitPaste} className="settings-paste-grid">
            <div>
              <label className="field-label">Rule names</label>
              <textarea name="names" rows={6} placeholder={"Meals - Tim Hortons"} />
            </div>
            <div>
              <label className="field-label">Description match</label>
              <textarea name="matches" rows={6} placeholder={"TIM HORTONS"} required />
            </div>
            <div>
              <label className="field-label">Account names</label>
              <textarea name="accounts" rows={6} />
            </div>
            <div>
              <label className="field-label">Account numbers</label>
              <textarea name="accountNumbers" rows={6} />
            </div>
            <div>
              <label className="field-label">GST/HST codes</label>
              <textarea name="taxes" rows={6} />
            </div>
            <div>
              <label className="field-label">PST codes</label>
              <textarea name="provinceTaxes" rows={6} />
            </div>
            <div>
              <label className="field-label">Tax mode</label>
              <textarea name="modes" rows={6} placeholder={"INCLUSIVE"} />
            </div>
            <div className="settings-paste-actions">
              <button type="submit" className="btn-converter btn-green">
                Add pasted rules
              </button>
              <button type="button" className="btn-converter btn-light" onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {canEdit && bulkEditOpen && selected.size > 0 ? (
        <div className="settings-paste-box">
          <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800 }}>Bulk edit {selected.size} rules</h3>
          <form
            action={async (fd) => {
              const result = await bulkEditRulesAction(undefined, fd);
              if (result.ok) {
                toast.success(result.message ?? "Updated");
                setBulkEditOpen(false);
                setSelected(new Set());
                router.refresh();
              } else toast.error(result.error ?? "Bulk edit failed");
            }}
            className="settings-paste-grid"
          >
            <input type="hidden" name="ids" value={[...selected].join(",")} />
            <label className="field-label">
              <input type="checkbox" name="applyAccount" /> Update category / account
            </label>
            <div>
              <label className="field-label">Account number</label>
              <input name="accountNumber" placeholder="5610" />
            </div>
            <div>
              <label className="field-label">Account name</label>
              <input name="accountName" placeholder="Meals" />
            </div>
            <label className="field-label">
              <input type="checkbox" name="applyTax" /> Update tax codes & mode
            </label>
            <div>
              <label className="field-label">GST/HST (comma-separated)</label>
              <input name="taxCodes" placeholder="GST5" />
            </div>
            <div>
              <label className="field-label">PST (comma-separated)</label>
              <input name="provinceTaxCodes" placeholder="BC PST7" />
            </div>
            <div>
              <label className="field-label">Tax mode</label>
              <select name="taxMode" defaultValue="INCLUSIVE">
                <option value="INCLUSIVE">Inclusive</option>
                <option value="EXCLUSIVE">Exclusive</option>
                <option value="KEEP">Keep</option>
              </select>
            </div>
            <div className="settings-paste-actions">
              <button type="submit" className="btn-converter btn-green">
                Apply to selected
              </button>
              <button type="button" className="btn-converter btn-light" onClick={() => setBulkEditOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <DualScrollArea className="settings-table-wrap">
        <table className="list-table rules-table">
          <thead>
            <tr>
              {canEdit ? (
                <th style={{ width: 42, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    title="Select all visible rules"
                  />
                </th>
              ) : null}
              <th>Rule Name</th>
              <th>Description Match</th>
              <th>Match Type</th>
              <th>Applies To</th>
              <th>Deposit</th>
              <th>Withdrawal</th>
              <th className="rule-account-num-col">Account Number</th>
              <th className="rule-category-col">Category / Account</th>
              <th className="rule-tax-head">GST / HST</th>
              <th className="rule-tax-head">PST / QST / RST</th>
              <th>Tax Treatment</th>
              <th>Active</th>
              <th className="rule-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ d, index }) => (
              <tr key={d.id || `new-${index}`}>
                {canEdit ? (
                  <td style={{ textAlign: "center" }}>
                    {d.id ? (
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                    ) : null}
                  </td>
                ) : null}
                <td>
                  <input
                    value={d.name}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { name: e.target.value })}
                  />
                  {d.isBuiltIn ? <span className="rule-badge builtin">Predefined</span> : null}
                  {d.learned ? (
                    <span className="rule-badge" style={{ background: "#e8f4fc", border: "1px solid #b8d9ef" }}>
                      Learned
                    </span>
                  ) : null}
                </td>
                <td>
                  <input
                    value={d.descriptionMatch}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { descriptionMatch: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={d.matchType}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft(index, { matchType: e.target.value as RuleDraft["matchType"] })
                    }
                  >
                    <option value="CONTAINS">Contains</option>
                    <option value="STARTS">Starts with</option>
                    <option value="EXACT">Exact</option>
                    <option value="REGEX">Regex</option>
                  </select>
                </td>
                <td>
                  <select
                    value={d.appliesTo}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft(index, { appliesTo: e.target.value as RuleDraft["appliesTo"] })
                    }
                  >
                    <option value="BOTH">Bank & Credit Card</option>
                    <option value="BANK">Bank only</option>
                    <option value="CREDIT_CARD">Credit Card only</option>
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={d.applyDeposit}
                    disabled={!canEdit}
                    onChange={(e) => toggleDepositWithdrawal(index, "applyDeposit", e.target.checked)}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={d.applyWithdrawal}
                    disabled={!canEdit}
                    onChange={(e) => toggleDepositWithdrawal(index, "applyWithdrawal", e.target.checked)}
                  />
                </td>
                <td className="rule-account-num-col">
                  <input
                    value={d.accountNumber}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { accountNumber: e.target.value })}
                  />
                </td>
                <td className="rule-category-col">
                  <select
                    value={d.accountNumber || d.accountName ? `${d.accountNumber}||${d.accountName}` : ""}
                    disabled={!canEdit}
                    onChange={(e) => setAccountFromPick(index, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {accounts.map((a) => (
                      <option key={a.number} value={`${a.number}||${a.name}`}>
                        {a.number} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="rule-tax-col">
                  <select
                    disabled={!canEdit}
                    value={d.taxCodes[0] ?? ""}
                    onChange={(e) => setGstCode(index, e.target.value)}
                  >
                    <option value="">— None —</option>
                    {gstOptions.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="rule-tax-col">
                  <select
                    disabled={!canEdit}
                    value={d.provinceTaxCodes[0] ?? ""}
                    onChange={(e) => setPstCode(index, e.target.value)}
                  >
                    <option value="">— None —</option>
                    {pstOptions.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={d.taxMode}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft(index, { taxMode: e.target.value as RuleDraft["taxMode"] })
                    }
                  >
                    <option value="INCLUSIVE">Inclusive</option>
                    <option value="EXCLUSIVE">Exclusive</option>
                    <option value="KEEP">Keep existing</option>
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={d.active}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { active: e.target.checked })}
                  />
                </td>
                <td className="rule-actions-col">
                  {canEdit ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {d.id ? (
                        <form action={toggleRuleAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <button type="submit" className="btn-converter btn-light btn-sm">
                            {d.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                      ) : null}
                      <button
                        type="button"
                        className="btn-converter btn-danger btn-sm"
                        onClick={() => removeRow(index)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 14 : 13}
                  style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}
                >
                  No rules match your search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DualScrollArea>
    </div>
  );
}
