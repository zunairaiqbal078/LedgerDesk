"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkAddTaxCodesAction,
  bulkDeleteTaxCodesAction,
  bulkEditTaxCodesAction,
  deleteTaxCodeAction,
  importTaxCodesBatchAction,
  saveTaxCodeAction,
  type ActionResult,
} from "@/app/actions/books";
import { CANADIAN_PROVINCES } from "@/lib/canada-provinces";
import { parseImportFile } from "@/lib/import-parser";
import { parseTaxCodesFromImportMatrix } from "@/lib/tax-codes-import";

type Tax = {
  id: string;
  code: string;
  name: string;
  rate: number;
  kind: "GST_HST" | "PST" | "OTHER" | "NONE";
  province: string | null;
  isSystem: boolean;
};

type TaxDraft = {
  id: string;
  code: string;
  name: string;
  rate: string;
  kind: Tax["kind"];
  province: string;
  isNew?: boolean;
};

function kindToHtml(kind: Tax["kind"]) {
  if (kind === "GST_HST") return "GST/HST";
  if (kind === "PST") return "PST";
  if (kind === "NONE") return "None";
  return "Other";
}

function kindFromHtml(value: string): Tax["kind"] {
  const v = value.trim();
  if (v === "GST/HST") return "GST_HST";
  if (v === "PST") return "PST";
  if (v === "None") return "NONE";
  return "OTHER";
}

function toDraft(t: Tax): TaxDraft {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    rate: String(t.rate),
    kind: t.kind,
    province: t.province ?? "",
  };
}

export function TaxCodesManager({
  taxCodes,
  canEdit,
}: {
  taxCodes: Tax[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<TaxDraft[]>(() => taxCodes.map(toDraft));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  useEffect(() => {
    setDrafts(taxCodes.map(toDraft));
  }, [taxCodes]);

  const savedIds = useMemo(() => drafts.map((d) => d.id).filter(Boolean), [drafts]);
  const allSelected = savedIds.length > 0 && savedIds.every((id) => selected.has(id));

  function updateDraft(index: number, patch: Partial<TaxDraft>) {
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

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) savedIds.forEach((id) => next.delete(id));
      else savedIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function addRow() {
    setDrafts((prev) => [
      ...prev,
      {
        id: "",
        code: `NEW${prev.length + 1}`,
        name: "New Tax",
        rate: "0",
        kind: "OTHER",
        province: "",
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
        await deleteTaxCodeAction(fd);
        setDrafts((prev) => prev.filter((_, i) => i !== index));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        toast.success("Tax code deleted.");
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
        if (!row.code.trim() || !row.name.trim()) continue;
        const fd = new FormData();
        if (row.id && !row.isNew) fd.set("id", row.id);
        fd.set("code", row.code.trim());
        fd.set("name", row.name.trim());
        fd.set("rate", row.rate || "0");
        fd.set("kind", row.kind);
        fd.set("province", row.province.trim());
        const result: ActionResult = await saveTaxCodeAction(undefined, fd);
        if (result.ok) saved += 1;
        else {
          toast.error(result.error ?? `Failed to save ${row.code}`);
          return;
        }
      }
      toast.success(`Saved ${saved} tax code${saved === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  function bulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected tax codes?`)) return;
    const fd = new FormData();
    fd.set("ids", [...selected].join(","));
    startTransition(async () => {
      const result = await bulkDeleteTaxCodesAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        setSelected(new Set());
        setBulkEditOpen(false);
        router.refresh();
      } else toast.error(result.error ?? "Delete failed");
    });
  }

  async function onImportFile(file: File) {
    try {
      const matrix = await parseImportFile(file);
      const { codes, skipped } = parseTaxCodesFromImportMatrix(matrix);
      const fd = new FormData();
      fd.set("codes", JSON.stringify(codes));
      const result = await importTaxCodesBatchAction(fd);
      if (result.ok) {
        let msg = result.message ?? "Tax codes imported.";
        if (skipped) msg += ` ${skipped} row(s) skipped in file.`;
        toast.success(msg);
        router.refresh();
      } else toast.error(result.error ?? "Import failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read tax file.");
    }
  }

  async function submitPaste(formData: FormData) {
    const result = await bulkAddTaxCodesAction(undefined, formData);
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
        <h1>Sales Tax Codes</h1>
        <button type="button" className="btn-converter btn-light btn-sm" onClick={() => router.push("/app")}>
          Back to Transactions
        </button>
      </div>

      <p className="hint">
        Add as many sales-tax codes as you need. A transaction can have more than one tax code selected.
        Classify each code as GST/HST, PST/QST/RST, Other, or No Tax so GST and PST reports separate the tax
        correctly. Province-specific tax codes can be linked to a province. Import CSV or Excel to seed codes
        from a file.
      </p>

      {canEdit ? (
        <div className="settings-toolbar" style={{ marginTop: 0, marginBottom: 14 }}>
          <button type="button" className="btn-converter btn-light" onClick={addRow}>
            + Add Tax Code
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
            Import Tax Codes — CSV / Excel
          </button>
          <button type="button" className="btn-converter btn-green" disabled={pending} onClick={saveAll}>
            {pending ? "Saving…" : "Save Tax Codes"}
          </button>
        </div>
      ) : null}

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
            Paste one value per line. Line 1 from each column creates tax code 1, and so on.
          </p>
          <form action={submitPaste} className="settings-paste-grid">
            <div>
              <label className="field-label">Codes</label>
              <textarea name="codes" rows={8} placeholder={"GST5\nBC PST7"} required />
            </div>
            <div>
              <label className="field-label">Names</label>
              <textarea name="names" rows={8} placeholder={"GST 5%\nBC PST 7%"} required />
            </div>
            <div>
              <label className="field-label">Rates %</label>
              <textarea name="rates" rows={8} placeholder={"5\n7"} />
            </div>
            <div>
              <label className="field-label">Kinds</label>
              <textarea name="kinds" rows={8} placeholder={"GST/HST\nPST"} />
            </div>
            <div>
              <label className="field-label">Provinces</label>
              <textarea name="provinces" rows={8} placeholder={"\nBC"} />
            </div>
            <div className="settings-paste-actions">
              <button type="submit" className="btn-converter btn-green">
                Add pasted tax codes
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
          <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800 }}>Bulk edit {selected.size} tax codes</h3>
          <form
            action={async (fd) => {
              const result = await bulkEditTaxCodesAction(undefined, fd);
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
              <input type="checkbox" name="applyKind" /> Update tax type
            </label>
            <div>
              <label className="field-label">Tax type</label>
              <select name="kind" defaultValue="GST_HST">
                <option value="GST_HST">GST / HST</option>
                <option value="PST">PST / QST / RST</option>
                <option value="OTHER">Other</option>
                <option value="NONE">No Tax</option>
              </select>
            </div>
            <label className="field-label">
              <input type="checkbox" name="applyRate" /> Update rate %
            </label>
            <div>
              <label className="field-label">Rate %</label>
              <input name="rate" type="number" step="0.001" placeholder="5" />
            </div>
            <label className="field-label">
              <input type="checkbox" name="applyProvince" /> Update province
            </label>
            <div>
              <label className="field-label">Province</label>
              <select name="province" defaultValue="">
                <option value="">— Not province-specific —</option>
                {CANADIAN_PROVINCES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
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

      <div className="settings-table-wrap">
        <table className="list-table">
          <thead>
            <tr>
              {canEdit ? (
                <th style={{ width: 42, textAlign: "center" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all tax codes" />
                </th>
              ) : null}
              <th>Code</th>
              <th>Name</th>
              <th>Rate %</th>
              <th>Tax Type</th>
              <th>Province</th>
              <th style={{ width: 90 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((row, index) => (
              <tr key={row.id || `new-${index}`}>
                {canEdit ? (
                  <td style={{ textAlign: "center" }}>
                    {row.id ? (
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    ) : null}
                  </td>
                ) : null}
                <td>
                  <input
                    value={row.code}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { code: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={row.name}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.001"
                    value={row.rate}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { rate: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={kindToHtml(row.kind)}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { kind: kindFromHtml(e.target.value) })}
                  >
                    <option value="GST/HST">GST / HST</option>
                    <option value="PST">PST / QST / RST</option>
                    <option value="Other">Other Tax</option>
                    <option value="None">No Tax</option>
                  </select>
                </td>
                <td>
                  <select
                    value={row.province}
                    disabled={!canEdit}
                    onChange={(e) => updateDraft(index, { province: e.target.value })}
                  >
                    <option value="">— Not province-specific —</option>
                    {CANADIAN_PROVINCES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {code} — {name}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
