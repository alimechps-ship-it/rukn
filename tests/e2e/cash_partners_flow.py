"""
End-to-end test: cash vouchers with labs and clinics (searchable party picker),
payments counted in the partner account, refunds from partners, voucher search.

  BASE_URL=… FINANCE_EMAIL=… FINANCE_PASSWORD=… python tests/e2e/cash_partners_flow.py
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


def ok(page, text, scope="", timeout=20000):
    page.wait_for_selector(f"{scope} .flash.ok:has-text('{text}')".strip(), timeout=timeout)
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    lab, contact, box_name = f"Nile Aligner Lab {stamp}", f"Eng. Karim {stamp}", f"PF USD {stamp}"
    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])

    # ---- a lab and a box ----
    fin.goto(f"{BASE}/admin/partners")
    fin.locator("summary", has_text="Add a planner or lab").click()
    fin.select_option("#kind-new", "lab")
    fin.fill("#name-new", lab)
    fin.fill("#contact_name-new", contact)
    fin.fill("#currency-new", "USD")
    fin.get_by_role("button", name="Add partner").click()
    fin.wait_for_url(re.compile(r"/admin/partners/[0-9a-f-]{36}"), timeout=20000)
    partner_url = fin.url
    fin.goto(f"{BASE}/admin/finance/cash")
    fin.locator("summary", has_text="Add a cash box").click()
    fin.fill("#na-name", box_name)
    fin.fill("#na-cur", "USD")
    fin.fill("#na-open", "1000")
    fin.get_by_role("button", name="Add box").click()
    fin.wait_for_load_state("networkidle")
    fin.goto(f"{BASE}/admin/finance/cash")

    # ---- payment voucher to the lab, found by searching the contact name ----
    out = fin.locator("form:has(input[name=direction][value=out])")
    out.locator("select[name=account_id]").select_option(out.locator("select[name=account_id] option", has_text=box_name).first.get_attribute("value"))
    out.locator("input[name=amount]").fill("250")
    out.locator("#new-out-party").fill(f"karim {stamp}")
    item = out.locator(".picker-list li", has_text=lab)
    check("Searching the contact name finds the lab (with its type)", item.count() == 1 and "Lab" in item.inner_text(), out.inner_text()[:300])
    item.click()
    check("Picked lab is shown with a note that it counts in its account", lab in out.locator(".picked").inner_text() and "payment to" in out.inner_text())
    out.locator("input[name=description]").fill("Advance for October production")
    out.get_by_role("button", name=re.compile("Record payment")).click()
    ok(fin, "to the lab / clinic", "form:has(input[name=direction][value=out])")
    msg = fin.locator("form:has(input[name=direction][value=out]) .flash.ok").inner_text()
    pp = re.search(r"PP-\d{2}-\d{5}", msg)
    check("Payment voucher is recorded as a partner payment (PP-)", pp is not None and "CP-" in msg, msg)

    # ---- receipt voucher from the lab (Arabic search by type) ----
    inn = fin.locator("form:has(input[name=direction][value=in])")
    inn.locator("select[name=account_id]").select_option(inn.locator("select[name=account_id] option", has_text=box_name).first.get_attribute("value"))
    inn.locator("input[name=amount]").fill("40")
    inn.locator("#new-in-party").fill(f"معمل {stamp}")
    inn.locator(".picker-list li", has_text=lab).click()
    check("Receipt from a lab is explained as money returned", "money returned" in inn.inner_text())
    inn.get_by_role("button", name=re.compile("Record receipt")).click()
    ok(fin, "Receipt voucher", "form:has(input[name=direction][value=in])")
    if SHOTS: fin.screenshot(path=f"{SHOTS}/cash_partner_vouchers.png", full_page=True)

    # ---- voucher search ----
    fin.goto(f"{BASE}/admin/finance/cash?q={stamp}")
    found = fin.inner_text("section:has(.voucher-search)")
    check("Voucher search by the lab finds both vouchers", found.count(lab) >= 2 and "250.00 USD" in found and "40.00 USD" in found, found[:500])

    # ---- partner account ----
    fin.goto(partner_url)
    stats = fin.inner_text(".stats")
    check("Lab account: paid 250 − returned 40 = 210, RUKN owes −210 (advance)", "$210.00" in stats and "-$210.00" in stats.replace("−", "-"), stats)
    fin.goto(f"{BASE}/admin/print/partner-statement?partner={partner_url.rsplit('/', 1)[1]}")
    st = fin.inner_text("body")
    check("Lab statement lists the payment and the returned amount", pp is not None and pp.group(0) in st and "Returned" in st, st[:600])
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
