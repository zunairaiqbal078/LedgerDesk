import type { PrismaClient } from "@prisma/client";
import type { GeTx } from "@/lib/general-entries";

type SnapshotTx = {
  id?: string;
  bankAccountId?: string;
  date: string;
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountNumber?: string | null;
  accountName?: string | null;
  taxCodes?: string[];
  taxMode?: string;
  transferMatchId?: string | null;
};

export function parseGeCustomDateStart(isoDate: string): Date | null {
  const t = isoDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return new Date(`${t}T00:00:00.000Z`);
}

export function parseGeCustomDateEnd(isoDate: string): Date | null {
  const t = isoDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return new Date(`${t}T23:59:59.999Z`);
}

export function transactionFingerprint(tx: {
  bankAccountId: string;
  date: Date | string;
  moneyIn: number;
  moneyOut: number;
  description: string;
}): string {
  const d =
    typeof tx.date === "string"
      ? tx.date.slice(0, 10)
      : tx.date.toISOString().slice(0, 10);
  return [
    tx.bankAccountId,
    d,
    tx.moneyIn.toFixed(2),
    tx.moneyOut.toFixed(2),
    tx.description.trim(),
  ].join("|");
}

function snapshotRowToGeTx(
  row: SnapshotTx,
  savedConversionId: string,
  defaultBankId: string | null,
  bankById: Map<string, { id: string; name: string; type: "BANK" | "CREDIT_CARD" }>,
): GeTxWithFp | null {
  const bankAccountId = row.bankAccountId ?? defaultBankId;
  if (!bankAccountId) return null;

  const bank = bankById.get(bankAccountId);
  if (!bank) return null;

  const moneyIn = Number(row.moneyIn) || 0;
  const moneyOut = Number(row.moneyOut) || 0;
  const fp = transactionFingerprint({
    bankAccountId,
    date: row.date,
    moneyIn,
    moneyOut,
    description: row.description,
  });

  return {
    id: row.id ?? `saved:${savedConversionId}:${fp}`,
    date: new Date(`${row.date.slice(0, 10)}T12:00:00.000Z`),
    description: row.description,
    moneyIn,
    moneyOut,
    accountNumber: row.accountNumber ?? null,
    accountName: row.accountName ?? null,
    taxCodes: row.taxCodes ?? [],
    taxMode:
      row.taxMode === "EXCLUSIVE"
        ? "EXCLUSIVE"
        : row.taxMode === "KEEP"
          ? "KEEP"
          : "INCLUSIVE",
    transferMatchId: row.transferMatchId ?? null,
    bankAccountId,
    bankName: bank.name,
    bankType: bank.type,
    fingerprint: fp,
  };
}

type GeTxWithFp = GeTx & { fingerprint?: string };

/**
 * General Entries source transactions:
 * 1) All saved folder snapshots (every SavedConversion in the org) — always, even if
 *    nothing is loaded in the Transactions workspace.
 * 2) Live DB rows only when they are not already covered by a saved snapshot
 *    (unsaved imports / manual rows). Loading a saved folder into Transactions does
 *    not add a second copy.
 */
export async function loadTransactionsForGeneralEntries(
  prisma: PrismaClient,
  organizationId: string,
): Promise<GeTx[]> {
  const [live, savedConversions, banks] = await Promise.all([
    prisma.transaction.findMany({
      where: { organizationId },
      include: { bankAccount: true },
      orderBy: { date: "asc" },
    }),
    prisma.savedConversion.findMany({
      where: { folder: { organizationId } },
      select: { id: true, snapshot: true },
    }),
    prisma.bankAccount.findMany({
      where: { organizationId },
      select: { id: true, name: true, type: true },
    }),
  ]);

  const bankById = new Map(banks.map((b) => [b.id, b]));
  const seenFingerprints = new Set<string>();
  const out: GeTxWithFp[] = [];

  for (const saved of savedConversions) {
    const snapshot = saved.snapshot as {
      bankAccountId?: string | null;
      transactions?: SnapshotTx[];
    };
    const defaultBankId = snapshot.bankAccountId ?? null;

    for (const row of snapshot.transactions ?? []) {
      const ge = snapshotRowToGeTx(row, saved.id, defaultBankId, bankById);
      if (!ge?.fingerprint) continue;
      if (seenFingerprints.has(ge.fingerprint)) continue;
      seenFingerprints.add(ge.fingerprint);
      const { fingerprint: _fp, ...rest } = ge;
      out.push(rest);
    }
  }

  for (const tx of live) {
    const fp = transactionFingerprint({
      bankAccountId: tx.bankAccountId,
      date: tx.date,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      description: tx.description,
    });
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    out.push({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      accountNumber: tx.accountNumber,
      accountName: tx.accountName,
      taxCodes: tx.taxCodes,
      taxMode: tx.taxMode,
      transferMatchId: tx.transferMatchId,
      bankAccountId: tx.bankAccountId,
      bankName: tx.bankAccount.name,
      bankType: tx.bankAccount.type,
    });
  }

  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}
