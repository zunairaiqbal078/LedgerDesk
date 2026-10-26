"use client";

import { useEffect, useMemo, useState } from "react";

type TaxOption = {
  code: string;
  name?: string;
  rate?: number;
  kind?: string;
  province?: string | null;
};

export type TaxPickerMode = "gst" | "pst";

export function TransactionTaxPickerModal({
  open,
  mode = "gst",
  taxOptions,
  selectedCodes,
  rowProvince,
  onClose,
  onApply,
}: {
  open: boolean;
  mode?: TaxPickerMode;
  taxOptions: TaxOption[];
  selectedCodes: string[];
  rowProvince?: string | null;
  onClose: () => void;
  onApply: (codes: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAllProvinces, setShowAllProvinces] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(new Set(selectedCodes));
      setShowAllProvinces(false);
    }
  }, [open, selectedCodes]);

  const sorted = useMemo(() => {
    let list = [...taxOptions];
    if (mode === "pst" && rowProvince && !showAllProvinces) {
      const forProvince = list.filter(
        (t) => !t.province || t.province.toUpperCase() === rowProvince.toUpperCase(),
      );
      if (forProvince.length) list = forProvince;
    }
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }, [taxOptions, mode, rowProvince, showAllProvinces]);

  if (!open) return null;

  function toggle(code: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const title = mode === "pst" ? "Select PST Code" : "Select Sales Tax Code";
  const hint =
    mode === "pst"
      ? "Only province tax codes (PST / QST / RST). These feed PST Calculation — not GST."
      : "Only GST / HST (and exempt/none) codes. These feed GST Calculation — not PST.";

  return (
    <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="taxPickerTitle">
      <div className="modal-card" style={{ width: "min(560px, 96vw)" }}>
        <div className="modal-head">
          <h3 id="taxPickerTitle">{title}</h3>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginBottom: 10 }}>
            {hint}
          </p>
          {mode === "pst" && rowProvince ? (
            <label className="hint" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={showAllProvinces}
                onChange={(e) => setShowAllProvinces(e.target.checked)}
              />
              Show PST codes for all provinces (currently filtered to {rowProvince})
            </label>
          ) : null}
          <div className="tax-list">
            {sorted.length === 0 ? (
              <p className="hint">No matching tax codes.</p>
            ) : (
              sorted.map((t) => (
                <label key={t.code}>
                  <input
                    type="checkbox"
                    checked={picked.has(t.code)}
                    onChange={() => toggle(t.code)}
                  />
                  <span>
                    <strong>{t.code}</strong>
                    {t.name ? ` — ${t.name}` : ""}
                    {t.rate != null ? ` (${t.rate}%)` : ""}
                    {mode === "pst" && t.province ? ` · ${t.province}` : ""}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn-converter btn-light"
            onClick={() => {
              setPicked(new Set());
              onApply([]);
            }}
          >
            Clear
          </button>
          <button type="button" className="btn-converter btn-light" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-converter btn-green"
            onClick={() => onApply([...picked])}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
