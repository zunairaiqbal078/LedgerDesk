"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { CONVERTER_EVENTS, dispatchConverterEvent } from "@/lib/converter-events";
import { setActiveBankAction, switchActiveOrganizationAction } from "@/app/actions/org";
import { AddClientModal } from "@/components/add-client-modal";
import type { OrganizationKind } from "@prisma/client";
import { Badge } from "@/components/ui";
import { canSeeClientWorkspace, canSeeLicensePanel } from "@/lib/permissions";
import type { OrgRole } from "@prisma/client";
import { CollapsibleSection } from "@/components/converter/collapsible-section";
import {
  LAST_SAVED_CONVERSION_KEY,
  preferredFolderStorageKey,
} from "@/lib/conversion-export";
import { cn } from "@/lib/utils";

const DATE_FORMATS = [
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "YYYY/MM/DD", label: "YYYY/MM/DD" },
  { value: "MMM DD, YYYY", label: "MMM DD, YYYY" },
  { value: "DD-MMM-YYYY", label: "DD-MMM-YYYY" },
] as const;

const IMPORT_ACCEPT =
  ".pdf,.csv,.xls,.xlsx,.qbo,.ofx,.jpg,.jpeg,.png,.webp,.xml,.camt,.qfx";

const FORMAT_CHIPS = [
  "PDF",
  "CSV",
  "XLS",
  "XLSX",
  "QBO",
  "OFX",
  "JPG",
  "PNG",
  "WEBP",
] as const;

function importFileLooksSupported(file: File) {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const allowed = IMPORT_ACCEPT.split(",").map((e) => e.trim().toLowerCase());
  if (ext && allowed.includes(ext)) return true;
  const mime = file.type.toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.includes("spreadsheet") ||
    mime.includes("csv") ||
    mime === "text/csv" ||
    mime === "text/plain"
  );
}

type Bank = {
  id: string;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  mask: string | null;
};

type Folder = { id: string; name: string };

type UserOrganization = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  role: string;
};

function FolderSavePanel({
  scopeLabel,
  folders,
  preferredFolderId,
  setPreferredFolderId,
  activeOrganizationId,
  lastSavedLabel,
}: {
  scopeLabel: string;
  folders: Folder[];
  preferredFolderId: string;
  setPreferredFolderId: (id: string) => void;
  activeOrganizationId: string;
  lastSavedLabel: string | null;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-[#d6e1e9] bg-white p-3">
      <p className="text-xs font-bold text-[#354657]">
        Folder <span className="font-normal text-[#52697a]">{scopeLabel}</span>
      </p>
      <label className="block text-[11px] font-semibold text-[#52697a]">Selected folder (for Save)</label>
      <select
        className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm"
        value={preferredFolderId}
        onChange={(e) => {
          const id = e.target.value;
          setPreferredFolderId(id);
          localStorage.setItem(preferredFolderStorageKey(activeOrganizationId), id);
          window.dispatchEvent(
            new CustomEvent(CONVERTER_EVENTS.preferredFolderChanged, { detail: id }),
          );
        }}
      >
        <option value="">— Select folder —</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/app/folders"
          className="rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-center text-xs font-semibold"
        >
          + Add folder
        </Link>
        {preferredFolderId ? (
          <Link
            href={`/app/folders/${preferredFolderId}`}
            className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1.5 text-center text-xs font-semibold text-teal-900"
          >
            View contents
          </Link>
        ) : (
          <Link
            href="/app/folders"
            className="rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-center text-xs font-semibold"
          >
            All folders
          </Link>
        )}
      </div>
      <Link
        href="/app/folders"
        className="block w-full rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-3 py-2 text-center text-sm font-semibold"
      >
        Folders &amp; saved conversions
      </Link>
      <p className="text-[11px] text-[#52697a]">
        {lastSavedLabel ?? "Import → categorize → top bar Save Conversion."}
      </p>
    </div>
  );
}

export function ConverterSidebar({
  orgName,
  accountantFirmName,
  activeOrgKind,
  userName,
  role,
  isSuperAdmin,
  isFirmStaff,
  canManageClients,
  canManageFirmTeam,
  activeOrganizationId,
  userOrganizations,
  orgRole,
  banks,
  activeBankId,
  folders,
}: {
  orgName: string;
  accountantFirmName: string | null;
  activeOrgKind: OrganizationKind;
  userName: string;
  role: string;
  isSuperAdmin: boolean;
  isFirmStaff: boolean;
  canManageClients: boolean;
  canManageFirmTeam: boolean;
  activeOrganizationId: string;
  userOrganizations: UserOrganization[];
  orgRole: OrgRole;
  banks: Bank[];
  activeBankId: string | null;
  folders: Folder[];
}) {
  const showClientWorkspace = canSeeClientWorkspace(isSuperAdmin, isFirmStaff);
  const showLicense = canSeeLicensePanel(isSuperAdmin);
  const pathname = usePathname();
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [statementType, setStatementType] = useState<"Bank" | "Credit Card">("Bank");
  const [importStatus, setImportStatus] = useState("Ready — choose a statement to begin.");
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ocrPdfFallback, setOcrPdfFallback] = useState(true);
  const [preferredFolderId, setPreferredFolderId] = useState("");
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);

  useEffect(() => {
    const key = preferredFolderStorageKey(activeOrganizationId);
    const stored = localStorage.getItem(key);
    if (stored && folders.some((f) => f.id === stored)) {
      setPreferredFolderId(stored);
    } else if (folders[0]) {
      setPreferredFolderId(folders[0].id);
    } else {
      setPreferredFolderId("");
    }
  }, [activeOrganizationId, folders]);

  useEffect(() => {
    function readLastSaved() {
      try {
        const raw = localStorage.getItem(LAST_SAVED_CONVERSION_KEY);
        if (!raw) {
          setLastSavedLabel(null);
          return;
        }
        const parsed = JSON.parse(raw) as { message?: string };
        setLastSavedLabel(parsed.message ?? null);
      } catch {
        setLastSavedLabel(null);
      }
    }
    readLastSaved();
    window.addEventListener("ledgerdesk:last-saved-conversion", readLastSaved);
    return () => window.removeEventListener("ledgerdesk:last-saved-conversion", readLastSaved);
  }, []);

  const handleImportFile = useCallback((file: File) => {
    if (!importFileLooksSupported(file)) {
      toast.error("Unsupported file type. Use PDF, CSV, Excel, QBO, OFX, or an image.");
      setImportStatus("Unsupported file — try PDF, CSV, XLS, XLSX, QBO, or OFX.");
      return;
    }
    setImportStatus(`Importing ${file.name}…`);
    dispatchConverterEvent(CONVERTER_EVENTS.importStatement, file);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("ledgerdesk-date-format");
    if (stored) setDateFormat(stored);
    const st = localStorage.getItem("ledgerdesk-statement-type");
    if (st === "Credit Card" || st === "Bank") setStatementType(st);
    const ocr = localStorage.getItem("ledgerdesk-ocr-pdf-fallback");
    if (ocr === "false") setOcrPdfFallback(false);
  }, []);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      if (typeof msg === "string") setImportStatus(msg);
    };
    window.addEventListener("ledgerdesk:import-status", onStatus);
    return () => window.removeEventListener("ledgerdesk:import-status", onStatus);
  }, []);

  function persistDateFormat(value: string) {
    setDateFormat(value);
    localStorage.setItem("ledgerdesk-date-format", value);
  }

  function persistStatementType(value: "Bank" | "Credit Card") {
    setStatementType(value);
    localStorage.setItem("ledgerdesk-statement-type", value);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto">
        <CollapsibleSection title="Statement Import" defaultOpen={true}>
          <div className="rounded-xl border border-[#d6e1e9] bg-white p-3 shadow-sm">
            <p className="text-sm font-bold text-[#1a3344]">Import a Statement</p>
            <p className="mt-0.5 text-[11px] leading-snug text-[#52697a]">
              Convert bank and credit card statements into editable transactions.
            </p>
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#52697a]">
                Transaction Date Format
              </p>
              <label className="block text-[11px] font-semibold text-[#52697a]">
                Choose date format for imported transactions
              </label>
              <select
                value={dateFormat}
                onChange={(e) => persistDateFormat(e.target.value)}
                className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="w-full rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-3 py-2 text-sm font-semibold text-[#354657] hover:bg-[#eef3f7]"
                onClick={() =>
                  dispatchConverterEvent(CONVERTER_EVENTS.applyDateFormat, dateFormat)
                }
              >
                Apply Date Format
              </button>
            </div>
            <div
              className={`dropzone mt-3 ${dropzoneActive ? "drag" : ""}`}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current += 1;
                setDropzoneActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDropzoneActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current = 0;
                setDropzoneActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleImportFile(file);
              }}
            >
              <div className="upload-icon">⇧</div>
              <div className="upload-title">Drag &amp; drop your statement</div>
              <div className="upload-subtitle">
                Drop a file here, or select one from your computer.
              </div>
              <button
                type="button"
                className="choose-file"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose Statement File
              </button>
              <div className="formats-label">Supported formats</div>
              <div className="format-row">
                {FORMAT_CHIPS.map((chip) => (
                  <span key={chip} className="format-chip">
                    {chip}
                  </span>
                ))}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMPORT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            <div className="mt-2 flex items-start gap-2 text-[11px] text-[#52697a]">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  /parsing|reading|extract|AI is|hang tight|takes some time/i.test(importStatus)
                    ? "animate-pulse bg-amber-500"
                    : "bg-teal-600"
                }`}
              />
              <span className="leading-snug">{importStatus}</span>
            </div>
          </div>
        </CollapsibleSection>

        {showClientWorkspace ? (
        <CollapsibleSection title="Clients" defaultOpen={true}>
          <div className="space-y-2 rounded-lg border border-[#d6e1e9] bg-white p-3">
            {isSuperAdmin ? (
              <Link
                href="/admin"
                className="mb-2 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-900 hover:bg-amber-100"
              >
                All clients (Super Admin)
              </Link>
            ) : null}
            {accountantFirmName ? (
              <p className="text-[11px] text-[#52697a]">
                Accounting firm: <strong className="text-[#354657]">{accountantFirmName}</strong>
              </p>
            ) : null}
            <label className="block text-[11px] font-semibold text-[#52697a]">Active client (books)</label>
            {userOrganizations.length > 0 ? (
              <form action={switchActiveOrganizationAction}>
                <select
                  name="organizationId"
                  defaultValue={activeOrganizationId}
                  className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm font-semibold"
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                >
                  {userOrganizations.map((org) => (
                    <option key={org.id} value={org.id} disabled={!org.isActive}>
                      {org.name}
                      {!org.isActive ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              </form>
            ) : (
              <p className="rounded-lg border border-dashed border-[#d6e1e9] bg-[#f6f9fb] px-3 py-2 text-xs text-[#52697a]">
                No clients yet. Add a client below to start bookkeeping in their books.
              </p>
            )}
            {activeOrgKind === "ACCOUNTANT_FIRM" ? (
              <p className="text-[11px] font-semibold text-amber-800">
                Select a client — transactions and settings use that client&apos;s data only.
              </p>
            ) : (
              <p className="text-[11px] text-[#52697a]">
                Working in: <strong>{orgName}</strong>
              </p>
            )}
            {canManageClients && !isSuperAdmin ? (
              <div className="mt-2 space-y-2 border-t border-[#e8eef2] pt-2">
                <label className="block text-[11px] font-semibold text-[#52697a]">Add client</label>
                <button
                  type="button"
                  onClick={() => setAddClientOpen(true)}
                  className="w-full rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-xs font-semibold hover:bg-[#eef3f7]"
                >
                  + Add client…
                </button>
              </div>
            ) : null}
            <div className={canManageFirmTeam ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
              <Link
                href="/app/settings"
                className="rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-center text-xs font-semibold hover:bg-[#eef3f7]"
              >
                Settings
              </Link>
              {canManageFirmTeam ? (
                <Link
                  href="/app/settings#team"
                  className="rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-center text-xs font-semibold hover:bg-[#eef3f7]"
                >
                  Firm team
                </Link>
              ) : null}
            </div>
            <div className="mt-2 border-t border-[#e8eef2] pt-2">
              <FolderSavePanel
                scopeLabel="for selected client"
                folders={folders}
                preferredFolderId={preferredFolderId}
                setPreferredFolderId={setPreferredFolderId}
                activeOrganizationId={activeOrganizationId}
                lastSavedLabel={lastSavedLabel}
              />
            </div>
          </div>
        </CollapsibleSection>
        ) : (
        <CollapsibleSection title="Folders & saves" defaultOpen={true}>
          <FolderSavePanel
            scopeLabel={`for ${orgName}`}
            folders={folders}
            preferredFolderId={preferredFolderId}
            setPreferredFolderId={setPreferredFolderId}
            activeOrganizationId={activeOrganizationId}
            lastSavedLabel={lastSavedLabel}
          />
        </CollapsibleSection>
        )}

        {showLicense ? (
        <CollapsibleSection title="License" defaultOpen={false}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-900">
              Platform owner
            </span>
            <Link
              href="/admin"
              className="rounded-lg border border-[#d6e1e9] bg-white px-2 py-1 text-xs font-semibold hover:bg-[#f6f9fb]"
            >
              License &amp; platform
            </Link>
          </div>
          <p className="text-[11px] text-[#52697a]">
            License and platform-wide settings are available only to the app owner (Super Admin).
          </p>
        </CollapsibleSection>
        ) : null}

        <CollapsibleSection title="Statement type" defaultOpen={false}>
          <label className="block text-[11px] font-semibold text-[#52697a]">Import as</label>
          <select
            value={statementType}
            onChange={(e) =>
              persistStatementType(e.target.value as "Bank" | "Credit Card")
            }
            className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm"
          >
            <option value="Bank">Bank</option>
            <option value="Credit Card">Credit Card</option>
          </select>
          <p className="text-[11px] leading-snug text-[#52697a]">
            Bank mapping: <strong>Debit → Money Out</strong> and <strong>Credit → Money In</strong>.
            The selected type applies to the next imported statement.
          </p>
          <label className="mt-2 block text-[11px] font-semibold text-[#52697a]">
            Connected account
          </label>
          <form action={setActiveBankAction}>
            <select
              name="bankId"
              defaultValue={activeBankId ?? ""}
              className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm"
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              <option value="">— No connected account —</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                  {bank.mask ? ` •••• ${bank.mask}` : ""}
                </option>
              ))}
            </select>
          </form>
          <Link
            href="/app/banks"
            className="mt-2 block w-full rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-3 py-2 text-center text-sm font-semibold"
          >
            Bank Connections
          </Link>
        </CollapsibleSection>

        <CollapsibleSection title="Lists & settings" defaultOpen={false}>
          <SidebarLink href="/app/tax-codes" active={pathname.startsWith("/app/tax-codes")}>
            Sales Tax Codes
          </SidebarLink>
          <SidebarLink href="/app/accounts" active={pathname.startsWith("/app/accounts")}>
            Accounts / Categories
          </SidebarLink>
          <SidebarLink href="/app/rules" active={pathname.startsWith("/app/rules")}>
            Rules
          </SidebarLink>
        </CollapsibleSection>

        <CollapsibleSection title="PDF / image OCR" defaultOpen={false}>
          <label className="block text-[11px] font-semibold text-[#52697a]">OCR language</label>
          <select className="h-9 w-full rounded-lg border border-[#d6e1e9] bg-white px-2 text-sm" disabled>
            <option value="eng">English</option>
          </select>
          <label className="flex gap-2 text-[11px] text-[#52697a]">
            <input
              type="checkbox"
              checked={ocrPdfFallback}
              onChange={(e) => {
                const on = e.target.checked;
                setOcrPdfFallback(on);
                localStorage.setItem("ledgerdesk-ocr-pdf-fallback", on ? "true" : "false");
              }}
            />
            OCR PDF pages when normal text extraction finds little usable text.
          </label>
        </CollapsibleSection>
      </div>

      <div className="shrink-0 space-y-2 border-t border-[#d6e1e9] bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#52697a]">Account</p>
        <p className="truncate text-sm font-semibold">{userName}</p>
        <div className="flex items-center justify-between gap-2">
          <Badge className="border-slate-200 bg-slate-100 text-slate-700">{role}</Badge>
          <Link href="/app/settings" className="text-xs font-semibold text-teal-800 hover:underline">
            {canManageFirmTeam ? "Settings & firm team" : "Settings"}
          </Link>
        </div>
        {isSuperAdmin ? (
          <Link href="/admin" className="block text-center text-xs font-semibold text-amber-800">
            Super Admin
          </Link>
        ) : null}
        <Link href="/signup" className="block text-center text-xs text-[#52697a] hover:text-teal-800">
          Create another firm account
        </Link>
        <button
          type="button"
          className="w-full rounded-lg border border-[#d6e1e9] py-2 text-sm font-semibold text-[#354657] hover:bg-[#f6f9fb]"
          onClick={() =>
            authClient.signOut({
              fetchOptions: { onSuccess: () => { window.location.href = "/login"; } },
            })
          }
        >
          Sign out
        </button>
      </div>
      <AddClientModal open={addClientOpen} onClose={() => setAddClientOpen(false)} />
    </div>
  );
}

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "mb-2 block w-full rounded-lg border px-3 py-2 text-sm font-semibold",
        active
          ? "border-teal-700/30 bg-teal-50 text-teal-900"
          : "border-[#d6e1e9] bg-[#f6f9fb] text-[#354657] hover:bg-[#eef3f7]",
      )}
    >
      {children}
    </Link>
  );
}
