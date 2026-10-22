# RUKN — Bilingual Dental Website & Admin CMS

Production-oriented website and content management system for **RUKN**, an Egypt-based multidisciplinary dental team (dentists, dental technicians, engineers) serving dental professionals worldwide.

- **Public site:** English (default, LTR) + Arabic (RTL), every text editable per language from the database.
- **Admin CMS at `/admin`:** pages & sections, services, media library, FAQs, team, navigation, announcements, interface text, inquiries (leads), settings, users & roles, trash, activity log.
- **Backend:** Supabase — PostgreSQL (data + Row Level Security), Auth (invitation-only staff accounts), Storage (images).

---

## 1. Architecture

| Layer | Technology |
|---|---|
| Web app | Next.js 15 (App Router, Server Components, Server Actions), TypeScript |
| Database | Supabase PostgreSQL, SQL migrations in `supabase/migrations` |
| Auth | Supabase Auth (e-mail + password, invite & password-reset links), cookie sessions via `@supabase/ssr` |
| Files | Supabase Storage bucket `media` (public read, write = content roles only) |
| Images | Uploaded once, validated and converted server-side with `sharp` into WebP at 480/960/1600 px + full |
| Fonts | Self-hosted Inter + IBM Plex Sans Arabic (no Google Fonts calls) |

```
src/
  middleware.ts                 locale prefixing, admin session refresh & login guard
  app/(site)/[locale]/…          public pages (home, CMS pages, /services/[slug])
  app/(site)/actions.ts          public inquiry submission (validation, honeypot, Turnstile, rate limit)
  app/(admin)/admin/…            admin CMS (auth pages + (panel) with sidebar)
  app/(admin)/admin/(panel)/_actions/   server actions (each checks the role, then RLS checks again)
  app/api/preview               draft preview for signed-in staff
  app/sitemap.ts, robots.ts     SEO
  lib/content.ts                public data loader (published vs. draft variants)
  lib/supabase/*                anon / session / browser / service-role clients
supabase/migrations/            schema, security (RLS, roles, RPCs), storage, initial content
scripts/                        create-admin.mjs, seed-media.mjs
tests/db/                       SQL permission test-suite (allowed AND denied cases)
tests/e2e/acceptance.py         Playwright end-to-end acceptance test
seed-assets/                    official logo + supplied marketing images
```

### Content model
- `languages` — add a row (Admin → Settings → Languages) to add a language; every editor shows a new tab automatically. No rebuild needed.
- Every translatable entity has a `*_translations` table keyed by `locale`.
- Pages, sections and services keep **two variants** per language: `draft` and `published`. Editors save drafts, preview them (`/api/preview`), then **Publish** copies the draft to the published variant. Visitors only ever see published rows (enforced by RLS, not just by the UI).
- FAQs, team profiles, navigation, announcements and interface text use a simple *draft / published* status.
- Deleting content moves it to **Trash** (restorable). Permanent deletion is possible from the Trash page.

Mapping to the suggested tables: `profiles`, `user_roles`, `site_settings` (+ `site_settings_translations`, `private_settings`), `pages` (+ `page_translations` — SEO title/description live here, i.e. the *seo_metadata*), `content_sections` (+ translations), `translations` (interface strings), `services`, `service_translations`, `service_images`, `media_assets` (+ alt-text translations), `inquiries`, `inquiry_notes`, `faqs`, `team_members`, `navigation_items`, `announcements`, `audit_logs`.

### Roles
| Role | Can |
|---|---|
| Super Administrator | everything: users, settings, languages, notifications, content, media, inquiries, delete inquiries |
| Content Manager | pages, sections, services, media, FAQs, team, navigation, announcements, publishing, trash |
| Sales Manager | inquiries, statuses, assignment, internal notes, CSV export |
| Translator | draft translations **only for the languages assigned to them**; cannot publish, cannot see leads or settings |
| Case Manager | all cases from all agents: intake, status workflow, files, quotation, payments/receipts, shipping, delivery, reports |
| Agent | external representative: creates cases, uploads records, follows **only his own cases**, records the doctor's plan approval, prints his documents and reports; no access to the website CMS or leads |

### Agents & case management
- Case code `RK-{country}-{YY}-{#####}` (e.g. `RK-JO-26-00004`); documents are numbered `RR-` (records receipt), `RC-` (payment receipt), `DN-` (delivery note).
- Workflow: Submitted → Records received → Digital diagnosis → Treatment planning → Awaiting doctor approval → Plan approved → In production → Quality check → Shipped → Delivered (plus Revision, On hold, Cancelled). Every change is written to the case timeline; internal notes are never visible to agents.
- Files live in the **private** `case-files` bucket (50 MB each, STL/PLY/OBJ/3MF/ZIP/PDF/images/DICOM/MP4) and are opened through 2-minute signed links.
- Printable A4 bilingual documents: case file, records receipt, payment receipt, delivery note, and the case report (also CSV export) under **Reports**.
- **Invoices per case**: Case → *New invoice* → add items from the **Price list** (aligners, Snap-On, retainers, planning, shipping…), arch, quantity, discount and tax → *Issue* (number `INV-YY-#####`, locked, visible to the agent). Payments can be applied to an invoice; the receipt and the invoice show the balance. Issued invoices are never edited or deleted — they are voided and replaced. Billing details (bank, tax no., terms) are set under **Price list & billing** (migration `20261022000700_case_invoices.sql`).
- **Finance** (case staff only, migration `20261022000800_finance.sql`):
  - Issued invoices can be edited; the number is kept and each save is a numbered revision logged on the case timeline and in the audit log. Voided invoices stay locked.
  - **Receivables**: unpaid issued invoices with ageing (not due / 1–30 / 31–60 / 61–90 / 90+), by agent, cases without an invoice; print + CSV.
  - **Cash boxes**: cash / bank / wallet boxes, receipt vouchers `CR-`, payment vouchers `CP-`, transfers `TR-` (with exchange), statements with running balance; a box can never pay out more than its balance. A case payment can be deposited into a box in one step. Vouchers print with the amount in words (English + Arabic).
  - **Person accounts**: what each person took (custody, withdrawals, salaries…) and returned, with printable statements.
- **Agent confirmations & payments** (migration `20261022000900_agent_receipts_payments.sql`):
  - The agent confirms receipt of the **shipment** (case → Delivered, delivery note issued) or of the **treatment plan**.
  - The agent sends a **payment notice** `PN-` (amount, method, transfer number, photo/PDF of the receipt). The case manager confirms it (**Finance → Payment notices** or on the case): an official receipt `RC-` is issued, applied to the invoice and deposited into the chosen cash box — or rejects it with a reason the agent sees.
  - **Account statements**: every agent sees *My account* (invoices, payments, balance, pending notices; printable); case staff see all agents.
- Create an agent: Users & roles → invite with role *Agent* and fill phone/country/organization (needs `SUPABASE_SERVICE_ROLE_KEY`). The agent signs in at `/admin`.

Permissions are enforced three times: the admin UI hides what a role cannot do, every server action checks the role, and **PostgreSQL Row Level Security** decides what each signed-in user can read or write (this is the authoritative layer). There is no public registration; a user without a role has no access even if an account exists.

---

## 2. Local development

Requirements: Node.js ≥ 20.9, a Supabase project (free tier is fine).

```bash
npm install
cp .env.example .env.local      # fill in the values (see §4)
npm run dev                     # http://localhost:3000  (admin: /admin)
```

## 3. Setting up Supabase (once)

1. Create a project at <https://supabase.com> (choose an EU region close to Egypt, e.g. Frankfurt).
2. **Apply the database migrations** — either
   - CLI: `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`, or
   - Dashboard → SQL Editor: run all files in `supabase/migrations/` **in order** (by file name).
3. **Authentication → Sign In / Providers → Email:** keep e-mail enabled, **turn OFF “Allow new users to sign up”**.
4. **Authentication → URL Configuration:**
   - Site URL: your deployment URL (e.g. `https://rukn.vercel.app`), later your domain.
   - Redirect URLs: `https://<your-site>/admin/auth/confirm` and `https://<your-site>/admin/auth/callback`.
5. (Recommended) **Authentication → SMTP:** configure your own SMTP sender. Supabase’s built-in mailer is heavily rate-limited and meant for testing.
6. **Import the brand assets** (logo, product images) and attach them to the pages:
   ```bash
   npm run seed:media
   ```
7. **Create the first Super Administrator** (from your own computer, never on a public server):
   ```bash
   npm run create-admin -- owner@your-company.com                 # sends an invitation e-mail
   # or, without e-mail:
   INITIAL_ADMIN_PASSWORD='a-long-password' npm run create-admin -- owner@your-company.com
   ```
   Alternative without the script: invite the user in Supabase Dashboard → Authentication → Users, then run in the SQL Editor:
   `select public.bootstrap_super_admin('owner@your-company.com');`
8. Sign in at `/admin/login`. Invite the rest of the team from **Admin → Users & roles**.

## 4. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon / publishable key (safe: RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | public | canonical URL — leave empty until the domain exists |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | invitations, account removal, notification settings, seeding scripts |
| `INQUIRY_HASH_SALT` | server only | 32+ random characters; visitor IPs are stored only as salted hashes |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | optional | Cloudflare Turnstile anti-spam on forms |
| `RESEND_API_KEY` + `NOTIFICATION_FROM_EMAIL` | optional | e-mail alerts for new inquiries |

Never prefix a secret with `NEXT_PUBLIC_` and never commit `.env.local`.

## 5. Deploying (Vercel — recommended)

1. Push the project to a private GitHub repository.
2. <https://vercel.com> → *Add New Project* → import the repository (framework: Next.js, defaults are fine).
3. Add the environment variables from §4 (Production + Preview). Leave `NEXT_PUBLIC_SITE_URL` empty for now.
4. Deploy. You get a temporary URL such as `https://rukn-xxxx.vercel.app`.
5. Put that URL into Supabase → Authentication → URL Configuration (§3.4) and redeploy.

Any Node.js host that runs `npm run build && npm start` works too (Netlify, Render, a VPS). Images and data live in Supabase, so the web server is stateless.

## 6. Connecting a domain (when purchased)

1. Buy the domain (e.g. at Namecheap, Cloudflare, GoDaddy, or an `.eg` registrar).
2. Vercel → Project → Settings → **Domains** → add `www.yourdomain.com` and `yourdomain.com`.
3. At the registrar’s **DNS** settings add the records Vercel shows, typically:
   - `A` record `@` → `76.76.21.21`
   - `CNAME` record `www` → `cname.vercel-dns.com`
4. **HTTPS** is issued automatically by Vercel once DNS resolves (minutes to a few hours).
5. Update:
   - Vercel env `NEXT_PUBLIC_SITE_URL=https://www.yourdomain.com` → redeploy.
   - Supabase Auth Site URL and Redirect URLs to the new domain.
   - Admin → Settings → “Public site URL”.
   - SMTP / Resend sender domain (add the SPF/DKIM DNS records they give you).
6. Submit `https://www.yourdomain.com/sitemap.xml` in Google Search Console.

## 7. E-mail notifications for inquiries

1. Create a free account at <https://resend.com>, verify your sending domain (DNS records).
2. Set `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (e.g. `RUKN Website <noreply@yourdomain.com>`) and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
3. Admin → Settings → *Inquiry e-mail notifications*: enable, add recipients, choose inquiry types.
The alert contains only the type, service, country and a link to the admin — personal details stay behind the login.

## 8. Backups & maintenance

- **Database:** Supabase Pro includes daily backups (point-in-time recovery as add-on). On the free tier, export regularly:
  `npx supabase db dump --linked -f backup-$(date +%F).sql` (and `--data-only` for data).
- **Images:** download the `media` bucket from Supabase → Storage, or via the Storage S3 API.
- Inquiries can be exported any time as CSV (Admin → Inquiries → Export CSV).
- Keep dependencies updated monthly (`npm outdated`, `npm update`), re-run `npm run build` and the tests.
- Review **Admin → Activity log** for who changed what.

## 9. Tests

- **Database permissions** (173 tests, allowed *and* denied cases for anonymous visitors, users without role, Sales, Content, Translator, Super Admin, inactive accounts, storage):
  `PGUSER=postgres npm run test:db` — needs a local PostgreSQL; it emulates the few Supabase objects it needs (`tests/db/shim.sql`).
- **Agents/case workflow** (24 checks: agent isolation, numbering, approvals, prints, reports): see `tests/e2e/cases_flow.py`.
- **Agent payments** (20 checks: receipt confirmations, payment notices with proof, confirm/reject, statements): see `tests/e2e/agent_payments_flow.py`.
- **Finance** (21 checks: invoice revision, receivables, cash boxes, vouchers, person accounts): see `tests/e2e/finance_flow.py`.
- **Invoices** (20 checks: price list, draft/issue/void, totals, payments, prints, agent isolation): see `tests/e2e/invoices_flow.py`.
- **End-to-end acceptance** (27 checks against the running app + a real Supabase stack): see the header of `tests/e2e/acceptance.py`. Run it against a staging project, never production.

## 10. Clinical data — important

The public website deliberately collects **professional contact details only**. Clinical records are uploaded only by signed-in agents/case staff into the private `case-files` bucket, with per-case access control (RLS), signed links and an audit trail; agents should use a patient reference rather than full patient names. After an inquiry, the visitor sees the *case-submission instructions* you configure in Settings (e.g. a secure file-transfer service you control). A future clinical-upload feature would need its own private bucket, per-case access control, encryption, retention rules, audit and a data-processing review.

## 11. Before launch — checklist

- [ ] Privacy Policy reviewed by a lawyer (the page shows a “legal review required” banner until you untick it in Admin → Pages → Privacy Policy).
- [ ] Real contact e-mail / WhatsApp / social links entered (all are hidden while empty — nothing is invented).
- [ ] Case-submission instructions point to a real secure channel.
- [ ] Image rights confirmed. The supplied product images look like rendered visuals and are therefore marked **“Illustrative image”**; untick that flag only for real photos of RUKN products.
- [ ] “Snap-On Smile” is a third-party trademark; confirm with your lawyer how you may reference it (the site uses “Snap-On Smile-style”).
- [ ] Mission, vision and values texts approved by the team (they were drafted from the approved description and are editable).
- [ ] Team profiles added only with each person’s consent.
- [ ] Own SMTP configured in Supabase; Turnstile keys added; analytics and cookie settings chosen.
