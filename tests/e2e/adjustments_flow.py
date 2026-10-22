"""
End-to-end test of account adjustments: discount allowed on an invoice, extra charge,
discount earned from a lab, offset between an agent and a lab, credit note print, void.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… FINANCE_EMAIL=… FINANCE_PASSWORD=… python tests/e2e/adjustments_flow.py
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


def pick(page, input_id, text, option_text):
    page.fill(f"#{input_id}", text)
    page.locator(".picker-list li", has_text=option_text).first.click()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    lab = f"Delta Lab {stamp}"

    # ---- agent case + finance invoice 1000 USD ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Adjust Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Adjust")
    a1.select_option("select[name=country_code]", "EG")
    a1.fill("input[name=patient_ref]", f"AJ-{stamp}")
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
    check("Adjustments in the finance menu", "Adjustments" in fin.inner_text("aside"))

    # ---- discount allowed on the invoice ----
    fin.goto(f"{BASE}/admin/finance/adjustments")
    fin.select_option("#aj-kind", "discount_allowed")
    pick(fin, "aj-party", "omar", "Omar Haddad")
    check("Discount allowed shows its fixed effect in words", "Reduces what the agent owes" in fin.inner_text("form:has(#aj-kind)"))
    fin.select_option("#aj-doc", label=re.compile(inv_no) if False else fin.locator("#aj-doc option", has_text=inv_no).first.inner_text())
    fin.fill("#aj-amt", "100")
    fin.fill("#aj-desc", f"10% loyalty discount {stamp}")
    fin.get_by_role("button", name=re.compile("Record adjustment")).click()
    ok(fin, "Adjustment AJ-")
    aj1 = re.search(r"AJ-\d{2}-\d{5}", fin.inner_text(".flash.ok")).group(0)
    fin.goto(inv_url)
    check("Invoice balance drops by the discount (1000 → 900)", "balance due $900.00" in fin.inner_text(".flash.warn") and "adjustments −$100.00" in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))

    # ---- extra charge on the agent account ----
    fin.goto(f"{BASE}/admin/finance/adjustments")
    fin.select_option("#aj-kind", "extra_charge")
    pick(fin, "aj-party", "omar", "Omar Haddad")
    fin.fill("#aj-amt", "50")
    fin.fill("#aj-cur", "USD")
    fin.fill("#aj-desc", f"Extra retainer set {stamp}")
    fin.get_by_role("button", name=re.compile("Record adjustment")).click()
    ok(fin, "Adjustment AJ-")

    # ---- discount earned from the lab ----
    fin.select_option("#aj-kind", "discount_earned")
    pick(fin, "aj-party", f"delta {stamp}", lab)
    fin.fill("#aj-amt", "20")
    fin.fill("#aj-cur", "USD")
    fin.get_by_role("button", name=re.compile("Record adjustment")).click()
    ok(fin, "Discount earned")

    # ---- offset agent ↔ lab ----
    fin.get_by_role("button", name=re.compile("Offset between accounts")).click()
    pick(fin, "of-a", "omar", "Omar Haddad")
    pick(fin, "of-b", f"delta {stamp}", lab)
    fin.fill("#of-amt", "30")
    fin.fill("#of-cur", "USD")
    fin.fill("#of-curb", "USD")
    fin.fill("#of-desc", f"Set-off {stamp}")
    fin.get_by_role("button", name=re.compile("Record offset")).click()
    ok(fin, "Offset recorded")
    check("Offset makes two linked adjustments", len(re.findall(r"AJ-\d{2}-\d{5}", fin.inner_text(".flash.ok"))) == 2)
    if SHOTS: fin.screenshot(path=f"{SHOTS}/adjustments.png", full_page=True)

    fin.goto(f"{BASE}/admin/finance/adjustments?q={stamp}")
    check("Search finds the adjustments of this run", fin.locator("table.data tbody tr").count() >= 3)

    # ---- lab account: −20 discount, −30 offset ----
    fin.goto(partner_url)
    check("Lab account: RUKN owes −50 after discount earned 20 and set-off 30", "-$50.00" in fin.inner_text(".stats").replace("−", "-"), fin.inner_text(".stats"))

    # ---- agent sees it in his statement and prints the credit note ----
    a1.goto(f"{BASE}/admin/statement")
    st = a1.inner_text("main")
    check("Agent statement shows the discount, the extra charge and the set-off", aj1 in st and "Discount allowed" in st and "Extra charge" in st and "Offset" in st, st[:600])
    href = a1.locator("a", has_text=aj1).first.get_attribute("href")
    a1.goto(case_url)
    check("Agent sees the reduced invoice balance (900)", "$900.00" in a1.inner_text("main"))
    pg = a1.context.new_page()
    r = pg.goto(f"{BASE}{href}")
    body = pg.inner_text("body")
    check("Agent prints the credit note with the amount in words", r.status == 200 and "Credit Note" in body and "إشعار دائن" in body and "One hundred US dollars" in body, body[:400])
    pg.close()

    # ---- void the discount → balance back to 1000 ----
    fin.goto(f"{BASE}/admin/finance/adjustments?q={aj1}")
    row = fin.locator("tr", has_text=aj1)
    row.locator("summary", has_text="Void").click()
    row.locator("input[name=reason]").fill("Discount withdrawn")
    row.get_by_role("button", name="Void").click()
    fin.locator("tr", has_text=aj1).locator(".pill", has_text="void").wait_for(timeout=20000)  # the form leaves once voided
    fin.goto(inv_url)
    check("Voiding the discount restores the invoice balance (1000)", "balance due $1,000.00" in fin.inner_text(".flash.warn"), fin.inner_text(".flash.warn"))
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
