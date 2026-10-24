"""
End-to-end test of finance: invoice revision, receivables, cash boxes, vouchers,
person accounts and the link between case payments and cash boxes.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… python tests/e2e/finance_flow.py
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


def flash(page, text, scope="", timeout=20000):
    page.wait_for_selector(f"{scope} .flash.ok:has-text('{text}')".strip(), timeout=timeout)
    page.wait_for_load_state("networkidle")


def shot(page, name, full=True):
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/{name}.png", full_page=full)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-4:]

    # ---- agent submits a case ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Cairo Dental Center {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Sara Fahmy")
    a1.select_option("select[name=country_code]", "EG")
    a1.fill("input[name=patient_ref]", f"FIN-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    check("Agent menu has no finance section", "Finance" not in a1.inner_text("aside"))
    r = a1.goto(f"{BASE}/admin/finance/cash")
    check("Agent cannot open the cash boxes", "/admin/finance/cash" not in a1.url or r.status in (403, 404))

    # ---- case manager: invoice in EGP, issue ----
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    check("Finance section in the case-manager menu", all(x in cm.inner_text("aside") for x in ["Receivables", "Cash boxes", "Person accounts"]))
    cm.goto(case_url)
    cm.get_by_role("button", name="+ New invoice").click()
    cm.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    inv_url = cm.url.split("?")[0]
    cm.select_option("#inv-currency", "EGP")
    cm.select_option("#inv-pick", cm.locator("#inv-pick option", has_text="ALN-FULL").first.get_attribute("value"))
    cm.select_option("#inv-pick", cm.locator("#inv-pick option", has_text="RET-SET").first.get_attribute("value"))
    rows = cm.locator("table.inv-lines tbody tr")
    rows.nth(0).locator("input[aria-label='Unit price']").fill("20000")
    rows.nth(1).locator("input[aria-label='Unit price']").fill("1500")
    cm.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    cm.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    inv_no = re.search(r"INV-\d{2}-\d{5}", cm.inner_text("h1")).group(0)
    check("EGP invoice issued (21,500)", "EGP 21,500.00" in cm.inner_text("main") or "21,500.00" in cm.inner_text("main"))

    # ---- revise the issued invoice ----
    check("Issued invoice opens in the editor (editable)", cm.locator("#inv-pick").count() == 1 and "editing an issued invoice" in cm.inner_text("main"))
    cm.locator("table.inv-lines tbody tr").nth(1).locator("input[aria-label=Quantity]").fill("2")
    cm.fill("#inv-revnote", "Second retainer set added")
    cm.get_by_role("button", name=re.compile("Save changes")).click()
    cm.wait_for_url(re.compile(r"revised=1"), timeout=20000)
    msg = cm.locator(".flash.ok", has_text="revision 1").inner_text()
    check("Revision saved: number kept, total updated", inv_no in msg and "21500.00 → 23000.00" in msg, msg)
    cm.reload()
    check("Invoice shows its revision number", "rev. 1" in cm.inner_text("h1"))
    cm.goto(case_url)
    check("Revision is logged on the case timeline", "revised (rev. 1): 21500.00 → 23000.00 EGP — Second retainer set added" in cm.inner_text(".timeline"))

    # ---- a fresh cash box for this run ----
    box_name = f"Test box {stamp}"
    cm.goto(f"{BASE}/admin/finance/cash")
    cm.locator("summary", has_text="Add a cash box").click()
    cm.fill("#na-name", box_name)
    cm.select_option("#na-cur", "EGP")
    cm.get_by_role("button", name="Add box").click()
    flash(cm, "created")

    # ---- payment deposited into the EGP box ----
    cm.goto(case_url)
    cm.locator("summary", has_text="Record a payment").click()
    cm.fill("input[name=amount]", "8000")
    box = cm.locator("select[name=cash_account_id] option", has_text=box_name).first.get_attribute("value")
    cm.select_option("select[name=cash_account_id]", box)
    cm.locator("form:has(input[name=amount])").get_by_role("button", name="Record payment").click()
    flash(cm, "deposited in the cash box")

    # ---- receivables ----
    cm.goto(f"{BASE}/admin/finance/receivables")
    main = cm.inner_text("main")
    check("Receivables lists the invoice with its balance (15,000)", inv_no in main and "15,000.00" in main)
    check("Cases without invoice section present", "Cases without an invoice" in main)
    shot(cm, "fin_receivables")
    csv = cm.request.get(f"{BASE}/admin/finance/receivables/export")
    check("Receivables CSV export", csv.status == 200 and inv_no in csv.text())
    pg = cm.context.new_page(); r = pg.goto(f"{BASE}/admin/print/finance/receivables")
    check("Receivables print", r.status == 200 and "Receivables Report" in pg.inner_text("body") and inv_no in pg.inner_text("body"))
    if SHOTS: pg.screenshot(path=f"{SHOTS}/print_receivables.png", full_page=True)
    pg.close()

    # ---- cash boxes ----
    cm.goto(f"{BASE}/admin/finance/cash")
    check("Payment appears in the cash box as a receipt voucher", re.search(r"CR-\d{2}-\d{5}", cm.inner_text("main")) is not None and "8,000.00 EGP" in cm.inner_text("main"))
    out = cm.locator("form:has(input[name=direction][value=out])")
    out.locator("select[name=account_id]").select_option(box)
    out.locator("input[name=amount]").fill("9000")
    out.locator("select[name=category]").select_option("advance")
    out.locator("#new-out-party").fill(f"Ahmed courier {stamp}")  # free name (not in the list)
    out.get_by_role("button", name=re.compile("Record payment")).click()
    cm.wait_for_selector("form:has(input[name=direction][value=out]) .flash.err", timeout=15000)
    check("Box cannot pay more than its balance", "Not enough money" in out.locator(".flash.err").inner_text())
    out.locator("input[name=amount]").fill("3000")
    out.locator("input[name=description]").fill("Custody for courier & shipping")
    out.get_by_role("button", name=re.compile("Record payment")).click()
    flash(cm, "Payment voucher CP-", "form:has(input[name=direction][value=out])")
    inn = cm.locator("form:has(input[name=direction][value=in])")
    inn.locator("select[name=account_id]").select_option(box)
    inn.locator("input[name=amount]").fill("500")
    inn.locator("select[name=category]").select_option("advance_return")
    inn.locator("#new-in-party").fill(f"Ahmed courier {stamp}")
    inn.get_by_role("button", name=re.compile("Record receipt")).click()
    flash(cm, "Receipt voucher CR-", "form:has(input[name=direction][value=in])")
    cm.reload()
    shot(cm, "fin_cash")
    vno = re.search(r"CP-\d{2}-\d{5}", cm.inner_text("main")).group(0)
    row = cm.locator("tr", has=cm.locator("td.mono", has_text=vno))
    href = row.locator("a[title='Print voucher']").get_attribute("href")
    pg = cm.context.new_page(); r = pg.goto(f"{BASE}{href}")
    body = pg.inner_text("body")
    check("Payment voucher prints with amount in words (EN + AR)", r.status == 200 and "Payment Voucher" in body and "Three thousand Egyptian pounds only" in body and "فقط ثلاثة آلاف جنيه مصري لا غير" in body, body[:300])
    if SHOTS:
        pg.screenshot(path=f"{SHOTS}/print_voucher.png", full_page=True)
    pg.close()

    # statement
    cm.goto(f"{BASE}/admin/finance/cash/{box}")
    st = cm.inner_text("main")
    check("Box statement shows running balance", "Statement" in st and "5,500.00 EGP" in st, st[:300])
    pg = cm.context.new_page(); r = pg.goto(f"{BASE}/admin/print/finance/statement/{box}")
    check("Statement prints", r.status == 200 and "Cash Statement" in pg.inner_text("body"))
    if SHOTS: pg.screenshot(path=f"{SHOTS}/print_statement.png", full_page=True)
    pg.close()

    # person accounts
    cm.goto(f"{BASE}/admin/finance/people")
    prow = cm.locator("tr", has_text=f"Ahmed courier {stamp}")
    check("Person account: took 3,000, returned 500, net 2,500", "3,000.00 EGP" in prow.inner_text() and "500.00 EGP" in prow.inner_text() and "2,500.00 EGP" in prow.inner_text(), prow.inner_text())
    prow.get_by_role("link", name="Details").click()
    cm.wait_for_url(re.compile(r"p="))
    shot(cm, "fin_people")
    pg = cm.context.new_page(); r = pg.goto(cm.url.replace("/admin/finance/people", "/admin/print/finance/people"))
    check("Person account prints", r.status == 200 and "Person Account" in pg.inner_text("body") and f"Ahmed courier {stamp}" in pg.inner_text("body"))
    pg.close()

    # void the cash payment voucher
    cm.goto(f"{BASE}/admin/finance/cash")
    row = cm.locator("tr", has=cm.locator("td.mono", has_text=vno))
    row.locator("summary", has_text="Void").click()
    row.locator("input[name=reason]").fill("Entered twice")
    row.locator(".inline-form").get_by_role("button", name="Void").click()
    cm.locator("tr", has=cm.locator("td.mono", has_text=vno)).locator(".pill", has_text="void").wait_for(timeout=15000)
    cm.goto(f"{BASE}/admin/finance/cash/{box}")
    check("Voided voucher restores the balance (8,500)", "8,500.00 EGP" in cm.inner_text(".stats"), cm.inner_text(".stats"))

    # agent sees revised invoice, not finance data
    a1.goto(case_url)
    check("Agent sees the revised invoice total", "23,000.00" in a1.inner_text("main") and inv_no in a1.inner_text("main"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
