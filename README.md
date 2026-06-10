# FreshLoop

FreshLoop is a personal pantry management app that reads quick-commerce order emails, updates a
shared household pantry, tracks expiry dates, and highlights items that are expiring, expired, or
ready to refill.

This repo contains the Phase 1 foundation:

- Next.js App Router + Tailwind UI
- Supabase schema for households, users, Gmail connections, inventory, stock, purchases, aliases,
  and parser runs
- Gmail OAuth routes using the read-only Gmail scope
- Scheduled ingestion endpoint for Instamart and Blinkit order emails
- Modular retailer parser interface
- Tiered fuzzy matcher and shelf-life expiry helpers
- Basic dashboard: pantry, items to buy, needs review, and purchase history

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure the values in `.env.local` before using Supabase, Gmail OAuth, or cron ingestion.

Generate the Gmail token encryption key with:

```bash
openssl rand -base64 32
```

## Supabase

The local Supabase project scaffold lives in `supabase/`.

Apply the migration to your Supabase project:

```bash
npx supabase db push
```

The initial migration enables RLS on all public tables. Household access is based on rows in
`public.users`, not user-editable auth metadata.

The original Google Sheet export is not in this repo. Export it as CSV and import rows into
`public.inventory_items` after creating a household. Use `data/inventory_items.example.csv` as the
expected column shape.

## Gmail ingestion

1. Create a Google OAuth client.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.
3. Sign in through Supabase email magic link.
4. Visit `/api/gmail/oauth/start` to connect Gmail with `gmail.readonly`.
5. Trigger ingestion:

```bash
curl -X POST http://localhost:3000/api/cron/ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

Vercel Cron can call the same endpoint every few hours.

## Retailer parsers

Parsers implement:

```ts
type RetailerParser = {
  retailer: "instamart" | "blinkit";
  gmailQuery: string;
  parse(emailHtml: string, emailDate: Date): ParsedLineItem[];
};
```

Instamart uses the POC regex. Blinkit currently uses tolerant HTML/text extraction because a real
Blinkit delivered-order email sample still needs to be inspected to confirm sender, subject, and
line-item structure.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```