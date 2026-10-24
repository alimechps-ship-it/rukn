"""
End-to-end test: an advance paid by an agent settles the invoices issued afterwards
(receivables, invoice page, statement).

  BASE_URL=… OWNER_EMAIL=… OWNER_PASSWORD=… FINANCE_EMAIL=… FINANCE_PASSWORD=… python tests/e2e/advance_settlement_flow.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
E = os.environ
results = []
PW = "Agent-Pass-2026"


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))


def login(page, email, pw):
    page.goto(f"{BASE}/admin/login")
    page.fill("#email", email)
    page.fill("#password", pw)
    page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/admin" in u and "/login" not in u, timeout=20000)


def invoice(fin, case_url, amount):
    fin.goto(case_url)
    fin.get_by_role("button", name="+ New invoice").click()
    fin.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    fin.fill("#inv-currency", "USD")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Description (English)']").fill("Aligners")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Unit price']").fill(str(amount))
    fin.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    fin.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    return fin.url.split("?")[0], re.search(r"INV-\d{2}-\d{5}", fin.inner_text("h1")).group(0)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    email, name = f"adv{stamp}@rukn.test", f"Advance Agent {stamp}"

    # ---- a brand-new agent ----
    ow = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(ow, E["OWNER_EMAIL"], E["OWNER_PASSWORD"])
    ow.goto(f"{BASE}/admin/users")
    f = ow.locator("#add form")
    f.locator("#email").fill(email)
    f.locator("#full_name").fill(name)
    f.locator("#password").fill(PW)
    f.get_by_role("button", name="Create account").click()
    ow.wait_for_selector("#add .flash.ok", timeout=20000)

    ag = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(ag, email, PW)
    ag.goto(f"{BASE}/admin/cases/new")
    ag.select_option("select[name=service_id]", index=1)
    ag.fill("input[name=clinic_name]", f"Advance Clinic {stamp}")
    ag.fill("input[name=doctor_name]", "Dr. Advance")
    ag.select_option("select[name=country_code]", "EG")
    ag.fill("input[name=patient_ref]", f"ADS-{stamp}")
    ag.get_by_role("button", name="Create case").click()
    ag.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = ag.url.split("?")[0]

    # ---- advance 300 USD, confirmed by finance ----
    ag.goto(f"{BASE}/admin/statement")
    sec = ag.locator("#send-payment")
    check("Agent with no balance is invited to send an advance", "advance payment" in sec.inner_text())
    sec.locator("#pn-amt").fill("300")
    sec.locator("#pn-cur").fill("USD")
    sec.locator("#pn-ref").fill(f"ADV-{stamp}")
    sec.get_by_role("button", name=re.compile("Send payment notice")).click()
    ag.wait_for_selector("#send-payment .flash.ok:has-text('Payment notice PN-')", timeout=60000)
    pn = re.search(r"PN-\d{2}-\d{5}", ag.inner_text("#send-payment .flash.ok")).group(0)

    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    fin.goto(f"{BASE}/admin/finance/notices")
    n = fin.locator("li.notice", has_text=pn)
    n.locator("select[name=cash_account_id]").select_option(n.locator("select[name=cash_account_id] option", has_text="USD").first.get_attribute("value"))
    n.get_by_role("button", name=re.compile("Confirm payment")).click()
    fin.locator("li.notice", has_text=pn).locator(".pill", has_text="Confirmed").wait_for(timeout=20000)

    # ---- invoices issued afterwards ----
    inv1_url, inv1 = invoice(fin, case_url, 500)
    check("Invoice page applies the advance (500 − 300 = 200)", "advance applied −$300.00" in fin.inner_text(".flash.warn") and "balance due $200.00" in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))
    inv2_url, inv2 = invoice(fin, case_url, 100)
    check("The advance is used up — the next invoice is fully due (100)", "balance due $100.00" in fin.inner_text(".flash.warn") and "advance applied" not in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))

    agent_id = None
    fin.goto(f"{BASE}/admin/finance/receivables")
    opt = fin.locator("select[name=agent] option", has_text=name)
    if opt.count():
        agent_id = opt.first.get_attribute("value")
        fin.goto(f"{BASE}/admin/finance/receivables?agent={agent_id}")
    rows = fin.inner_text("main").replace("\xa0", " ")
    check("Receivables show the first invoice net of the advance (200) and the second in full (100)", inv1 in rows and inv2 in rows and "incl. advance $300.00" in rows and "$200.00" in rows, rows[-700:])

    ag.goto(f"{BASE}/admin/statement")
    st = ag.inner_text("main").replace("\xa0", " ")
    check("Agent's balance due is 600 − 300 = 300", "$300.00" in ag.inner_text(".stats"), ag.inner_text(".stats"))
    ag.goto(case_url)
    check("Agent sees the reduced balance on his invoice (200)", "$200.00" in ag.inner_text("main"))
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
