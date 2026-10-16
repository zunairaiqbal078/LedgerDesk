# LedgerDesk — Delivery use cases & test checklist

Use this document to demo and sign off the product. Each case has **steps**, **expected result**, and a **Pass** checkbox for UAT.

**Test environment**

| Item | Value |
|------|--------|
| App URL | `http://localhost:3000` |
| DB | Postgres on port **5434** (`npm run db:up`) |
| Dev | `npm run dev` |
| Sample import | `samples/sample-bank-statement.csv` |
| Super Admin (seed/env) | `admin@ledgerdesk.local` / see `.env` |

---

## A. Authentication & account types

### UC-A1 — Sign up as accounting firm

| Step | Action |
|------|--------|
| 1 | Open `/signup` → tab **Accounting firm** |
| 2 | Firm name, your name, email, password (10+ chars) → Create account |
| **Expected** | Redirect to `/app`; sidebar shows **Clients**, firm name, **Add client** |

### UC-A2 — Sign up as solo business (“My business”)

| Step | Action |
|------|--------|
| 1 | Open `/signup?type=client` or tab **My business** |
| 2 | Business name, account details → Create |
| **Expected** | `/app` works; **no** multi-client “Clients” block; **Folders & saves** only; Settings = profile/password (no org team card for solo) |

### UC-A3 — Login / session

| Step | Action |
|------|--------|
| 1 | Log out → `/login` with valid credentials |
| **Expected** | Lands on `/app`; invalid login shows error |

### UC-A4 — Super Admin (optional)

| Step | Action |
|------|--------|
| 1 | Login as `SUPER_ADMIN_EMAIL` from `.env` |
| **Expected** | Admin link; can open `/admin` |

---

## B. Accounting firm — clients & workspace

### UC-B1 — Add client (modal, HTML parity)

| Step | Action |
|------|--------|
| 1 | Firm account → sidebar **+ Add client…** |
| 2 | Name, province (e.g. ON), fiscal/GST year, filing periods, optional GST periods → Create |
| **Expected** | Toast success; client appears in **Active client** dropdown; app switches to that client’s books |

### UC-B2 — Switch active client

| Step | Action |
|------|--------|
| 1 | Change **Active client (books)** dropdown |
| **Expected** | Transactions/settings/folders reflect **selected client only** |

### UC-B3 — Firm team (admin only)

| Step | Action |
|------|--------|
| 1 | Settings → **Firm team** (firm admin) |
| **Expected** | Add team member with role; solo business users do **not** see team management on client org |

---

## C. Statement import & transactions

### UC-C1 — Import CSV (empty table)

| Step | Action |
|------|--------|
| 1 | Select client → **Transactions** tab |
| 2 | Sidebar: choose `samples/sample-bank-statement.csv` |
| 3 | Confirm mapping / import |
| **Expected** | Rows appear; summary cards update; rules optional on import |

### UC-C2 — Import guard (existing rows)

| Step | Action |
|------|--------|
| 1 | With rows in table, import **another** file |
| **Expected** | Modal: save first / clear & import / cancel (English copy) |

### UC-C3 — New conversion (clear)

| Step | Action |
|------|--------|
| 1 | Top bar **New** with rows present |
| **Expected** | Same guard pattern; clear removes current bank transactions |

### UC-C4 — Edit transaction

| Step | Action |
|------|--------|
| 1 | Change account, province, tax on a row → save row |
| **Expected** | Persists after refresh |

### UC-C5 — Export CSV

| Step | Action |
|------|--------|
| 1 | **Export CSV** with rows present |
| **Expected** | File downloads with categorized columns |

---

## D. Folders & saved conversions

### UC-D1 — Create folder

| Step | Action |
|------|--------|
| 1 | Sidebar **+ Add folder** or `/app/folders` |
| **Expected** | Folder listed; empty until a save exists |

### UC-D2 — Save conversion (new)

| Step | Action |
|------|--------|
| 1 | **Save Conversion** → name + folder → save |
| **Expected** | English helper text; snapshot stored; folder list shows save |

### UC-D3 — Folder detail — show transactions

| Step | Action |
|------|--------|
| 1 | `/app/folders` → open folder → **Show transactions** |
| **Expected** | Preview table; **Full view** / Download / Load |

### UC-D4 — Load → edit → update existing save

| Step | Action |
|------|--------|
| 1 | **Load** a save → edit rows → **Save Conversion** |
| 2 | Choose **Update existing save** |
| **Expected** | Same save id updated in same folder; message “Updated …” |

### UC-D5 — Load → edit → save as new copy

| Step | Action |
|------|--------|
| 1 | After load, **Save Conversion** → **Save as new copy** |
| **Expected** | New save row; original save unchanged |

### UC-D6 — Download saved conversion

| Step | Action |
|------|--------|
| 1 | Download from folder or `/app/folders/view/[id]` |
| **Expected** | CSV with snapshot transactions |

---

## E. Tax — GST & PST

### UC-E1 — GST calculation (all client transactions)

| Step | Action |
|------|--------|
| 1 | Categorize income/expense with GST/HST codes |
| 2 | **GST Calculation** tab → year/period → Apply |
| **Expected** | Summary cards + line table; uses **all org transactions**; province hint if client has default province |

### UC-E2 — PST calculation (client province)

| Step | Action |
|------|--------|
| 1 | Client with province BC/MB/etc.; PST codes on rows |
| 2 | **PST Calculation** tab |
| **Expected** | PST totals; rows aligned with client province profile |

### UC-E3 — Import inherits client province

| Step | Action |
|------|--------|
| 1 | Client with **default province** set → import new rows without province |
| **Expected** | Rows get client province; default PST code when applicable |

---

## F. Other workspace tabs

### UC-F1 — Transfer matching

| Step | Action |
|------|--------|
| 1 | **Transfer Matching** with two related bank lines |
| **Expected** | Can match; matched rows excluded from GST as transfers |

### UC-F2 — General entries

| Step | Action |
|------|--------|
| 1 | **General Entries** tab |
| **Expected** | Loads without error for client org |

### UC-F3 — Reconciliation

| Step | Action |
|------|--------|
| 1 | **Reconciliation** tab |
| **Expected** | UI loads for active bank/client |

---

## G. Banks & settings

### UC-G1 — Banks list

| Step | Action |
|------|--------|
| 1 | `/app/banks` — add bank, set active |
| **Expected** | Import targets active bank; sidebar reflects selection |

### UC-G2 — Settings — profile / password

| Step | Action |
|------|--------|
| 1 | Change name or password |
| **Expected** | Success message; re-login with new password works |

---

## H. Regression / technical

### UC-H1 — Production build

```bash
npm run build
```

**Expected** | Exit 0 |

### UC-H2 — Prisma schema vs DB

```bash
npx prisma db push
npx prisma generate
```

**Expected** | No drift errors (includes `defaultProvince`, folders, saves) |

### UC-H3 — Import after client province (no Prisma select error)

| Step | Action |
|------|--------|
| 1 | Import with client that has province set |
| **Expected** | No `Unknown field defaultProvince` runtime error |

---

## Quick demo script (15 min)

1. Sign up **firm** → Add client **Demo Co (ON)**  
2. Import **sample-bank-statement.csv** → apply rules  
3. Categorize 3–5 rows + tax  
4. Create folder **2026** → **Save Conversion**  
5. **Load** → change one row → **Update existing save**  
6. Open **GST** tab → Apply period  
7. Sign up **My business** in incognito → confirm no firm client UI  
8. Show **Folders** preview + download  

---

## UAT sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Auth & account types | | | |
| Firm + clients | | | |
| Import & transactions | | | |
| Folders & saves | | | |
| GST / PST | | | |
| Solo business UX | | | |
