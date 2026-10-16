"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkAddAccountsAction,
  bulkDeleteAccountsAction,
  bulkEditAccountsAction,
  deleteAccountAction,
  fillMissingStarterAccountsAction,
  importAccountsBatchAction,
  saveAccountAction,
  type ActionResult,
} from "@/app/actions/books";
import { parseAccountsFromImportMatrix } from "@/lib/accounts-import";
import { parseImportFile } from "@/lib/import-parser";

type Account = {
  id: string;
  number: string;
  name: string;
  type: "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY";
  defaultGstCode: string | null;
  defaultPstCode: string | null;
  isSystem: boolean;
};

type TaxOption = { code: string; name: string; kind?: string };

type AccountDraft = {
  id: string;
  number: string;
  name: string;
  type: Account["type"];
  defaultGstCode: string;
  defaultPstCode: string;
  isSystem: boolean;
  isNew?: boolean;
};

function toDraft(a: Account): AccountDraft {
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    type: a.type,
    defaultGstCode: a.defaultGstCode ?? "",
    defaultPstCode: a.defaultPstCode ?? "",
    isSystem: a.isSystem,
  };
}

type StarterAccount = { number: string; name: string; type: Account["type"] };

export function AccountsManager({
  accounts,
  taxCodes,
  canEdit,
  starterAccounts = [],
  starterChartVisible = false,
}: {
  accounts: Account[];
  taxCodes: TaxOption[];
  canEdit: boolean;
  starterAccounts?: StarterAccount[];
  starterChartVisible?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<AccountDraft[]>(() => accounts.map(toDraft));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDrafts(accounts.map(toDraft));
    const liveIds = new Set(accounts.map((a) => a.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [accounts]);

  const existingNumbers = useMemo(() => new Set(drafts.map((d) => d.number.trim())), [drafts]);
  const missingStarterCount = useMemo(
    () => starterAccounts.filter((a) => !existingNumbers.has(a.number)).length,
    [starterAccounts, existingNumbers],
  );

  const gstOptions = useMemo(
    () => taxCodes.filter((t) => !t.kind || t.kind === "GST_HST" || t.kind === "NONE" || t.kind === "OTHER"),
    [taxCodes],
  );
  const pstOptions = useMemo(() => taxCodes.filter((t) => t.kind === "PST"), [taxCodes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drafts.map((d, index) => ({ d, index }));
    return drafts
      .map((d, index) => ({ d, index }))
      .filter(({ d }) =>
        `${d.number} ${d.name} ${d.type} ${d.defaultGstCode} ${d.defaultPstCode}`.toLowerCase().includes(q),
      );
  }, [drafts, query]);

  const visibleIds = filtered.map(({ d }) => d.id || "").filter(Boolean);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function updateDraft(index: number, patch: Partial<AccountDraft>) {
    setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleSelect(id: string) {
    if (!id) return;
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
    setDrafts((prev) => [
      ...prev,
      {
        id: "",
        number: "",
        name: "",
        type: "EXPENSE",
        defaultGstCode: "",
        defaultPstCode: "",
        isSystem: false,
        isNew: true,
      },
    ]);
  }

  function removeRow(index: number) {
    const row = drafts[index];
    if (!row) return;
    if (row.id && !row.isNew) {
      startTransition(async () => {
        const fd = new FormData();
        fd.set("id", row.id);
        await deleteAccountAction(fd);
        setDrafts((prev) => prev.filter((_, i) => i !== index));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        toast.success("Account deleted.");
        router.refresh();
      });
      return;
    }
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function saveAll() {
    startTransition(async () => {
      let saved = 0;
      for (const row of drafts) {
        if (!row.number.trim() || !row.name.trim()) continue;
        const fd = new FormData();
        if (row.id && !row.isNew) fd.set("id", row.id);
        fd.set("number", row.number.trim());
        fd.set("name", row.name.trim());
        fd.set("type", row.type);
        fd.set("defaultGstCode", row.defaultGstCode.trim());
        fd.set("defaultPstCode", row.defaultPstCode.trim());
        const result: ActionResult = await saveAccountAction(undefined, fd);
        if (!result.ok) {
          toast.error(result.error ?? `Failed to save ${row.number}`);
          return;
        }
        saved += 1;
      }
      toast.success(`Saved ${saved} account${saved === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  function fillStarter() {
    startTransition(async () => {
      const result = await fillMissingStarterAccountsAction();
      if (result.ok) {
        toast.success(result.message ?? "Starter accounts added.");
        setStarterOpen(false);
        router.refresh();
      } else toast.error(result.error ?? "Could not add starter accounts.");
    });
  }

  async function submitPaste(formData: FormData) {
    const result = await bulkAddAccountsAction(undefined, formData);
    if (result.ok) {
      toast.success(result.message ?? "Added pasted accounts.");
      setPasteOpen(false);
      router.refresh();
    } else toast.error(result.error ?? "Paste failed");
  }

  async function onImportFile(file: File) {
    try {
      const matrix = await parseImportFile(file);
      const { accounts: imported, skipped } = parseAccountsFromImportMatrix(matrix);
      const fd = new FormData();
      fd.set("accounts", JSON.stringify(imported));
      const result = await importAccountsBatchAction(fd);
      if (result.ok) {
        let msg = result.message ?? "Accounts imported.";
        if (skipped) msg += ` ${skipped} row(s) skipped in file.`;
        toast.success(msg);
        router.refresh();
      } else toast.error(result.error ?? "Import failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read accounts file.");
    }
  }

  function bulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected account${selected.size === 1 ? "" : "s"}?`)) return;
    const idsToDelete = new Set(selected);
    const fd = new FormData();
    fd.set("ids", [...idsToDelete].join(","));
    startTransition(async () => {
      const result = await bulkDeleteAccountsAction(fd);
      if (result.ok) {
        setDrafts((prev) => prev.filter((row) => !row.id || !idsToDelete.has(row.id)));
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
        setBulkEditOpen(false);
        router.refresh();
      } else toast.error(result.error ?? "Delete failed");
    });
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
        <h1>Accounts / Categories</h1>
        <button type="button" className="btn-converter btn-light btn-sm" onClick={() => router.push("/app")}>
          Back to Transactions
        </button>
      </div>

      <p className="hint">
        Manage your chart of accounts and default GST/HST and PST codes per category. Predefined small-business accounts
        are not listed until you click <strong>Add Small Business Accounts</strong> — then you can edit or bulk-delete
        them. They stay hidden after you remove them until you add them again from that button. Click Save Accounts when
        you finish editing the table.
      </p>

      {canEdit ? (
        <div className="settings-toolbar" style={{ marginTop: 0, marginBottom: 14 }}>
          <button type="button" className="btn-converter btn-light" onClick={addRow}>
            + Add Account
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
            + Add Small Business Accounts
          </button>
          <button
            type="button"
            className="btn-converter btn-light"
            onClick={() => {
              setPasteOpen(true);
              setBulkEditOpen(false);
            }}
          >
            Bulk paste add
          </button>
          <button type="button" className="btn-converter btn-primary" onClick={() => fileRef.current?.click()}>
            Import Accounts — CSV / Excel
          </button>
          <button type="button" className="btn-converter btn-green" disabled={pending} onClick={saveAll}>
            {pending ? "Saving…" : "Save Accounts"}
          </button>
        </div>
      ) : null}

      <div className="settings-filter-row">
        <input
          type="search"
          placeholder="Search accounts…"
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

      {canEdit && starterOpen && starterAccounts.length > 0 ? (
        <div className="settings-paste-box">
          <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800 }}>
            Predefined small-business chart ({starterAccounts.length} accounts)
          </h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            {starterChartVisible
              ? missingStarterCount > 0
                ? `${missingStarterCount} predefined account${missingStarterCount === 1 ? "" : "s"} can still be added to your list.`
                : "All predefined accounts are in your chart. Bulk-delete removes them from the list until you add them again here."
              : "Click below to add the predefined chart to your accounts list for this organization. Nothing is shown in the table until you confirm."}
          </p>
          <div
            className="settings-table-wrap"
            style={{ maxHeight: 280, marginBottom: 12, border: "1px solid var(--border)" }}
          >
            <table className="list-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Number</th>
                  <th>Name</th>
                  <th style={{ width: "18%" }}>Type</th>
                  <th style={{ width: 72 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {starterAccounts.map((a) => {
                  const present = existingNumbers.has(a.number);
                  return (
                    <tr key={a.number}>
                      <td>{a.number}</td>
                      <td>{a.name}</td>
                      <td>{a.type.charAt(0) + a.type.slice(1).toLowerCase()}</td>
                      <td>{present ? "In chart" : "Missing"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="settings-paste-actions">
            <button
              type="button"
              className="btn-converter btn-green"
              disabled={pending}
              onClick={fillStarter}
            >
              {pending
                ? "Adding…"
                : starterChartVisible
                  ? missingStarterCount > 0
                    ? `Add ${missingStarterCount} to chart list`
                    : "Show chart list (already complete)"
                  : `Add small business chart (${starterAccounts.length} accounts)`}
            </button>
            <button type="button" className="btn-converter btn-light" onClick={() => setStarterOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {canEdit && pasteOpen ? (
        <div className="settings-paste-box">
          <p className="hint" style={{ marginBottom: 10 }}>
            Paste one value per line. Line 1 from each column creates account 1, and so on.
          </p>
          <form action={submitPaste} className="settings-paste-grid">
            <div>
              <label className="field-label">Numbers</label>
              <textarea name="numbers" rows={8} placeholder={"1000\n5610"} required />
            </div>
            <div>
              <label className="field-label">Names</label>
              <textarea name="names" rows={8} placeholder={"Cash\nMeals"} required />
            </div>
            <div>
              <label className="field-label">Types</label>
              <textarea name="types" rows={8} placeholder={"ASSET\nEXPENSE"} />
            </div>
            <div>
              <label className="field-label">Default GST/HST</label>
              <textarea name="gst" rows={8} placeholder={"GST5\nGST5"} />
            </div>
            <div>
              <label className="field-label">Default PST</label>
              <textarea name="pst" rows={8} placeholder={"\nBC PST7"} />
            </div>
            <div className="settings-paste-actions">
              <button type="submit" className="btn-converter btn-green">
                Add pasted accounts
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
          <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800 }}>Bulk edit {selected.size} accounts</h3>
          <form
            action={async (fd) => {
              const result = await bulkEditAccountsAction(undefined, fd);
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
              <input type="checkbox" name="applyType" /> Update type
            </label>
            <div>
              <label className="field-label">Type</label>
              <select name="type" defaultValue="EXPENSE">
                <option value="ASSET">Asset</option>
                <option value="LIABILITY">Liability</option>
                <option value="EQUITY">Equity</option>
                <option value="INCOME">Income</option>
                <option value="EXPENSE">Expense</option>
              </select>
            </div>
            <label className="field-label">
              <input type="checkbox" name="applyGst" /> Update default GST
            </label>
            <div>
              <label className="field-label">Default GST/HST</label>
              <input name="defaultGstCode" placeholder="GST5" />
            </div>
            <label className="field-label">
              <input type="checkbox" name="applyPst" /> Update default PST
            </label>
            <div>
              <label className="field-label">Default PST</label>
              <input name="defaultPstCode" placeholder="BC PST7" />
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

      <div className="settings-table-wrap">
        <table className="list-table" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              {canEdit ? (
                <th style={{ width: 42, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    title="Select all visible accounts"
                  />
                </th>
              ) : null}
              <th style={{ width: "13%" }}>Account Number</th>
              <th style={{ width: "22%" }}>Account / Category Name</th>
              <th style={{ width: "14%" }}>Account Type</th>
              <th style={{ width: "19%" }}>Default GST/HST</th>
              <th style={{ width: "19%" }}>Default PST/QST/RST</th>
              <th style={{ width: 90 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ d, index }) => (
              <tr key={d.id || `new-${index}`}>
                {canEdit ? (
                  <td style={{ textAlign: "center" }}>
                    {d.id ? (
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggleSelect(d.id)}
                      />
                    ) : null}
                  </td>
                ) : null}
                <td>
                  <input
                    value={d.number}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { number: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={d.name}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { name: e.target.value })}
                  />
                  {d.isSystem ? <span className="rule-badge builtin">Starter</span> : null}
                </td>
                <td>
                  <select
                    value={d.type}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { type: e.target.value as Account["type"] })}
                  >
                    <option value="ASSET">Asset</option>
                    <option value="LIABILITY">Liability</option>
                    <option value="EQUITY">Equity</option>
                    <option value="INCOME">Income</option>
                    <option value="EXPENSE">Expense</option>
                  </select>
                </td>
                <td>
                  <select
                    value={d.defaultGstCode}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { defaultGstCode: e.target.value })}
                  >
                    <option value="">— None —</option>
                    {gstOptions.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={d.defaultPstCode}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { defaultPstCode: e.target.value })}
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
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn-converter btn-danger btn-sm"
                      onClick={() => removeRow(index)}
                    >
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                  {query.trim()
                    ? "No accounts match your search."
                    : starterChartVisible
                      ? "No accounts yet. Add a row, import, or use Add Small Business Accounts."
                      : "No custom accounts yet. Use Add Small Business Accounts for the predefined chart, or add your own."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
