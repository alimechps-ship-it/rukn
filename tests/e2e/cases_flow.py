"""
End-to-end test of the agents portal / case workflow.
Agent submits a case and uploads a scan → case manager registers intake, quotes,
uploads the plan, asks for approval → agent approves → payment, shipping, delivery
→ all printable documents render → agent 2 cannot open agent 1's case.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… AGENT2_EMAIL=… AGENT2_PASSWORD=… \
  CASEMGR_EMAIL=… CASEMGR_PASSWORD=… SCAN_FILE=path/to/file.stl python tests/e2e/cases_flow.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
E = os.environ
SHOTS = os.environ.get("SHOTS_DIR")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))


def login(page, email, pw):
    page.goto(f"{BASE}/admin/login")
    page.fill("#email", email)
    page.fill("#password", pw)
    page.click("button[type=submit]")
    page.wait_for_load_state("networkidle")


def submit(page, form_sel, button_text, expect_text, timeout=20000):
    page.locator(form_sel).get_by_role("button", name=button_text).first.click()
    page.wait_for_selector(f".flash.ok:has-text('{expect_text}')", timeout=timeout)
    page.wait_for_load_state("networkidle")


def shot(page, name):
    if SHOTS:
        page.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-4:]

    # ---------------- Agent 1 submits ----------------
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    check("Agent lands on his cases (no back-office dashboard)", "/admin/cases" in a1.url)
    nav = a1.inner_text("aside")
    check("Agent menu shows only the portal", "My cases" in nav and "Pages" not in nav and "Inquiries" not in nav and "Users" not in nav, nav[:200])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=2)
    a1.fill("input[name=clinic_name]", f"Amman Smile Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Rania Khalil")
    a1.select_option("select[name=country_code]", "JO")
    a1.fill("input[name=city]", "Amman")
    a1.fill("input[name=patient_ref]", f"RK-{stamp}")
    a1.fill("input[name=patient_age]", "29")
    a1.select_option("select[name=arches]", "both")
    a1.fill("textarea[name=description]", "Mild crowding, upper and lower. Patient prefers aligners.")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    code = a1.inner_text("h1")
    check("Case created with an automatic code", re.match(r"^RK-JO-\d{2}-\d{5}$", code) is not None, code)
    a1.set_input_files("#cf-file", E["SCAN_FILE"])
    a1.wait_for_selector(".timeline li:has-text('Uploaded')", timeout=60000)
    a1.reload()
    check("Agent uploaded a scan into the private bucket", a1.locator("table.data a", has_text=".stl").count() >= 1)
    dl = a1.request.get(BASE + a1.locator("table.data a", has_text=".stl").first.get_attribute("href"), max_redirects=0)
    check("File download uses a short-lived signed link", dl.status in (302, 307) and "token=" in (dl.headers.get("location") or ""))
    a1.fill("#body", "Records sent via courier as well.")
    a1.get_by_role("button", name="Add", exact=True).click()
    a1.wait_for_selector(".flash.ok", timeout=15000)
    shot(a1, "case_agent_submitted")

    # ---------------- Agent 2 cannot see it ----------------
    a2 = b.new_context().new_page()
    login(a2, E["AGENT2_EMAIL"], E["AGENT2_PASSWORD"])
    a2.goto(f"{BASE}/admin/cases")
    check("Agent 2 does not see agent 1's case in the list", code not in a2.inner_text("main"))
    r = a2.goto(case_url)
    check("Agent 2 gets 404 on agent 1's case URL", r.status == 404)
    r = a2.goto(case_url.replace("/admin/cases/", "/admin/print/case/") + "/file")
    check("Agent 2 cannot print agent 1's case file", r.status == 404)

    # ---------------- Case manager processes ----------------
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    cm.goto(case_url)
    check("Case manager sees the agent's internal-free timeline and file", cm.locator("table.data a", has_text=".stl").count() >= 1)
    submit(cm, "form:has(input[name=received_at])", "Save intake", "intake saved")
    check("Records intake numbered", re.search(r"RR-\d{2}-\d{5}", cm.inner_text("main")) is not None)
    check("Case manager sees no quotation or payment forms (finance only)", cm.locator("summary", has_text="Set quotation").count() == 0 and cm.locator("summary", has_text="Record a payment").count() == 0)
    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    fin.goto(case_url)
    fin.locator("summary", has_text="Set quotation").click()
    fin.fill("input[name=quote_amount]", "450")
    fin.fill("input[name=quote_currency]", "USD")
    submit(fin, "form:has(input[name=quote_amount])", "Save quotation", "Quotation saved")
    cm.set_input_files("#cf-file", E["SCAN_FILE"])
    cm.wait_for_selector(".timeline li:has-text('Uploaded')", timeout=60000)
    cm.select_option("select[name=status]", "awaiting_approval")
    cm.fill("textarea[name=comment]", "Plan ready for the doctor's review.")
    submit(cm, "form:has(select[name=status])", "Update status", "Status updated")
    cm.fill("#body", "Internal: check bite on stage 4")
    cm.select_option("form:has(#body) select[name=visibility]", "internal")
    cm.get_by_role("button", name="Add", exact=True).click()
    cm.wait_for_selector(".flash.ok:has-text('Internal note')", timeout=15000)

    # ---------------- Agent records doctor's approval ----------------
    a1.goto(case_url)
    check("Agent does not see internal notes", "check bite on stage 4" not in a1.inner_text("main"))
    check("Agent sees the deliverable plan from RUKN", a1.locator(".pill", has_text="from RUKN").count() >= 1)
    a1.fill("input[name=doctor]", "Dr. Rania Khalil")
    a1.locator("form:has(input[name=doctor])").get_by_role("button", name="✓ Approve plan").click()
    a1.wait_for_selector(".flash.ok:has-text('approval recorded')", timeout=15000)
    a1.reload()
    check("Plan approved by the treating doctor", "Plan approved" in a1.inner_text("main"))
    r = a1.goto(case_url)  # agent cannot edit anymore
    check("Agent can no longer edit case details", a1.locator("button", has_text="Save details").count() == 0)

    # ---------------- Payment, production, shipping, delivery ----------------
    fin.goto(case_url)
    fin.locator("summary", has_text="Record a payment").click()
    fin.fill("input[name=amount]", "200")
    submit(fin, "form:has(input[name=amount])", "Record payment", "receipt RC-")
    cm.goto(case_url)
    check("Case manager does not see the price or the receipt", "$450.00" not in cm.inner_text("main") and cm.locator("a[href*='/receipt?p=']").count() == 0)
    for st in ["production", "quality_check"]:
        cm.select_option("select[name=status]", st)
        submit(cm, "form:has(select[name=status])", "Update status", "Status updated")
    cm.locator("summary", has_text="Shipment").click()
    cm.fill("input[name=carrier]", "DHL Express")
    cm.fill("input[name=tracking_no]", "JD0146000012345")
    submit(cm, "form:has(input[name=carrier])", "Save shipment", "Shipment saved")
    cm.locator("summary", has_text="Confirm delivery").click()
    cm.fill("input[name=received_by_name]", "Dr. Rania Khalil")
    submit(cm, "form:has(input[name=received_by_name])", "Confirm delivery", "Delivery recorded")
    cm.reload(); main = cm.inner_text("main")
    check("Delivery note numbered and case delivered", re.search(r"DN-\d{2}-\d{5}", main) is not None and "Delivered" in main)
    shot(cm, "case_manager_delivered")

    # ---------------- Prints ----------------
    cid = case_url.rsplit("/", 1)[1]
    for doc, must in [("file", "Case File"), ("intake", "Records Receipt"), ("delivery", "Delivery Note")]:
        pg = a1.context.new_page()
        r = pg.goto(f"{BASE}/admin/print/case/{cid}/{doc}")
        check(f"Agent can print the {must}", r.status == 200 and must in pg.inner_text("body"))
        if doc == "file":
            check("Agent's printed timeline names the RUKN case manager", "Mona Adel" in pg.inner_text("body"))
        if SHOTS:
            pg.emulate_media(media="print")
            pg.pdf(path=f"{SHOTS}/print_{doc}.pdf", format="A4", print_background=True)
            pg.emulate_media(media="screen")
            pg.screenshot(path=f"{SHOTS}/print_{doc}.png", full_page=True)
        pg.close()
    fin.goto(case_url)
    pay_link = fin.locator("a[href*='/receipt?p=']").first.get_attribute("href")
    r = cm.context.new_page().goto(f"{BASE}{pay_link}")
    check("Case manager cannot print a payment receipt", "denied" in (r.url if r else "") or (r and r.status in (403, 404)))
    pg = a1.context.new_page()
    r = pg.goto(f"{BASE}{pay_link}")
    check("Agent can print the payment receipt", r.status == 200 and "Payment Receipt" in pg.inner_text("body") and "$200.00" in pg.inner_text("body"))
    if SHOTS:
        pg.emulate_media(media="print"); pg.pdf(path=f"{SHOTS}/print_receipt.pdf", format="A4", print_background=True)
        pg.emulate_media(media="screen"); pg.screenshot(path=f"{SHOTS}/print_receipt.png", full_page=True)
    pg.close()

    # ---------------- Reports ----------------
    cm.goto(f"{BASE}/admin/reports")
    check("Case manager report lists the case", code in cm.inner_text("main"))
    csv = cm.request.get(f"{BASE}/admin/reports/export")
    check("Report CSV export works (no money columns for the case manager)", csv.status == 200 and code in csv.text() and "quoted" not in csv.text().splitlines()[0])
    csv = fin.request.get(f"{BASE}/admin/reports/export")
    check("Finance CSV export includes the quoted price", csv.status == 200 and "quoted" in csv.text().splitlines()[0] and "450" in csv.text())
    pg = cm.context.new_page()
    r = pg.goto(f"{BASE}/admin/print/report")
    check("Printable report renders", r.status == 200 and "Case Report" in pg.inner_text("body"))
    if SHOTS:
        pg.emulate_media(media="print"); pg.pdf(path=f"{SHOTS}/print_report.pdf", format="A4", print_background=True)
    pg.close()
    a2.goto(f"{BASE}/admin/reports")
    check("Agent 2's report does not include agent 1's case", code not in a2.inner_text("main"))
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
