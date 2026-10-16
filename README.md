# LedgerDesk

Production-oriented Next.js rebuild of the LedgerDesk Statement Converter HTML tool.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **PostgreSQL** + **Prisma**
- **Better Auth** (email/password sessions)
- **Zod** validation, server actions, signed webhooks
- **Tailwind CSS 4** professional UI

## Tenancy & access

| Actor | How they get access |
|------|---------------------|
| Firm owner | Signs up and creates an organization |
| Team member | Owner/Admin creates email + password manually and shares it |
| Super admin | Seeded from env; can enable/disable all firms |

Data is isolated by `organizationId`. Transactions are scoped to the **selected bank**.

### Roles

- `OWNER` / `ADMIN` — manage banks, team, settings
- `BOOKKEEPER` — work transactions / imports (Phase 2+)
- `VIEWER` — read-only
- `SUPER_ADMIN` — platform console at `/admin`

## Quick start

1. Start Postgres (Docker Desktop must be running):

```bash
pnpm db:up
```

Local compose maps Postgres to **host port 5434** (to avoid clashes with other local DBs).

2. Copy env (already present for local):

```bash
cp .env.example .env
```

3. Install, migrate, seed super admin:

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000)

### Default super admin

- Email: `admin@ledgerdesk.local`
- Password: `ChangeMe_SuperAdmin_123!`

Change these in `.env` before production.

## Key routes

- `/signup` — firm self-registration
- `/login` — firm owner or team login
- `/app` — organization workspace
- `/app/banks` — multi-bank management + header bank switcher
- `/app/rules` — predefined rules (seeded)
- `/app/settings` — profile, password, manual team members
- `/admin` — super admin console
- `/api/webhooks/inbound` — HMAC-signed webhook intake

## Webhooks

Send `POST /api/webhooks/inbound` with header:

```text
x-ledgerdesk-signature: sha256=<hmac_sha256_hex_of_raw_body>
```

Secret: `WEBHOOK_SECRET` from env.

## Phase status

**Done (Phase 0–1 foundation)**

- Auth, RBAC, org isolation
- Super admin
- Manual team member creation (no email invite)
- Banks + active bank context
- Seeded tax codes, chart of accounts, predefined rules
- Middleware security headers + webhook skeleton
- Professional app shell

**Next**

- Statement import (CSV/PDF/XLS/OFX/QBO)
- Rule engine apply + bulk categorize
- Reconciliation, transfers, GE, GST/PST, exports
