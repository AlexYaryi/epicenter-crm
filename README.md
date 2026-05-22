# Epicenter Rental OS CRM

Production-oriented Next.js + Supabase foundation for the Epicenter car rental CRM.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase setup

1. Create a Supabase project.
2. Run the SQL from `../docs/01_postgresql_ddl.sql` in Supabase SQL editor.
3. Add values to `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Restart `npm run dev`.

The app falls back to demo data when Supabase env vars are not configured, so UI work can continue before the database is connected.

## Roles

- `owner`: full access to ROI, P&L, recommendations, settings and integrations.
- `operator`: leads, customers, bookings, handover/return and data entry. Strategic finance is hidden.
- `accountant`: finance and documents.
- `manager`: operational management without full acquisition-cost visibility.

