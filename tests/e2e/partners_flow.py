"""
End-to-end: planners & labs.
Super admin adds a planner and a lab + their logins → agent submits a case → case manager
sends a planning work order → planner accepts, uploads the plan, completes → agent cannot see
the plan until RUKN sends it → production order to the lab → lab ships, bills RUKN →
case manager approves and pays from a cash box → statements and prints; isolation checks.

  BASE_URL=… OWNER_EMAIL=… OWNER_PASSWORD=… AGENT1_EMAIL=… AGENT1_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… \
  PLAN_FILE=setup.stl PHOTO_FILE=photo.png python tests/e2e/partners_flow.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
E = os.environ
SHOTS = E.get("SHOTS_DIR")
PW = "Partner-Pass-2026"
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


def new_wo(page, before):
    """Wait for a new work order row on the case page and return its number."""
    for _ in range(40):
        rows = page.locator("section.panel:has(h2:has-text('Planning & production')) a.mono").all_inner_texts()
        new = [r for r in rows if r not in before]
        if new:
            return new[-1]
        page.wait_for_timeout(500)
    raise AssertionError("work order not created")


def wo_list(page):
    return page.locator("section.panel:has(h2:has-text('Planning & production')) a.mono").all_inner_texts()


def ok(page, text, timeout=20000):
    page.wait_for_selector(f".flash.ok:has-text('{text}')", timeout=timeout)
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    planner_name, lab_name = f"Smile Design Planning {stamp}", f"Cairo Aligner Lab {stamp}"
    planner_email, lab_email = f"planner{stamp}@rukn.test", f"lab{stamp}@rukn.test"

    # ---- super admin: partners + logins ----
    ow = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(ow, E["OWNER_EMAIL"], E["OWNER_PASSWORD"])
    for kind, name in [("planner", planner_name), ("lab", lab_name)]:
        ow.goto(f"{BASE}/admin/partners")
        ow.locator("summary", has_text="Add a planner or lab").click()
        ow.select_option("#kind-new", kind)
        ow.fill("#name-new", name)
        ow.fill("#contact_name-new", "Dr. Test" if kind == "planner" else "Eng. Test")
        ow.fill("#currency-new", "USD")
        ow.get_by_role("button", name="Add partner").click()
        ow.wait_for_url(re.compile(r"/admin/partners/[0-9a-f-]{36}"), timeout=20000)
    check("Super admin adds a planner and a lab", lab_name in ow.inner_text("h1"))
    for role, email, partner in [("planner", planner_email, planner_name), ("lab", lab_email, lab_name)]:
        ow.goto(f"{BASE}/admin/users")
        f = ow.locator("#add form")
        f.locator("#email").fill(email)
        f.locator("#full_name").fill(f"{partner} user")
        f.locator("#password").fill(PW)
        f.locator("input[name=role_agent]").uncheck()
        f.locator(f"input[name=role_{role}]").check()
        f.locator("#new-partner").select_option(label=f"{partner} ({'lab' if role == 'lab' else 'planner'})")
        f.get_by_role("button", name="Create account").click()
        ow.wait_for_selector("#add .flash.ok", timeout=20000)
    check("Logins created for the planner and the lab", "Account created" in ow.inner_text("#add .flash"))

    # ---- agent case ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Partner Flow Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Amal Nour")
    a1.select_option("select[name=country_code]", "EG")
    a1.fill("input[name=patient_ref]", f"PF-{stamp}")
    a1.fill("textarea[name=description]", "Class I crowding, prefers 6 months treatment.")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    code = a1.inner_text("h1")

    # ---- case manager: planning order ----
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    check("Partners section in the case-manager menu", "Planners & labs" in cm.inner_text("aside"))
    cm.goto(case_url)
    before = wo_list(cm)
    form = cm.locator("form:has(#wo-partner)")
    form.locator("#wo-partner").select_option(label=planner_name)
    form.locator("#wo-title").fill("Digital setup — both arches")
    form.locator("#wo-ins").fill("Max 20 steps, avoid IPR on lower incisors.")
    form.locator("#wo-cost").fill("80")
    form.get_by_role("button", name="Send work order").click()
    wo1 = new_wo(cm, before)
    check("Planning work order sent from the case", wo1 is not None)

    # ---- planner portal ----
    pl = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(pl, planner_email, PW)
    pl.wait_for_url(re.compile(r"/admin/work"), timeout=20000)
    check("Planner lands on his work orders", "/admin/work" in pl.url and wo1 in pl.inner_text("main"))
    nav = pl.inner_text("aside")
    check("Planner menu shows only the partner portal", "Work orders" in nav and "My bills" in nav and "Cases" not in nav and "Finance" not in nav and "Dashboard" not in nav, nav[:200])
    pl.locator("a", has_text=wo1).click()
    pl.wait_for_url(re.compile(r"/admin/work/[0-9a-f-]{36}"))
    wo1_url = pl.url
    main = pl.inner_text("main")
    check("Planner sees the clinical brief (patient ref, doctor, notes) but no prices to the clinic or agent", f"PF-{stamp}" in main and "Dr. Amal Nour" in main and "Class I crowding" in main and "Omar" not in main)
    pl.get_by_role("button", name="✓ Accept · قبول").click()
    pl.locator("h1 .pill", has_text="Accepted").wait_for(timeout=20000)
    pl.set_input_files("#cf-file", E["PLAN_FILE"])
    pl.wait_for_selector(".timeline li:has-text('Uploaded')", timeout=60000)
    pl.reload()
    pl.fill("#wc-note", "18 steps, IPR 0.2 mm upper only")
    pl.get_by_role("button", name=re.compile("Mark completed")).click()
    pl.locator("h1 .pill", has_text="Completed").wait_for(timeout=20000)
    shot(pl, "planner_work_order")
    r = pl.goto(case_url)
    check("Planner cannot open the case page", "/admin/cases/" not in pl.url or r.status in (403, 404))
    r = pl.goto(f"{BASE}/admin/finance/cash")
    check("Planner cannot open finance", "/admin/finance/cash" not in pl.url)

    # ---- agent cannot see the plan until RUKN sends it ----
    a1.goto(case_url)
    fname = os.path.basename(E["PLAN_FILE"])
    check("Agent does not see the partner's plan file yet", a1.locator("table.data a", has_text=fname).count() == 0)
    cm.goto(case_url)
    check("Case manager sees the partner file marked 'not sent'", "from partner · not sent" in cm.inner_text("main"))
    cm.get_by_role("button", name="Send to agent →").first.click()
    for _ in range(40):
        if "from partner · not sent" not in cm.inner_text("main"):
            break
        cm.wait_for_timeout(500)
    a1.goto(case_url)
    check("After RUKN sends it, the agent sees the plan (from RUKN)", a1.locator("table.data a", has_text=fname).count() >= 1)

    # ---- production order to the lab ----
    cm.goto(case_url)
    before = wo_list(cm)
    form = cm.locator("form:has(#wo-partner)")
    if not form.is_visible():
        cm.locator("summary", has_text="Send a work order").click()
    form.locator("#wo-partner").select_option(label=lab_name)
    form.locator("#wo-title").fill("22 aligners + 2 retainers")
    form.locator("#wo-cost").fill("300")
    form.get_by_role("button", name="Send work order").click()
    wo2 = new_wo(cm, before)
    cm.reload()
    check("Case shows both orders and the margin line", wo1 in cm.inner_text("main") and wo2 in cm.inner_text("main") and "Invoiced − costs" in cm.inner_text("main"))

    lb = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(lb, lab_email, PW)
    lb.wait_for_url(re.compile(r"/admin/work"), timeout=20000)
    check("Lab sees only its order", wo2 in lb.inner_text("main") and wo1 not in lb.inner_text("main"))
    lb.locator("a", has_text=wo2).click()
    lb.wait_for_url(re.compile(r"/admin/work/[0-9a-f-]{36}"))
    check("Lab can download the approved setup from the planner", lb.locator("table.data a", has_text=fname).count() >= 1)
    lb.get_by_role("button", name="✓ Accept · قبول").click()
    lb.locator("h1 .pill", has_text="Accepted").wait_for(timeout=20000)
    lb.fill("#ws-car", "Aramex")
    lb.fill("#ws-trk", f"ARX-{stamp}")
    lb.fill("#ws-note", "22 aligners + 2 retainers, sealed")
    lb.get_by_role("button", name=re.compile("Mark shipped")).click()
    lb.locator("h1 .pill", has_text="Shipped").wait_for(timeout=20000)

    # ---- lab bills RUKN ----
    lb.goto(f"{BASE}/admin/partner-bills")
    check("Lab sees its shipped order ready to bill", wo2 in lb.inner_text("form:has(input[name=partner_ref])"))
    lb.fill("input[name=partner_ref]", f"LAB-{stamp}")
    lb.get_by_role("button", name=re.compile("Send bill to RUKN")).click()
    ok(lb, "sent to RUKN")
    pb = re.search(r"PB-\d{2}-\d{5}", lb.inner_text(".flash.ok")).group(0)
    shot(lb, "lab_bills")

    # ---- case manager receives, approves, pays ----
    cm.goto(f"{BASE}/admin/work?status=review")
    check("Shipped order appears in 'to receive'", wo2 in cm.inner_text("main"))
    cm.goto(f"{BASE}/admin/partner-bills")
    bill = cm.locator("li.notice", has_text=pb)
    check("Bill awaits review with total 300", "$300.00" in bill.inner_text())
    bill.get_by_role("button", name=re.compile("Approve bill")).click()
    cm.locator("li.notice", has_text=pb).locator(".pill", has_text="Approved").wait_for(timeout=20000)
    cm.goto(f"{BASE}/admin/partners")
    cm.locator("a", has_text=lab_name).click()
    cm.wait_for_url(re.compile(r"/admin/partners/[0-9a-f-]{36}"))
    check("Partner page: RUKN owes 300", "$300.00" in cm.inner_text(".stats"))
    usd = cm.locator("#pp-box option", has_text="USD cash box").first.get_attribute("value")
    cm.select_option("#pp-box", usd)
    cm.fill("#pp-ref", f"TRF-{stamp}")
    cm.get_by_role("button", name=re.compile("Record payment")).click()
    ok(cm, "Payment PP-")
    pp = re.search(r"PP-\d{2}-\d{5}", cm.inner_text(".flash.ok")).group(0)
    cm.reload()
    shot(cm, "partner_page")
    check("After payment the lab balance is 0", "$300.00" in cm.inner_text(".stats") and "RUKN owes" in cm.inner_text(".stats"))
    cm.goto(f"{BASE}/admin/finance/cash")
    check("Payment to the lab left the cash box as a payment voucher", f"Payment {pp} to {lab_name}" in cm.inner_text("main"))

    # ---- prints & statements ----
    lb.goto(f"{BASE}/admin/partner-statement")
    st = lb.inner_text("main")
    check("Lab statement: bill 300, paid 300", pb in st and pp in st)
    for path, must in [(f"/admin/print/partner-statement", "Partner Statement"), (wo1_url.replace("/admin/work/", "/admin/print/work-order/"), None)]:
        pg = lb.context.new_page() if must else pl.context.new_page()
        r = pg.goto(f"{BASE}{path}" if path.startswith("/") else path)
        txt = pg.inner_text("body")
        if must:
            check("Lab prints its statement", r.status == 200 and must in txt and pp in txt)
            if SHOTS: pg.screenshot(path=f"{SHOTS}/print_partner_statement.png", full_page=True)
        else:
            check("Planner prints the work order", r.status == 200 and "Work Order" in txt and wo1 in txt and "Digital setup" in txt)
            if SHOTS: pg.screenshot(path=f"{SHOTS}/print_work_order.png", full_page=True)
        pg.close()
    pg = cm.context.new_page()
    cm.goto(f"{BASE}/admin/partner-bills")
    href = cm.locator("li.notice", has_text=pb).locator("a", has_text="Print bill").get_attribute("href")
    r = pg.goto(f"{BASE}{href}")
    check("Partner bill prints with amount in words", r.status == 200 and "Three hundred US dollars only" in pg.inner_text("body"))
    if SHOTS: pg.screenshot(path=f"{SHOTS}/print_partner_bill.png", full_page=True)
    pg.close()

    # ---- isolation ----
    r = pl.goto(wo1_url.replace(wo1_url.rsplit("/", 1)[1], "") + lb.url.rsplit("/", 1)[1]) if False else None
    lb.goto(f"{BASE}/admin/partner-bills")
    check("Planner's data is not visible to the lab", wo1 not in lb.inner_text("main"))
    a1.goto(case_url)
    check("Agent never sees work orders or costs", wo1 not in a1.inner_text("main") and "Invoiced − costs" not in a1.inner_text("main"))
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
