"use client";

import { useEffect, useMemo, useState } from "react";

type TaxOption = {
  code: string;
  name?: string;
  rate?: number;
  kind?: string;
};

export function TransactionTaxPickerModal({
  open,
  taxOptions,
  selectedCodes,
  onClose,
  onApply,
}: {
  open: boolean;
  taxOptions: TaxOption[];
  selectedCodes: string[];
  onClose: () => void;
  onApply: (codes: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setPicked(new Set(selectedCodes));
  }, [open, selectedCodes]);

  const sorted = useMemo(
    () => [...taxOptions].sort((a, b) => a.code.localeCompare(b.code)),
    [taxOptions],
  );

  if (!open) return null;

  function toggle(code: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="taxPickerTitle">
      <div className="modal-card" style={{ width: "min(560px, 96vw)" }}>
        <div className="modal-head">
          <h3 id="taxPickerTitle">Select Sales Tax</h3>
          <button type="button" className="btn-converter btn-light btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginBottom: 10 }}>
            You can select more than one tax code on the same transaction, including both GST/HST
            and PST/QST/RST.
          </p>
          <div className="tax-list">
            {sorted.map((t) => (
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
                </span>
              </label>
            ))}
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
