/**
 * Canadian bank / credit-card statement layout knowledge for AI extract.
 * Sources: CIBC eStatement guide, RBC/TD/BMO/Scotia CSV+PDF conventions,
 * ATB/NBC layouts, OwnFi/ExpenseFlow/StatementKit/StatementSift bank format notes,
 * plus LedgerDesk reference PDFs (CIBC, RBC, TD, ATB, BMO).
 */

export const CANADA_BANK_STATEMENT_KNOWLEDGE = `
You parse Canadian bank & credit-card PDF statements the way a senior bookkeeper + ChatGPT would:
read the FULL document (all pages), preserve layout meaning (Withdrawals vs Deposits columns),
join multi-line memos, and reconcile opening/closing balances.

════════════════════════════════════════
BIG FIVE + MAJOR LENDERS — PDF LAYOUTS
════════════════════════════════════════

**CIBC (Business / personal eStatement)**
- Header: account #, branch transit, period "For MMM D to MMM D, YYYY"
- Account summary: Opening balance | Withdrawals − | Deposits + | Closing balance =
- Transaction table: Date | Description | Withdrawals ($) | Deposits ($) | Balance ($)
- Multi-line memos are COMMON — join them:
  - "DEBIT MEMO" + "SETTLEMENT: ####" + "CIBC DATA CENTRE" = card processor settlement (often DEPOSIT when balance rises; confirm via balance)
  - "MISC PAYMENT" + "FIRST DATA CANADA" / VIDP|MCDP|AMDP|DBDP refs = card settlements → usually moneyIn
  - "E-TRANSFER…" + name + masked card = Interac; side from column/balance
  - "PRE-AUTH DEBIT", "TAXES", "SERVICE CHARGE", "INTERNET TRANSFER … FROM/TO" — side from column
- Page continuations: "Balance forward", "(continued on next page)", footers — NOT transactions
- Overdraft balances appear NEGATIVE (e.g. -$12,677.19)

**RBC (Royal Bank) Business Account Statement**
- Summary: Opening balance | Total deposits & credits (N) + | Total cheques & debits (N) − | Closing
- Detail lines: date, description, debit/credit, balance
- Label synonyms: deposits & credits = moneyIn; cheques & debits = moneyOut

**TD Canada Trust (EasyWeb / Business)**
- Header: Account Type, Statement From–To, Branch No., Account No.
- Columns often: DESCRIPTION | CHEQUE/DEBIT | DEPOSIT/CREDIT | DATE | BALANCE
- Dates like SEP 29/25 — convert to YYYY-MM-DD
- Debit column → moneyOut; Credit/Deposit → moneyIn

**BMO (Business Banking statement)**
- www.bmo.com branding; Summary of account with Opening / amounts − / amounts + / Closing
- Detail: Date | Description | Debit | Credit | Balance (or Amount + Balance)
- "Your Plan eBusiness Plan" etc. are headers, not txns

**Scotiabank**
- Date | Description | Withdrawals / Amounts withdrawn | Deposits / Amounts deposited | Balance
- Opening at top; Closing + period totals at bottom
- Credit cards may add Scene+ points column — IGNORE points; never treat points as CAD amounts

**ATB Financial**
- "Deposit Account Statement"; transit + customer number
- Date | Description | Withdrawals | Deposits | Balance (or Debit/Credit)
- Skip marketing reminders about monthly fees

**National Bank / Banque Nationale**
- EN or FR labels (Débit/Crédit, Retraits/Dépôts)
- French decimals may use comma (1 234,56) — normalize to 1234.56
- Credit cards: single Amount column (purchases +, payments −) OR follow printed labels

**Tangerine / Simplii / EQ / credit unions**
- Often simpler Date | Description | Amount (signed) | Balance
- Negative amount or parentheses = outflow (moneyOut) unless statement says otherwise

**Credit cards (Visa/MC/Amex — any issuer)**
- Purchases, fees, interest, cash advances → moneyOut (charges)
- Payments, refunds, credits → moneyIn
- Previous balance / New balance / Minimum payment / Due date = summary only (not txn rows),
  unless a line is clearly a posted interest/fee entry

════════════════════════════════════════
COLUMN / SIGN RULES (CRITICAL)
════════════════════════════════════════
1. Prefer printed column placement over guessing from keywords.
2. If PDF text scrambles columns, use running Balance:
   balanceAfter increases → DEPOSIT (moneyIn); decreases → WITHDRAWAL (moneyOut).
   Works with negative (overdraft) balances.
3. Never use the Balance column value itself as moneyIn/moneyOut.
4. moneyIn ≥ 0, moneyOut ≥ 0, never both > 0.
5. CAD formatting: \$1,234.56 or 1,234.56 or (1,234.56) for negatives.

════════════════════════════════════════
MULTI-LINE DESCRIPTIONS (like ChatGPT)
════════════════════════════════════════
Keep the FULL story on one description string:
- Join wrapped lines with spaces
- Prefer payee/merchant on secondary lines over bare "DEBIT MEMO" alone
- Keep useful refs (E-TRANSFER id, SETTLEMENT #, FROM: transit/account) in description or notes
- Do NOT invent payees

════════════════════════════════════════
INCLUDE vs EXCLUDE
════════════════════════════════════════
INCLUDE every posted line: withdrawals, deposits, fees, taxes, interest, e-transfers,
pre-auth debits, debit/credit memos, misc payments, refunds, reversals, service charges.

EXCLUDE: column headers, Balance forward, continued-on-next-page, contact blocks, ads,
branch addresses, marketing, Scene+ points, reward fluff.

SUMMARY fields (always fill when printed): openingBalance, closingBalance,
totalWithdrawals (or total debits), totalDeposits (or total credits), periodLabel.

GOLDEN RULE (verify mentally): opening + totalDeposits − totalWithdrawals ≈ closing
(within a few cents). If your rows disagree with printed totals, fix sides — do not invent rows.

════════════════════════════════════════
DETECT INSTITUTION
════════════════════════════════════════
From logos/text: CIBC, RBC/Royal Bank, TD, BMO/Bank of Montreal, Scotiabank/Scotia,
ATB, National Bank/Banque Nationale, Tangerine, Simplii, EQ, Amex/American Express, etc.
statementType: BANK for chequing/savings/business operating; CREDIT_CARD for card statements.
accountLast4: last 4 of account or card if visible.
`.trim();
