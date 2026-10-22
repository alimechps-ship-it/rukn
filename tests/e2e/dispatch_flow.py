"""
End-to-end test of the case-manager / finance separation:
case manager prepares a dispatch order (services + quantities, no prices) → sends it to finance →
finance prices it into an invoice and issues it. The case manager never sees prices or money.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… \
  FINANCE_EMAIL=… FINANCE_PASSWORD=… python tests/e2e/dispatch_flow.py
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


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]

    # ---- agent case ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Dispatch Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Hany Saleh")
    a1.select_option("select[name=country_code]", "SA")
    a1.fill("input[name=patient_ref]", f"DO-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]

    # ---- case manager: menu and case page carry no money ----
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    nav = cm.inner_text("aside")
    check("Case manager menu has no finance section", "Finance" not in nav and "Cash boxes" not in nav and "Receivables" not in nav and "Partner bills" not in nav, nav[:300])
    for path in ["/admin/finance/cash", "/admin/finance/receivables", "/admin/finance/to-price", "/admin/price-list", "/admin/statement", "/admin/partner-bills"]:
        cm.goto(f"{BASE}{path}")
        check(f"Case manager cannot open {path}", "denied" in cm.url or path not in cm.url, cm.url)
    cm.goto(case_url)
    main = cm.inner_text("main")
    check("Case page has no invoices / payments panels for the case manager", cm.get_by_role("button", name="+ New invoice").count() == 0 and "Record a payment" not in main and "Quotation" not in main)

    # ---- case manager prepares the dispatch order ----
    cm.get_by_role("button", name="+ New dispatch order").click()
    cm.wait_for_url(re.compile(r"/dispatch/[0-9a-f-]{36}"), timeout=20000)
    do_url = cm.url.split("#")[0]
    do_no = re.search(r"DO-\d{2}-\d{5}", cm.inner_text("h1"))
    check("Dispatch order gets a DO- number", do_no is not None, cm.inner_text("h1"))
    do_no = do_no.group(0) if do_no else "?"
    opts = cm.locator("#do-pick option").all_inner_texts()
    check("Service list shows no prices", len(opts) > 1 and not any("$" in o or "USD" in o for o in opts), str(opts[:4]))
    for label in ["ALN-FULL", "RET-SET"]:
        val = cm.locator("#do-pick option", has_text=label).first.get_attribute("value")
        cm.select_option("#do-pick", val)
    rows = cm.locator("table.inv-lines tbody tr")
    rows.nth(0).locator("select[aria-label=Arch]").select_option("both")
    rows.nth(1).locator("input[aria-label=Quantity]").fill("2")
    cm.fill("#do-notes", "Upper and lower, 2 retainer sets")
    cm.get_by_role("button", name="Save draft · حفظ").click()
    ok(cm, "Draft saved")
    cm.goto(do_url)
    check("Draft keeps its services", cm.locator("table.inv-lines tbody tr").count() == 2)
    cm.get_by_role("button", name="Send to finance · إرسال للمالية").click()
    cm.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}\?sent=dispatch"), timeout=20000)
    cm.wait_for_load_state("networkidle")
    check("Order shows as sent to finance on the case", "Sent to finance" in cm.inner_text("#dispatch"))
    pg = cm.context.new_page()
    r = pg.goto(do_url.replace(re.search(r"/admin/cases/.*", do_url).group(0), "") + "/admin/print/dispatch/" + do_url.rsplit("/", 1)[1])
    body = pg.inner_text("body")
    check("Printed dispatch order: services and quantities, no prices", r.status == 200 and "Dispatch Order" in body and do_no in body and "Total quantity" in body and "$" not in body, body[:300])
    if SHOTS: pg.screenshot(path=f"{SHOTS}/print_dispatch.png", full_page=True)
    pg.close()

    # ---- finance prices it ----
    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    nav = fin.inner_text("aside")
    check("Finance menu has the 'To price' queue with a badge", "To price" in nav and fin.locator("aside a:has-text('To price') .badge-count").count() == 1, nav[:300])
    fin.goto(f"{BASE}/admin/finance/to-price")
    row = fin.locator("tr", has_text=do_no)
    check("Dispatch order waits in the finance queue with its quantities", row.count() == 1 and "× 2" in row.inner_text(), row.inner_text() if row.count() else "")
    if SHOTS: fin.screenshot(path=f"{SHOTS}/finance_to_price.png", full_page=True)
    row.get_by_role("button", name="Price & invoice →").click()
    fin.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    inv_url = fin.url.split("?")[0]
    check("Draft invoice created with prices from the price list", "Draft invoice" in fin.inner_text("h1") and fin.locator("table.inv-lines tbody tr").count() == 2)
    totals = fin.inner_text(".inv-totals")
    check("Invoice total = 1200 + 2 × 90 = 1380", "1,380.00" in totals, totals)
    fin.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    fin.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    inv_no = re.search(r"INV-\d{2}-\d{5}", fin.inner_text("h1"))
    check("Finance issues the invoice", inv_no is not None)
    fin.goto(f"{BASE}/admin/finance/to-price")
    check("Queue is cleared after pricing", fin.locator("tr", has_text=do_no).count() <= 1 and "Recently priced" in fin.inner_text("main"))

    # ---- case manager sees the status only ----
    cm.goto(case_url)
    disp = cm.inner_text("#dispatch")
    check("Case manager sees the order as priced & invoiced", "Priced & invoiced" in disp)
    main = cm.inner_text("main")
    check("…but never the invoice amount", "1,380" not in main and (inv_no.group(0) if inv_no else "INV-") not in main)
    r = cm.goto(inv_url)
    check("Case manager cannot open the invoice", "denied" in cm.url or (r and r.status in (403, 404)))

    # ---- agent sees the issued invoice as before ----
    a1.goto(case_url)
    check("Agent sees the issued invoice", inv_no is not None and inv_no.group(0) in a1.inner_text("main"))
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
