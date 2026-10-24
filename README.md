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
| Case Manager | **operations only**: all cases from all agents — intake, status workflow, files, treatment plans, work orders to planners/labs (without costs), **dispatch orders** (services + quantities, no prices) sent to finance, shipping, delivery, reports without amounts. Sees **no** prices, invoices, payments, payment notices, cash boxes, statements or partner bills |
| Finance Manager | all money: price list & billing, pricing dispatch orders into invoices (“To price”), invoices, quotations, payments & receipts, payment notices from agents, cash boxes, person accounts, receivables, agent statements, work-order costs, partner bills & payments, AI assistant with money tools. Can open cases (read) |
| Treatment planner (partner) | external doctor / clinic doing digital treatment plans: sees only the work orders sent to him (clinical brief + files), uploads the plan, accepts / completes orders, bills RUKN, sees his statement |
| Production lab (partner) | external lab producing aligners / Snap-On / retainers: same portal for production orders, can ship with tracking, bills RUKN |
| Agent | external representative: creates cases, uploads records, follows **only his own cases**, records the doctor's plan approval, prints his documents and reports; no access to the website CMS or leads |

### Agents & case management
- Case code `RK-{country}-{YY}-{#####}` (e.g. `RK-JO-26-00004`); documents are numbered `RR-` (records receipt), `RC-` (payment receipt), `DN-` (delivery note).
- Workflow: Submitted → Records received → Digital diagnosis → Treatment planning → Awaiting doctor approval → Plan approved → In production → Quality check → Shipped → Delivered (plus Revision, On hold, Cancelled). Every change is written to the case timeline; internal notes are never visible to agents.
- Files live in the **private** `case-files` bucket (50 MB each, STL/PLY/OBJ/3MF/ZIP/PDF/images/DICOM/MP4) and are opened through 2-minute signed links.
- Printable A4 bilingual documents: case file, records receipt, payment receipt, delivery note, and the case report (also CSV export) under **Reports**.
- **Invoices per case**: Case → *New invoice* → add items from the **Price list** (aligners, Snap-On, retainers, planning, shipping…), arch, quantity, discount and tax → *Issue* (number `INV-YY-#####`, locked, visible to the agent). Payments can be applied to an invoice; the receipt and the invoice show the balance. Issued invoices are never edited or deleted — they are voided and replaced. Billing details (bank, tax no., terms) are set under **Price list & billing** (migration `20261022000700_case_invoices.sql`).
- **Finance** (finance manager only, migration `20261022000800_finance.sql`):
  - Issued invoices can be edited; the number is kept and each save is a numbered revision logged on the case timeline and in the audit log. Voided invoices stay locked.
  - **Receivables**: unpaid issued invoices with ageing (not due / 1–30 / 31–60 / 61–90 / 90+), by agent, cases without an invoice; print + CSV.
  - **Cash boxes**: cash / bank / wallet boxes, receipt vouchers `CR-`, payment vouchers `CP-`, transfers `TR-` (with exchange), statements with running balance; a box can never pay out more than its balance. A case payment can be deposited into a box in one step. Vouchers print with the amount in words (English + Arabic).
  - **Person accounts**: what each person took (custody, withdrawals, salaries…) and returned, with printable statements.
- **Agent confirmations & payments** (migration `20261022000900_agent_receipts_payments.sql`):
  - The agent confirms receipt of the **shipment** (case → Delivered, delivery note issued) or of the **treatment plan**.
  - The agent sends a **payment notice** `PN-` (amount, method, transfer number, photo/PDF of the receipt). The finance manager confirms it (**Finance → Payment notices** or on the case): an official receipt `RC-` is issued, applied to the invoice and deposited into the chosen cash box — or rejects it with a reason the agent sees.
  - **Payments on account / advances** (migration `20261022001600_agent_account_payments.sql`): from *My account* the agent sends a payment notice for **any** of his open invoices or **on account / in advance** (no case); his cases page shows the balance due with a *Send a payment* button. The finance manager confirms it as usual (receipt `RC-` on the agent's account, into a cash box) or rejects it. Proofs without a case are stored privately under `case-files/agent/<agent id>/`.
  - **Statements per currency**: agent and partner statements (screen and print) show one table per currency, each with its own opening balance, totals and closing balance.
  - **Account statements**: every agent sees *My account* (invoices, payments, balance, pending notices; printable); case staff see all agents.
- **AI tools** (optional, migration `20261022001000_ai.sql`, env `ANTHROPIC_API_KEY`):
  - **AI assistant** (case staff; the case manager gets only the case tools, finance gets all): questions in Arabic/English answered from live data through read-only tools (cases, stats, receivables, agent balances, cash boxes, person accounts, payment notices). Queries run with the user's session, so RLS applies. Daily limit per user (`AI_DAILY_LIMIT`), every request logged in `ai_usage`.
  - **Receipt reader**: when an agent attaches a transfer receipt (image/PDF) to a payment notice, it is read in the background and compared with the notice (amount, currency, date, reference) → "matches" / "differences found" shown to case staff only; "Re-check with AI" button. It never accepts or rejects by itself.
  - Local tests use `tests/e2e/mock-anthropic.mjs` (set `ANTHROPIC_BASE_URL=http://localhost:54400`).
- **Planners & labs** (migration `20261022001100_partners.sql`):
  - Partners (treatment planners, production labs) with logins (Users & roles → role *Treatment planner* / *Production lab* + partner).
  - **Work orders** `WO-` sent from the case page (planning / production) with instructions, items, due date and agreed cost. The partner accepts or declines, uploads files, completes (labs also ship with tracking); messages and full history per order; printable work order.
  - Partner files stay **internal** until RUKN presses *Send to agent*. Partners never see clinic prices, agents, payments or other partners.
  - **Partner bills** `PB-` (partner sends from his completed orders, or RUKN records one) → RUKN approves / rejects; **payments** `PP-` paid from a cash box create a payment voucher automatically; partner statements (screen + print); case page shows invoiced − costs.
- **Case manager ↔ finance separation** (migration `20261022001200_finance_separation.sql`):
  - Case price moved to `case_finance`, work-order costs to `assignment_costs`; every money table (invoices, payments, notices, cash, price list, partner bills/payments) is readable/writable by **Finance Manager** (and Super Admin) only — enforced by RLS, so the case manager cannot reach money even through the API. Payment events and payment proofs are hidden from the case manager's timeline and files.
  - Flow: case manager → Case → **Dispatch orders · أذون الصرف** → *+ New dispatch order* → add services from the catalog (no prices) with arch and quantity → *Send to finance*. Number `DO-YY-#####`, printable with signatures.
  - Finance → **To price · بانتظار التسعير** (badge) → *Price & invoice* → a draft invoice is created with the price-list prices → review, *Issue*. The case manager sees only “Priced & invoiced”. He can recall a sent order while it is not yet priced.
  - Finance sets the agreed cost of each work order (work order page → *Agreed cost*).
- **Exchange rates** (migration `20261022001300_exchange_rates.sql`, Finance → Exchange rates):
  - Every currency is linked through USD (“1 USD = x”), so any pair (EGP↔SAR, EUR↔EGP…) is derived. Rates update automatically from a free daily service (`open.er-api.com`, at most every 12 h when finance opens the cash pages, or with *Update rates now*); env `FX_API_URL` overrides the source.
  - Finance can set a rate by hand and **lock** it (the automatic update then leaves it alone) or return it to automatic. Every change is kept in the history (who, when, old → new).
  - **Transfer between boxes** in different currencies proposes the automatic rate and the received amount; the user can change the rate or type the received amount (the other follows). The rate used and whether it was automatic or manual are stored on both vouchers and printed in their text. Cash page shows the total of all boxes converted to USD and EGP.
- **Cash vouchers with labs & clinics** (migration `20261022001400_cash_partners.sql`):
  - Payment and receipt vouchers have one searchable “Paid to / received from” field: type part of a lab or clinic name, contact, phone, city, the type (lab / معمل / clinic / عيادة) or a team member / agent; or keep a free-typed name.
  - A **payment voucher to a lab / clinic** is recorded as a partner payment `PP-` (optionally for one of its approved bills, which fills the amount), so it reduces what RUKN owes them and appears in their statement and portal.
  - A **receipt voucher from a lab / clinic** (money returned) uses the type “Returned by a lab / clinic”, counts in their balance and statement, and the partner can see / print it. Vouchers with partners do not appear in person accounts.
  - **Vouchers with agents** (migration `20261024001800_cash_agents.sql`): agents appear in the party search marked *Agent*. A payment voucher to an agent is a **debit** and a receipt voucher from him a **credit** in his account statement (types “Paid to an agent” / “Received from an agent”); the agent sees and prints his own vouchers. Vouchers made earlier to a person who is an agent are linked to his account by the migration.
  - **Voucher search** on the cash page: voucher number, party, lab / clinic, description or reference.
- **Journal entries · القيود** (migration `20261022001500_journal_entries.sql`, Finance → Journal entries): simple entries `JV-` — **one debit account, one credit account** (قيد بسيط), no cash movement, printable journal voucher with the amount in words.
  - Accounts: agents, labs / clinics, and general accounts (chart: 4100 other services revenue, 4200 discount earned, 4900 other income, 5100 discount allowed, 5200 other expenses, 5300 bad debts, 6100 currency differences, 3100 opening balances — finance can add / rename / close accounts). Each general account shows its balance and movements.
  - Effects: agent — debit adds to what he owes, credit reduces it; lab / clinic — credit adds to what RUKN owes it, debit reduces it. A side can point at the agent's issued invoice / the partner's approved bill (same currency): the document's balance changes too.
  - **Same account, two currencies**: an agent / partner / account may be on both sides only when the currencies differ — this converts its balance from one currency to another (e.g. Dr agent 100 USD / Cr agent 5,000 EGP); migration `20261023001700_journal_same_account.sql`.
  - **Currencies**: each side has its own currency; when they differ the credit amount follows the automatic exchange rate, or a rate / amount the user types (stored as auto / manual).
  - Quick patterns: discount allowed, discount earned, charge an agent for other services, extra charge from a lab, currency differences, offset lab ↔ agent, move a balance between agents; ⇄ swaps the sides.
  - Shown in agent and partner statements and balances; the agent / partner sees and prints his own entries. Entries are never edited or deleted — voided with a reason. This replaces the earlier “adjustments” (the migration removes them if installed).
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

- **Database permissions** (297 tests, allowed *and* denied cases for anonymous visitors, users without role, Sales, Content, Translator, Super Admin, inactive accounts, storage):
  `PGUSER=postgres npm run test:db` — needs a local PostgreSQL; it emulates the few Supabase objects it needs (`tests/db/shim.sql`).
- **Payments on account / advances** (12 checks: balance banner, My account form, advance without a case, invoice notice from the account page, finance confirmation into a box, statement, receipt print): see `tests/e2e/account_payments_flow.py`.
- **Journal entries** (18 checks: templates, discount on an invoice, discount earned, offset across currencies with edited rate, ledger account statement, agent statement & print, void): see `tests/e2e/journal_flow.py`.
- **Cash vouchers with labs, clinics & agents** (11 checks: picker search, payment as PP-, refund, voucher search, partner balance & statement): see `tests/e2e/cash_partners_flow.py`.
- **Exchange rates** (14 checks: automatic update, locked manual rate, transfers with automatic / edited rate / typed amount, access): see `tests/e2e/fx_flow.py` (run the app with `FX_API_URL=http://localhost:54400/fx` and the mock server).
- **Case manager / finance separation** (23 checks: menus and pages denied to the case manager, dispatch order → finance queue → priced invoice, no amounts visible to operations): see `tests/e2e/dispatch_flow.py`. The money e2e tests sign in with `FINANCE_EMAIL` / `FINANCE_PASSWORD`.
- **Agents/case workflow** (28 checks: agent isolation, numbering, approvals, prints, reports): see `tests/e2e/cases_flow.py`.
- **Planners & labs** (32 checks: partner logins, work orders, internal files, bills, payments, statements, isolation): see `tests/e2e/partners_flow.py`.
- **AI tools** (13 checks with the mock API, incl. the case manager getting no money tools): see `tests/e2e/ai_flow.py`.
- **Agent payments** (23 checks: receipt confirmations, payment notices with proof, confirm/reject, statements): see `tests/e2e/agent_payments_flow.py`.
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
