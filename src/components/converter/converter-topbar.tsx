"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  dispatchConverterEvent,
  CONVERTER_EVENTS,
} from "@/lib/converter-events";
import { REQUEST_NEW_CONVERSION_KEY } from "@/lib/conversion-export";

function isTransactionsWorkspaceView() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.pathname !== "/app") return false;
  const tab = url.searchParams.get("tab");
  return !tab || tab === "transactions";
}

export function ConverterTopbar() {
  const router = useRouter();

  function handleNew() {
    if (!isTransactionsWorkspaceView()) {
      sessionStorage.setItem(REQUEST_NEW_CONVERSION_KEY, "1");
      router.push("/app?tab=transactions");
      return;
    }
    dispatchConverterEvent(CONVERTER_EVENTS.newConversion);
  }

  function handleSave() {
    if (!isTransactionsWorkspaceView()) {
      router.push("/app?tab=transactions");
      window.setTimeout(() => {
        dispatchConverterEvent(CONVERTER_EVENTS.openSaveConversion);
      }, 0);
      return;
    }
    dispatchConverterEvent(CONVERTER_EVENTS.openSaveConversion);
  }

  return (
    <div className="topbar">
      <Link href="/app" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
        LedgerDesk <small>Statement Converter</small>
      </Link>
      <div className="top-actions">
        <button type="button" className="btn-converter btn-light" onClick={handleNew}>
          New
        </button>
        <button type="button" className="btn-converter btn-light" onClick={handleSave}>
          Save Conversion
        </button>
      </div>
    </div>
  );
}
