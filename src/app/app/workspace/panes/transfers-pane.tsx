import {
  autoMatchTransfersAction,
  confirmTransferAction,
  unmatchTransferAction,
} from "@/app/actions/accounting";
import { DualScrollArea } from "@/components/dual-scroll-area";
import { Badge, Button, Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { canEditTransactions } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";
import { findTransferCandidates } from "@/lib/transfer-matching";

export default async function TransfersPane({
  windowDays = 7,
}: {
  windowDays?: number;
}) {
  const { organization, role } = await requireOrgContext("VIEWER");
  const canEdit = canEditTransactions(role);

  // Only unmatched legs with an amount — matching is O(outs×ins)
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 2);

  const [transactions, banks, confirmed] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        organizationId: organization.id,
        transferMatchId: null,
        date: { gte: since },
        OR: [{ moneyIn: { gt: 0 } }, { moneyOut: { gt: 0 } }],
      },
      select: {
        id: true,
        date: true,
        description: true,
        moneyIn: true,
        moneyOut: true,
        bankAccountId: true,
        transferMatchId: true,
        bankAccount: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 2000,
    }),
    prisma.bankAccount.findMany({
      where: { organizationId: organization.id },
      select: { id: true, name: true },
    }),
    prisma.transferMatch.findMany({
      where: { organizationId: organization.id },
      orderBy: { confirmedAt: "desc" },
      take: 100,
    }),
  ]);

  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  const confirmedTxIds = [
    ...new Set(confirmed.flatMap((m) => [m.fromTransactionId, m.toTransactionId])),
  ];
  const confirmedTxs =
    confirmedTxIds.length > 0
      ? await prisma.transaction.findMany({
          where: { id: { in: confirmedTxIds }, organizationId: organization.id },
          select: {
            id: true,
            date: true,
            bankAccountId: true,
          },
        })
      : [];
  const txMap = new Map(confirmedTxs.map((t) => [t.id, t]));

  const candidates = findTransferCandidates(
    transactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      moneyIn: Number(tx.moneyIn),
      moneyOut: Number(tx.moneyOut),
      bankAccountId: tx.bankAccountId,
      transferMatchId: tx.transferMatchId,
    })),
    windowDays,
  );

  return (
    <div className="space-y-6">
      <div className="toolbar">
        <div className="toolbar-left">
          {canEdit ? (
            <form action={autoMatchTransfersAction}>
              <input type="hidden" name="windowDays" value={windowDays} />
              <button type="submit" className="btn-converter btn-green">
                Auto Match Unique
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="summary">
        <div className="summary-card">
          <div className="k">Possible Matches</div>
          <div className="v">{candidates.length}</div>
        </div>
        <div className="summary-card">
          <div className="k">Confirmed Transfers</div>
          <div className="v">{confirmed.length}</div>
        </div>
        <div className="summary-card">
          <div className="k">Confirmed Amount</div>
          <div className="v">
            ${confirmed.reduce((s, m) => s + Number(m.amount), 0).toFixed(2)}
          </div>
        </div>
      </div>

      <DualScrollArea className="table-wrap">
        <table className="tx-table list-table">
          <thead>
            <tr>
              <th>Money Out Date</th>
              <th>From Account</th>
              <th>Out Description</th>
              <th>Money Out</th>
              <th>Money In Date</th>
              <th>To Account</th>
              <th>Days Apart</th>
              {canEdit ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={`${c.outId}-${c.inId}`}>
                <td>{c.outDate}</td>
                <td>{bankName.get(c.fromBankAccountId)}</td>
                <td>{c.outDescription}</td>
                <td className="num">${c.amount.toFixed(2)}</td>
                <td>{c.inDate}</td>
                <td>{bankName.get(c.toBankAccountId)}</td>
                <td>{c.daysApart}</td>
                {canEdit ? (
                  <td>
                    <form action={confirmTransferAction}>
                      <input type="hidden" name="outId" value={c.outId} />
                      <input type="hidden" name="inId" value={c.inId} />
                      <Button type="submit" size="sm">
                        Confirm
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </DualScrollArea>

      <DualScrollArea className="table-wrap">
        <table className="tx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>From → To</th>
              <th>Amount</th>
              <th>Matched</th>
              {canEdit ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {confirmed.map((match) => {
              const from = txMap.get(match.fromTransactionId);
              const to = txMap.get(match.toTransactionId);
              return (
                <tr key={match.id}>
                  <td>{from?.date.toISOString().slice(0, 10) ?? "—"}</td>
                  <td>
                    {from ? bankName.get(from.bankAccountId) : "?"} →{" "}
                    {to ? bankName.get(to.bankAccountId) : "?"}
                  </td>
                  <td className="num">${Number(match.amount).toFixed(2)}</td>
                  <td>
                    <Badge className="border-teal-200 bg-teal-50 text-teal-800">Confirmed</Badge>
                  </td>
                  {canEdit ? (
                    <td>
                      <form action={unmatchTransferAction}>
                        <input type="hidden" name="matchId" value={match.id} />
                        <Button type="submit" size="sm" variant="danger">
                          Unmatch
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DualScrollArea>
    </div>
  );
}
