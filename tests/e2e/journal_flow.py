"""
End-to-end test of simple journal entries (debit / credit account with currencies):
discount allowed on an invoice, discount earned from a lab, offset lab ↔ agent across
currencies, ledger account statement, agent statement + print, void.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… FINANCE_EMAIL=… FINANCE_PASSWORD=… python tests/e2e/journal_flow.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
E = os.environ
SHOTS = E.get("SHOTS_DIR")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))


def login(page, email, pw):
    page.goto(f"{BASE}/admin/login")
    page.fill("#email", email)
    page.fill("#password", pw)
    page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/admin" in u and "/login" not in u, timeout=20000)


def ok(page, text, timeout=20000):
    page.wait_for_selector(f".flash.ok:has-text('{text}')", timeout=timeout)
    page.wait_for_load_state("networkidle")


def record(page):
    """Submit the entry and wait until the form clears (server confirmed); return the new JV number."""
    page.get_by_role("button", name=re.compile("Record entry")).click()
    for _ in range(80):
        if page.input_value("#jv-amt") == "":
            break
        page.wait_for_timeout(250)
    page.wait_for_load_state("networkidle")
    m = re.search(r"JV-\d{2}-\d{5}", page.inner_text(".flash.ok"))
    return m.group(0) if m else None


def pick(page, input_id, text, option_text):
    page.fill(f"#{input_id}", text)
    page.locator(".picker-list li", has_text=option_text).first.click()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    lab = f"Sigma Lab {stamp}"

    # ---- agent case + finance invoice 1000 USD ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Journal Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Journal")
    a1.select_option("select[name=country_code]", "EG")
    a1.fill("input[name=patient_ref]", f"JV-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]

    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    fin.goto(case_url)
    fin.get_by_role("button", name="+ New invoice").click()
    fin.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    fin.fill("#inv-currency", "USD")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Description (English)']").fill("Clear aligners")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Unit price']").fill("1000")
    fin.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    fin.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    inv_url = fin.url.split("?")[0]
    inv_no = re.search(r"INV-\d{2}-\d{5}", fin.inner_text("h1")).group(0)

    # ---- a lab ----
    fin.goto(f"{BASE}/admin/partners")
    fin.locator("summary", has_text="Add a planner or lab").click()
    fin.select_option("#kind-new", "lab")
    fin.fill("#name-new", lab)
    fin.fill("#currency-new", "USD")
    fin.get_by_role("button", name="Add partner").click()
    fin.wait_for_url(re.compile(r"/admin/partners/[0-9a-f-]{36}"), timeout=20000)
    partner_url = fin.url
    nav = fin.inner_text("aside")
    check("Journal entries in the finance menu (no adjustments page)", "Journal entries" in nav and "Adjustments" not in nav)

    # ---- 1. discount allowed: Dr 5100 Discount allowed / Cr agent (on his invoice) ----
    fin.goto(f"{BASE}/admin/finance/journal")
    fin.get_by_role("button", name="خصم مسموح به").click()
    check("Template fills the debit side with the Discount allowed account", "Discount allowed" in fin.inner_text(".jv-side.dr"))
    pick(fin, "jv-cr", "omar", "Omar Haddad")
    check("Credit to an agent explains it reduces what he owes", "reduces what the agent owes" in fin.inner_text(".jv-side.cr"))
    fin.select_option("#jv-cr-doc", fin.locator("#jv-cr-doc option", has_text=inv_no).first.get_attribute("value"))
    fin.fill("#jv-amt", "100")
    fin.fill("#jv-dr-cur", "USD")
    fin.fill("#jv-desc", f"Loyalty discount {stamp}")
    jv1 = record(fin)
    fin.goto(inv_url)
    check("Invoice balance drops by the credit (1000 → 900)", "balance due $900.00" in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))

    # ---- 2. discount earned: Dr lab / Cr 4200 ----
    fin.goto(f"{BASE}/admin/finance/journal")
    fin.get_by_role("button", name="خصم مكتسب").click()
    pick(fin, "jv-dr", f"sigma {stamp}", lab)
    fin.fill("#jv-amt", "20")
    jv2 = record(fin)

    # ---- 3. offset across currencies: Dr lab (USD) / Cr agent (EGP) ----
    fin.get_by_role("button", name="تقاص: شريك مقابل مندوب").click()
    pick(fin, "jv-dr", f"sigma {stamp}", lab)
    pick(fin, "jv-cr", "omar", "Omar Haddad")
    fin.fill("#jv-amt", "30")
    fin.fill("#jv-dr-cur", "USD")
    fin.fill("#jv-cr-cur", "EGP")
    rate = fin.input_value("#jv-rate")
    check("Different currencies: the automatic rate is proposed", rate != "" and "automatic" in fin.inner_text("label[for=jv-rate]"), rate)
    fin.fill("#jv-rate", "50")
    check("Edited rate recalculates the credit amount (30 × 50 = 1500 EGP)", fin.input_value("#jv-cramt") == "1500" and "edited" in fin.inner_text("label[for=jv-rate]"), fin.input_value("#jv-cramt"))
    fin.fill("#jv-desc", f"Set-off {stamp}")
    jv3 = record(fin)
    check("Three different entries recorded", len({jv1, jv2, jv3}) == 3 and None not in (jv1, jv2, jv3), str((jv1, jv2, jv3)))
    if SHOTS: fin.screenshot(path=f"{SHOTS}/journal.png", full_page=True)

    fin.goto(f"{BASE}/admin/finance/journal?q={stamp}")
    rows = fin.inner_text("table.data").replace("\xa0", " ")
    check("Journal list shows debit and credit with both currencies", jv3 in rows and "$30.00" in rows and "EGP 1,500.00" in rows, f"{jv3} {jv3 in rows} {'$30.00' in rows} {'EGP 1,500.00' in rows}")

    # ---- ledger account statement ----
    fin.goto(f"{BASE}/admin/finance/journal")
    fin.locator("#accounts a", has_text="Discount allowed").first.click()
    fin.wait_for_load_state("networkidle")
    check("Ledger account page lists its movements with a running balance", jv1 in fin.inner_text("main") and "Dr $" in fin.inner_text("table.data"))

    # ---- lab account: −20 (discount earned) − 30 (offset) ----
    fin.goto(partner_url)
    check("Lab account: RUKN owes −50", "-$50.00" in fin.inner_text(".stats").replace("−", "-"), fin.inner_text(".stats"))

    # ---- agent statement + print ----
    a1.goto(f"{BASE}/admin/statement")
    st = a1.inner_text("main")
    check("Agent statement shows both entries (USD discount, EGP set-off)", jv1 in st and jv3 in st and "Discount allowed" in st, st[:600])
    href = a1.locator("a", has_text=jv1).first.get_attribute("href")
    pg = a1.context.new_page()
    r = pg.goto(f"{BASE}{href}")
    body = pg.inner_text("body")
    check("Agent prints the journal voucher (Dr / Cr, amount in words)", r.status == 200 and "Journal Voucher" in body and "قيد يومية" in body and "One hundred US dollars" in body, body[:400])
    pg.close()

    # ---- void → invoice back to 1000 ----
    fin.goto(f"{BASE}/admin/finance/journal?q={jv1}")
    row = fin.locator("tr", has_text=jv1)
    row.locator("summary", has_text="Void").click()
    row.locator("input[name=reason]").fill("Discount withdrawn")
    row.get_by_role("button", name="Void").click()
    fin.locator("tr", has_text=jv1).locator(".pill", has_text="void").wait_for(timeout=20000)
    fin.goto(inv_url)
    check("Voiding the entry restores the invoice balance (1000)", "balance due $1,000.00" in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))
    # ---- same agent, two currencies (currency conversion of his balance) ----
    fin.goto(f"{BASE}/admin/finance/journal")
    pick(fin, "jv-dr", "omar", "Omar Haddad")
    fin.fill("#jv-dr-cur", "USD")
    fin.get_by_role("button", name=re.compile("Same account in another currency")).click()
    fin.fill("#jv-cr-cur", "EGP")
    check("Same account on both sides is accepted as a currency conversion", "Currency conversion of the same account" in fin.inner_text(".jv-side.cr"))
    fin.fill("#jv-amt", "20")
    fin.fill("#jv-rate", "50")
    fin.fill("#jv-desc", f"Convert {stamp}")
    jv4 = record(fin)
    check("Conversion entry recorded", jv4 is not None and jv4 not in (jv1, jv2, jv3), str(jv4))
    a1.goto(f"{BASE}/admin/statement")
    usd = a1.locator("section.panel", has=a1.locator("h2", has_text="Movements in USD")).inner_text()
    egp = a1.locator("section.panel", has=a1.locator("h2", has_text="Movements in EGP")).inner_text()
    check("Statement has a separate table per currency", "Movements in USD" in usd and "Movements in EGP" in egp and a1.locator("section.panel table.data", has=a1.locator("text=Opening balance")).count() >= 0 and a1.locator("section.panel:has(h2:has-text('Movements in'))").count() >= 2)
    check("The conversion appears in both tables: debit 20 USD and credit 1,000 EGP", jv4 in usd and jv4 in egp and "1,000.00" in egp.replace("\xa0", " "), egp[:300])
    check("Each table ends with its own total row", "Total · الإجمالي (USD)" in usd and "Total · الإجمالي (EGP)" in egp)
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
