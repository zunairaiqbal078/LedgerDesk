export type MoneyRow = {
  id: string;
  date: Date;
  description: string;
  moneyIn: number;
  moneyOut: number;
  bankAccountId: string;
  transferMatchId?: string | null;
};

export type TransferCandidate = {
  outId: string;
  inId: string;
  amount: number;
  daysApart: number;
  outDate: string;
  inDate: string;
  outDescription: string;
  inDescription: string;
  fromBankAccountId: string;
  toBankAccountId: string;
};

function dayStamp(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysBetween(a: Date, b: Date) {
  return Math.abs(dayStamp(a) - dayStamp(b)) / (24 * 60 * 60 * 1000);
}

export function findTransferCandidates(
  rows: MoneyRow[],
  dateWindowDays = 7,
): TransferCandidate[] {
  const outs = rows.filter(
    (r) => r.moneyOut > 0 && r.moneyIn === 0 && !r.transferMatchId,
  );
  const inns = rows.filter(
    (r) => r.moneyIn > 0 && r.moneyOut === 0 && !r.transferMatchId,
  );

  const candidates: TransferCandidate[] = [];
  const usedOut = new Set<string>();
  const usedIn = new Set<string>();

  for (const out of outs) {
    for (const inn of inns) {
      if (out.bankAccountId === inn.bankAccountId) continue;
      if (usedOut.has(out.id) || usedIn.has(inn.id)) continue;
      if (Math.abs(out.moneyOut - inn.moneyIn) > 0.001) continue;
      const gap = daysBetween(out.date, inn.date);
      if (gap > dateWindowDays) continue;

      candidates.push({
        outId: out.id,
        inId: inn.id,
        amount: out.moneyOut,
        daysApart: gap,
        outDate: out.date.toISOString().slice(0, 10),
        inDate: inn.date.toISOString().slice(0, 10),
        outDescription: out.description,
        inDescription: inn.description,
        fromBankAccountId: out.bankAccountId,
        toBankAccountId: inn.bankAccountId,
      });
    }
  }

  return candidates.sort((a, b) => a.daysApart - b.daysApart || a.amount - b.amount);
}

/** Unique 1:1 matches only (amount+window with no competing options). */
export function uniqueTransferCandidates(candidates: TransferCandidate[]) {
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const c of candidates) {
    outCount.set(c.outId, (outCount.get(c.outId) ?? 0) + 1);
    inCount.set(c.inId, (inCount.get(c.inId) ?? 0) + 1);
  }
  return candidates.filter(
    (c) => (outCount.get(c.outId) ?? 0) === 1 && (inCount.get(c.inId) ?? 0) === 1,
  );
}
