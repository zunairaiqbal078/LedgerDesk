"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { CONVERTER_EVENTS, dispatchConverterEvent } from "@/lib/converter-events";
import { setActiveBankAction, switchActiveOrganizationAction } from "@/app/actions/org";
import { AddClientModal } from "@/components/add-client-modal";
import { AddCompanyModal } from "@/components/add-company-modal";
import type { OrganizationKind } from "@prisma/client";
import { Badge } from "@/components/ui";
import { canSeeClientWorkspace, canSeeLicensePanel } from "@/lib/permissions";
import type { OrgRole } from "@prisma/client";
import { CollapsibleSection } from "@/components/converter/collapsible-section";
import { preferredFolderStorageKey } from "@/lib/conversion-export";
import { isImportBusyStatus, stashPendingImportFiles } from "@/lib/pending-import";
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
}: {
  scopeLabel: string;
  folders: Folder[];
  preferredFolderId: string;
  setPreferredFolderId: (id: string) => void;
  activeOrganizationId: string;
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
  canManageMyCompanies = false,
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
  canManageMyCompanies?: boolean;
  canManageFirmTeam: boolean;
  activeOrganizationId: string;
  userOrganizations: UserOrganization[];
  orgRole: OrgRole;
  banks: Bank[];
  activeBankId: string | null;
  folders: Folder[];
}) {
  const showClientWorkspace = canSeeClientWorkspace(
    isSuperAdmin,
    isFirmStaff,
    userOrganizations.length,
  );
  const ownerMultiCompany = canManageMyCompanies && userOrganizations.length > 1;
  const hiredMultiClient =
    showClientWorkspace && !isSuperAdmin && !isFirmStaff && !canManageMyCompanies;
  const showCompaniesPanel = showClientWorkspace || canManageMyCompanies;
  const showLicense = canSeeLicensePanel(isSuperAdmin);
  const pathname = usePathname();
  const router = useRouter();
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [statementType, setStatementType] = useState<"Bank" | "Credit Card">("Bank");
  const [importStatus, setImportStatus] = useState("Ready — choose a statement to begin.");
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importBusy = isImportBusyStatus(importStatus);
  const [ocrPdfFallback, setOcrPdfFallback] = useState(true);
  const [preferredFolderId, setPreferredFolderId] = useState("");
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);

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

  const handleImportFiles = useCallback(
    (fileList: FileList | File[] | null | undefined) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      const supported = files.filter(importFileLooksSupported);
      const skipped = files.length - supported.length;
      if (!supported.length) {
        toast.error("Unsupported file type. Use PDF, CSV, Excel, QBO, OFX, or an image.");
        setImportStatus("Unsupported file — try PDF, CSV, XLS, XLSX, QBO, or OFX.");
        return;
      }
      if (skipped > 0) {
        toast.message(`Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}.`);
      }

      const label =
        supported.length === 1
          ? `Importing ${supported[0]!.name}…`
          : `Importing ${supported.length} statements…`;
      setImportStatus(label);

      // Import listener lives on Transactions tab — switch there if needed
      const tab =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("tab")
          : null;
      const onTransactions =
        (pathname === "/app" || pathname.startsWith("/app/")) &&
        (!tab || tab === "transactions");

      const dispatch = () => {
        if (supported.length === 1) {
          dispatchConverterEvent(CONVERTER_EVENTS.importStatement, supported[0]);
        } else {
          dispatchConverterEvent(CONVERTER_EVENTS.importStatement, supported);
        }
      };

      if (!onTransactions) {
        stashPendingImportFiles(supported);
        setImportStatus(`${label} Opening Transactions…`);
        router.push("/app");
        return;
      }
      dispatch();
    },
    [pathname, router],
  );

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

  const matchingBanks = banks.filter((bank) =>
    statementType === "Credit Card" ? bank.type === "CREDIT_CARD" : bank.type === "BANK",
  );
  const connectedBankOptions = matchingBanks.length ? matchingBanks : banks;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto">
        <CollapsibleSection title="Statement type" defaultOpen={true}>
          <p className="text-[11px] font-semibold text-[#52697a]">Import as</p>
          <div className="mt-1.5 flex flex-col gap-2" role="radiogroup" aria-label="Import as">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d6e1e9] bg-white px-3 py-2 text-sm font-semibold text-[#354657] has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/60">
              <input
                type="radio"
                name="statementType"
                value="Bank"
                checked={statementType === "Bank"}
                onChange={() => persistStatementType("Bank")}
                className="h-4 w-4 accent-teal-700"
              />
              Bank
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d6e1e9] bg-white px-3 py-2 text-sm font-semibold text-[#354657] has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/60">
              <input
                type="radio"
                name="statementType"
                value="Credit Card"
                checked={statementType === "Credit Card"}
                onChange={() => persistStatementType("Credit Card")}
                className="h-4 w-4 accent-teal-700"
              />
              Credit card
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[#52697a]">
            {statementType === "Bank" ? (
              <>
                Bank mapping: <strong>Debit → Money Out</strong> and <strong>Credit → Money In</strong>.
              </>
            ) : (
              <>
                Credit card mapping: <strong>Purchases → Money Out</strong> and{" "}
                <strong>Payments → Money In</strong>.
              </>
            )}{" "}
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
              {connectedBankOptions.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                  {bank.mask ? ` •••• ${bank.mask}` : ""}
                  {bank.type === "CREDIT_CARD" ? " (card)" : ""}
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
                handleImportFiles(e.dataTransfer.files);
              }}
            >
              <div className="upload-icon">⇧</div>
              <div className="upload-title">Drag &amp; drop statements</div>
              <div className="upload-subtitle">
                Drop one or more files here, or select from your computer.
              </div>
              <button
                type="button"
                className="choose-file"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose Statement Files
              </button>
              <div className="formats-label">Supported formats · multi-file OK</div>
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
                multiple
                className="hidden"
                onChange={(e) => {
                  handleImportFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            {importBusy ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/35" />
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-100 border-t-amber-600" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-amber-950">Loading statements…</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-900/90">{importStatus}</p>
                  </div>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-amber-100">
                  <div className="h-full w-2/5 animate-pulse rounded-full bg-amber-500" />
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-2 text-[11px] text-[#52697a]">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                <span className="leading-snug">{importStatus}</span>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {showCompaniesPanel ? (
        <CollapsibleSection
          title={
            canManageMyCompanies || hiredMultiClient
              ? "Companies"
              : "Clients"
          }
          defaultOpen={true}
        >
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
            {canManageMyCompanies ? (
              <p className="text-[11px] text-[#52697a]">
                Your companies stay isolated. Hire an accountant per company in Settings — access
                does not carry over to other companies.
              </p>
            ) : null}
            {hiredMultiClient ? (
              <p className="text-[11px] text-[#52697a]">
                You manage multiple My Business companies. Switch below — only the selected
                company&apos;s books are shown.
              </p>
            ) : null}
            <label className="block text-[11px] font-semibold text-[#52697a]">
              {canManageMyCompanies || hiredMultiClient
                ? ownerMultiCompany || hiredMultiClient
                  ? "Switch company"
                  : "Active company"
                : "Active client (books)"}
            </label>
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
                {canManageMyCompanies
                  ? "Add another company below to keep separate books."
                  : "No clients yet. Add a client below to start bookkeeping in their books."}
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
            {canManageMyCompanies ? (
              <div className="mt-2 space-y-2 border-t border-[#e8eef2] pt-2">
                <label className="block text-[11px] font-semibold text-[#52697a]">
                  Add company
                </label>
                <button
                  type="button"
                  onClick={() => setAddCompanyOpen(true)}
                  className="w-full rounded-lg border border-[#d6e1e9] bg-[#f6f9fb] px-2 py-1.5 text-xs font-semibold hover:bg-[#eef3f7]"
                >
                  + Add company…
                </button>
              </div>
            ) : null}
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
                scopeLabel={
                  canManageMyCompanies || hiredMultiClient
                    ? "for selected company"
                    : "for selected client"
                }
                folders={folders}
                preferredFolderId={preferredFolderId}
                setPreferredFolderId={setPreferredFolderId}
                activeOrganizationId={activeOrganizationId}
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
      <AddCompanyModal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} />
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
