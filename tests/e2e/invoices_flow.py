"""
End-to-end test of case invoices.
Case manager sets prices → agent submits a case → case manager creates an invoice
from the price list (aligners, Snap-On, retainer), saves a draft (agent cannot see it),
issues it, records a payment against it → agent sees and prints the invoice →
void + replacement flow.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… AGENT2_EMAIL=… AGENT2_PASSWORD=… \
  CASEMGR_EMAIL=… CASEMGR_PASSWORD=… python tests/e2e/invoices_flow.py
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


def flash(page, text, timeout=20000):
    page.wait_for_selector(f".flash.ok:has-text('{text}')", timeout=timeout)
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-4:]

    # ---- Case manager sets prices ----
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    cm.goto(f"{BASE}/admin/price-list")
    check("Price list is in the case-manager menu", "Price list & billing" in cm.inner_text("aside"))
    for code, price in [("ALN-FULL", "1200"), ("SNAP-U", "350"), ("RET-SET", "90")]:
        row = cm.locator("tr", has=cm.locator("td.mono", has_text=re.compile(f"^{code}$")))
        row.locator("summary", has_text="Edit").click()
        row.locator("input[name=unit_price]").fill(price)
        row.get_by_role("button", name="Save item").click()
        cm.locator("tr", has=cm.locator("td.mono", has_text=re.compile(f"^{code}$"))).locator("td.num", has_text=f"{int(price):,}.00").wait_for(timeout=15000)
    cm.reload()
    check("Prices saved in the price list", "$1,200.00" in cm.inner_text("main") and "$350.00" in cm.inner_text("main"))
    cm.fill("#b-bank", "Bank: Test Bank Egypt\nAccount: RUKN Dental\nIBAN: EG00 0000 0000 0000 0000 0000 000")
    cm.get_by_role("button", name="Save billing details").click()
    flash(cm, "Billing details saved")

    # ---- Agent submits a case ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Berlin Smile Studio {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Anna Weber")
    a1.select_option("select[name=country_code]", "DE")
    a1.fill("input[name=city]", "Berlin")
    a1.fill("input[name=patient_ref]", f"INV-T-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    check("Agent sees no invoice before RUKN issues one", "No invoice issued yet" in a1.inner_text("main"))

    # ---- Case manager builds the invoice ----
    cm.goto(case_url)
    cm.get_by_role("button", name="+ New invoice").click()
    cm.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    inv_url = cm.url.split("?")[0]
    check("New invoice opens as a draft pre-filled with the clinic", "Draft invoice" in cm.inner_text("h1") and "Berlin Smile Studio" in cm.input_value("#inv-bill"))
    for label in ["ALN-FULL", "SNAP-U", "RET-SET"]:
        opt = cm.locator("#inv-pick option", has_text=label).first.get_attribute("value")
        cm.select_option("#inv-pick", opt)
    rows = cm.locator("table.inv-lines tbody tr")
    check("Three items added from the price list", rows.count() == 3, str(rows.count()))
    rows.nth(0).locator("select[aria-label=Arch]").select_option("both")
    rows.nth(1).locator("select[aria-label=Arch]").select_option("upper")
    rows.nth(2).locator("input[aria-label=Quantity]").fill("2")
    cm.fill("#inv-disc", "100")
    totals = cm.inner_text(".inv-totals")
    # 1200 + 350 + 2×90 = 1730 − 100 = 1630
    check("Live totals: subtotal, discount and total", "$1,730.00" in totals and "$1,630.00" in totals, totals)
    cm.get_by_role("button", name="Save draft · حفظ كمسودة").click()
    flash(cm, "Draft saved")

    a1.goto(case_url)
    check("Agent cannot see the draft invoice", "No invoice issued yet" in a1.inner_text("main"))

    cm.goto(inv_url)
    check("Draft keeps its lines after saving", cm.locator("table.inv-lines tbody tr").count() == 3)
    cm.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    cm.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    h1 = cm.inner_text("h1")
    inv_no = re.search(r"INV-\d{2}-\d{5}", h1)
    check("Issued invoice gets a number (and stays editable as revisions)", inv_no is not None and "Issued" in h1 and "editing an issued invoice" in cm.inner_text("main"), h1)
    inv_no = inv_no.group(0) if inv_no else "?"
    check("Issued invoice shows the balance due", "$1,630.00" in cm.inner_text("main"))

    # ---- Payment applied to the invoice ----
    cm.goto(case_url)
    main = cm.inner_text("main")
    check("Case price follows the issued invoice", "$1,630.00" in main)
    cm.locator("summary", has_text="Record a payment").click()
    check("Payment form proposes the open invoice", inv_no in cm.locator("select[name=invoice_id]").inner_text())
    cm.fill("input[name=amount]", "630")
    cm.locator("form:has(input[name=amount])").get_by_role("button", name="Record payment").click()
    flash(cm, "receipt RC-")
    cm.reload()
    check("Invoice balance drops after the payment", "$1,000.00" in cm.inner_text("main"))
    if SHOTS:
        cm.screenshot(path=f"{SHOTS}/inv_case_panel.png", full_page=True)

    # ---- Agent sees and prints ----
    a1.goto(case_url)
    check("Agent now sees the issued invoice", inv_no in a1.inner_text("main"))
    pg = a1.context.new_page()
    inv_id = inv_url.rsplit("/", 1)[1]
    r = pg.goto(f"{BASE}/admin/print/invoice/{inv_id}")
    body = pg.inner_text("body")
    check("Agent can print the invoice", r.status == 200 and inv_no in body and "Invoice" in body)
    check("Printed invoice: lines, discount, total, paid, balance, bank details",
          all(x in body for x in ["Clear aligners — comprehensive treatment", "Snap-On smile — upper arch", "− $100.00", "$1,630.00", "$630.00", "$1,000.00", "IBAN"]), body[:400])
    if SHOTS:
        pg.emulate_media(media="print"); pg.pdf(path=f"{SHOTS}/print_invoice.pdf", format="A4", print_background=True)
        pg.emulate_media(media="screen"); pg.screenshot(path=f"{SHOTS}/print_invoice.png", full_page=True)
    pg.close()
    r = a1.goto(f"{BASE}/admin/price-list")
    check("Agent cannot open the price list", "/admin/price-list" not in a1.url or r.status in (403, 404) or "denied" in a1.url)

    # ---- Other agent cannot see it ----
    a2 = b.new_context().new_page()
    login(a2, E["AGENT2_EMAIL"], E["AGENT2_PASSWORD"])
    r = a2.goto(f"{BASE}/admin/print/invoice/{inv_id}")
    check("Another agent cannot print this invoice", r.status == 404)

    # ---- Receipt shows the invoice ----
    cm.goto(case_url)
    pay_link = cm.locator("a[href*='/receipt?p=']").first.get_attribute("href")
    pg = cm.context.new_page(); pg.goto(f"{BASE}{pay_link}")
    check("Payment receipt references the invoice and its balance", inv_no in pg.inner_text("body") and "$1,000.00" in pg.inner_text("body"))
    pg.close()

    # ---- Void ----
    cm.goto(inv_url)
    cm.fill("#void-reason", "Retainer quantity corrected")
    cm.get_by_role("button", name="Void invoice").click()
    cm.wait_for_selector(".flash.err:has-text('This invoice was voided')", timeout=20000)
    cm.reload()
    check("Voided invoice is kept with its number", "Void" in cm.inner_text("h1") and inv_no in cm.inner_text("h1"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
