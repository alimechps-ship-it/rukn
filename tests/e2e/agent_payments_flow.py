"""
End-to-end: agent confirms plan & shipment receipt, sends payment notices with proof,
case manager confirms (receipt + cash box) or rejects, agent statement.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… AGENT2_EMAIL=… AGENT2_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… \
  PLAN_FILE=plan.pdf|stl PROOF_FILE=receipt.png python tests/e2e/agent_payments_flow.py
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


def shot(page, name):
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-4:]

    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    check("Agent menu has 'My account'", "My account" in a1.inner_text("aside"))
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Riyadh Ortho {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Khalid Saeed")
    a1.select_option("select[name=country_code]", "SA")
    a1.fill("input[name=patient_ref]", f"PAY-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]

    # ---- case manager: plan file, invoice, shipment ----
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    cm.goto(case_url)
    cm.set_input_files("#cf-file", E["PLAN_FILE"])
    cm.wait_for_selector(".timeline li:has-text('Uploaded')", timeout=60000)
    check("Case manager has no invoice button", cm.get_by_role("button", name="+ New invoice").count() == 0)
    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    fin.goto(case_url)
    fin.get_by_role("button", name="+ New invoice").click()
    fin.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    fin.select_option("#inv-currency", "USD")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Description (English)']").fill("Clear aligners — comprehensive treatment")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Unit price']").fill("1200")
    fin.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    fin.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    inv_no = re.search(r"INV-\d{2}-\d{5}", fin.inner_text("h1")).group(0)
    cm.goto(case_url)
    cm.locator("summary", has_text="Shipment").click()
    cm.fill("input[name=carrier]", "Aramex")
    cm.fill("input[name=tracking_no]", f"ARX{stamp}")
    cm.locator("form:has(input[name=carrier])").get_by_role("button", name="Save shipment").click()
    cm.wait_for_selector(".flash.ok:has-text('Shipment saved')", timeout=20000)

    # ---- agent confirms plan and shipment ----
    a1.goto(case_url)
    check("Agent is asked to confirm the plan and the shipment", "Treatment plan received?" in a1.inner_text("main") and "Did you receive the shipment?" in a1.inner_text("main"))
    shot(a1, "agent_confirm_boxes")
    a1.locator("form:has(input[name=what][value=plan])").get_by_role("button", name=re.compile("Confirm plan received")).click()
    a1.wait_for_selector(".flash.ok:has-text('Treatment plan received by')", timeout=20000)
    a1.goto(case_url)
    check("Plan receipt recorded", "Treatment plan received by Dr. Khalid Saeed" in a1.inner_text("main"))
    f = a1.locator("form:has(input[name=what][value=shipment])")
    f.locator("input[name=notes]").fill("Box sealed, 2 retainers inside")
    f.get_by_role("button", name=re.compile("Confirm receipt of shipment")).click()
    a1.wait_for_selector("a:has-text('Delivery note')", timeout=20000)
    a1.goto(case_url)
    msg = a1.inner_text("main")
    dn = re.search(r"DN-\d{2}-\d{5}", msg)
    check("Shipment confirmed by agent: case delivered + delivery note", dn is not None and "Delivered" in a1.inner_text(".topbar") and "Did you receive the shipment?" not in a1.inner_text("main"), msg)
    r = a1.goto(f"{BASE}/admin/print/case/{case_url.rsplit('/', 1)[1]}/delivery")
    check("Agent can print the delivery note with the receiver", r.status == 200 and "Dr. Khalid Saeed" in a1.inner_text("body"))
    a1.goto(case_url)

    # ---- agent sends a payment notice with proof ----
    ops = cm
    cm = fin  # from here on the finance manager handles the money
    form = a1.locator("details:has(summary:has-text('I sent a payment'))")
    if form.get_attribute("open") is None:
        form.locator("summary").click()
    check("Payment form proposes the invoice balance", form.locator("#pn-amt").input_value() in ("1200", "1200.0") and inv_no in form.locator("#pn-inv").inner_text())
    form.locator("#pn-amt").fill("500")
    form.locator("#pn-ref").fill(f"TRX-{stamp}")
    form.locator("#pn-proof").set_input_files(E["PROOF_FILE"])
    form.get_by_role("button", name=re.compile("Send payment notice")).click()
    a1.wait_for_selector(".flash.ok:has-text('Payment notice PN-')", timeout=60000)
    pn = re.search(r"PN-\d{2}-\d{5}", a1.inner_text(".flash.ok:has-text('Payment notice')")).group(0)
    a1.reload()
    check("Notice listed as awaiting confirmation with proof", pn in a1.inner_text("#payments") and "Awaiting confirmation" in a1.inner_text("#payments") and a1.locator("#payments a", has_text="Proof of payment").count() >= 1)
    shot(a1, "agent_payment_notice")
    a1.goto(f"{BASE}/admin/statement")
    st = a1.inner_text("main")
    check("Agent statement: balance 1,200 and 500 awaiting confirmation", "$1,200.00" in st and "$500.00" in st, st[:400])

    # ---- finance manager confirms (the case manager cannot) ----
    ops.goto(f"{BASE}/admin/finance/notices")
    check("Case manager cannot open payment notices", "denied" in ops.url or "/finance/notices" not in ops.url)
    ops.goto(case_url)
    check("Case manager does not see the payment notice on the case", pn not in ops.inner_text("main"))
    cm.goto(f"{BASE}/admin/finance/notices")
    check("Notice appears for the case manager (menu badge + list)", pn in cm.inner_text("main") and cm.locator("aside a:has-text('Payment notices') .badge-count").count() == 1)
    shot(cm, "cm_notices")
    proof = cm.locator("li.notice", has_text=pn).locator("a", has_text="Proof of payment").get_attribute("href")
    resp = cm.request.get(f"{BASE}{proof}", max_redirects=0)
    check("Case manager can open the proof (signed link)", resp.status in (302, 307))
    cm.goto(case_url)
    check("Case page warns about the pending notice", "awaiting your confirmation" in cm.inner_text("main"))
    notice = cm.locator("li.notice", has_text=pn)
    box_opt = notice.locator("select[name=cash_account_id] option", has_text="USD").first.get_attribute("value")
    notice.locator("select[name=cash_account_id]").select_option(box_opt)
    notice.get_by_role("button", name=re.compile("Confirm payment")).click()
    cm.locator("li.notice", has_text=pn).locator(".pill", has_text="Confirmed").wait_for(timeout=20000)
    check("Notice turns 'Confirmed' with its receipt for the case manager", re.search(r"Receipt RC-\d{2}-\d{5}", cm.locator("li.notice", has_text=pn).inner_text()) is not None)
    cm.goto(f"{BASE}/admin/finance/cash")
    check("Confirmed payment deposited in the USD cash box", f"TRX-{stamp}" in cm.inner_text("main") or "500.00 USD" in cm.inner_text("main"))

    # ---- agent sees confirmation; second notice rejected ----
    a1.goto(case_url)
    pay = a1.inner_text("#payments")
    check("Agent sees 'Confirmed' and the official receipt", "Confirmed" in pay and re.search(r"Receipt RC-\d{2}-\d{5}", pay) is not None, pay[:400])
    form = a1.locator("details:has(summary:has-text('I sent a payment'))")
    if form.get_attribute("open") is None:
        form.locator("summary").click()
    check("Balance after confirmation is 700", "700.00" in form.locator("#pn-inv").inner_text())
    form.locator("#pn-amt").fill("100")
    form.get_by_role("button", name=re.compile("Send payment notice")).click()
    a1.wait_for_selector(".flash.ok:has-text('Payment notice PN-')", timeout=60000)
    pn2 = re.search(r"PN-\d{2}-\d{5}", a1.inner_text(".flash.ok:has-text('Payment notice')")).group(0)
    cm.goto(case_url)
    n2 = cm.locator("li.notice", has_text=pn2)
    n2.locator("summary", has_text="Reject").click()
    n2.locator("input[name=reason]").fill("Amount not received on our account")
    n2.get_by_role("button", name="Reject notice").click()
    cm.locator("li.notice", has_text=pn2).locator(".pill", has_text="Not accepted").wait_for(timeout=20000)
    a1.goto(case_url)
    check("Agent sees the rejection reason", "Not accepted" in a1.inner_text("#payments") and "Amount not received on our account" in a1.inner_text("main"))

    a1.goto(f"{BASE}/admin/statement")
    st = a1.inner_text("main")
    row_inv = a1.locator("tr", has=a1.locator("td.mono", has_text=inv_no)).inner_text()
    row_pay = a1.locator("tr", has_text=f"Riyadh Ortho {stamp}").filter(has=a1.locator("td.mono a", has_text="RC-")).inner_text()
    check("Statement lists the invoice (debit 1,200) and the confirmed payment (credit 500)", "$1,200.00" in row_inv and "$500.00" in row_pay, row_inv + " | " + row_pay)
    pg = a1.context.new_page(); r = pg.goto(f"{BASE}/admin/print/statement")
    check("Agent prints his statement", r.status == 200 and "Account Statement" in pg.inner_text("body") and inv_no in pg.inner_text("body"))
    if SHOTS: pg.screenshot(path=f"{SHOTS}/print_agent_statement.png", full_page=True)
    pg.close()

    a2 = b.new_context().new_page()
    login(a2, E["AGENT2_EMAIL"], E["AGENT2_PASSWORD"])
    agent1_id = cm.locator("select#st-agent option", has_text="Omar").first.get_attribute("value") if False else None
    a2.goto(f"{BASE}/admin/statement")
    check("Agent 2's statement does not include agent 1's invoice", inv_no not in a2.inner_text("main"))
    cm.goto(f"{BASE}/admin/statement")
    check("Case manager sees all agents' balances", "Agent statements" in cm.inner_text("h1") and "Omar" in cm.inner_text("main"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
