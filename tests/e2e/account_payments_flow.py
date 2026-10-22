"""
End-to-end test: the agent sends money to RUKN from "My account" — for any open invoice or
as an advance / payment on account (no case) — and the finance manager confirms it.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… FINANCE_EMAIL=… FINANCE_PASSWORD=… PROOF_FILE=receipt.png \
  python tests/e2e/account_payments_flow.py
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


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]

    # ---- a case with an issued invoice (so the agent owes money) ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"Advance Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Advance")
    a1.select_option("select[name=country_code]", "EG")
    a1.fill("input[name=patient_ref]", f"ADV-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    code = re.search(r"RK-[A-Z]{2}-\d{2}-\d{5}", a1.inner_text("h1")).group(0)

    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    fin.goto(case_url)
    fin.get_by_role("button", name="+ New invoice").click()
    fin.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    fin.fill("#inv-currency", "USD")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Description (English)']").fill("Retainers")
    fin.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Unit price']").fill("400")
    fin.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    fin.wait_for_url(re.compile(r"issued=1"), timeout=20000)
    inv_no = re.search(r"INV-\d{2}-\d{5}", fin.inner_text("h1")).group(0)

    # ---- agent: banner on his cases + form on My account ----
    a1.goto(f"{BASE}/admin/cases")
    check("Agent's cases page shows his balance due with a 'Send a payment' button", "Balance due to RUKN" in a1.inner_text("main") and a1.locator("a", has_text="Send a payment").count() == 1)
    a1.locator("a", has_text="Send a payment").click()
    a1.wait_for_url(re.compile(r"/admin/statement"), timeout=20000)
    sec = a1.locator("#send-payment")
    check("My account shows the amount owed and the payment form", "You owe RUKN" in sec.inner_text() and sec.locator("#pn-inv").count() == 1)
    check("The invoice list covers all his open invoices (with the case code)", inv_no in sec.locator("#pn-inv").inner_text() and code in sec.locator("#pn-inv").inner_text())

    # ---- 1. advance / on account (no invoice) ----
    sec.locator("#pn-inv").select_option("")
    check("Without an invoice it is explained as a payment on account / advance", "payment on account / advance" in sec.inner_text())
    sec.locator("#pn-amt").fill("250")
    sec.locator("#pn-cur").fill("USD")
    sec.locator("#pn-ref").fill(f"ADV-{stamp}")
    sec.locator("#pn-proof").set_input_files(E["PROOF_FILE"])
    sec.get_by_role("button", name=re.compile("Send payment notice")).click()
    a1.wait_for_selector("#send-payment .flash.ok:has-text('Payment notice PN-')", timeout=60000)
    pn1 = re.search(r"PN-\d{2}-\d{5}", a1.inner_text("#send-payment .flash.ok")).group(0)

    # ---- 2. for the invoice, from the same page ----
    a1.reload()
    sec = a1.locator("#send-payment")
    sec.locator("#pn-inv").select_option(sec.locator("#pn-inv option", has_text=inv_no).first.get_attribute("value"))
    check("Choosing the invoice proposes its balance", sec.locator("#pn-amt").input_value() in ("400", "400.0"))
    sec.locator("#pn-ref").fill(f"INV-{stamp}")
    sec.get_by_role("button", name=re.compile("Send payment notice")).click()
    a1.wait_for_selector("#send-payment .flash.ok:has-text('Payment notice PN-')", timeout=60000)
    pn2 = re.search(r"PN-\d{2}-\d{5}", a1.inner_text("#send-payment .flash.ok")).group(0)
    a1.reload()
    lst = a1.inner_text("section:has(h2:has-text('Your payment notices'))")
    check("Both notices listed: one on account, one on the case", pn1 in lst and pn2 in lst and "On account / advance" in lst and code in lst, lst[:500])
    a1.goto(case_url)
    check("The invoice notice also appears on the case", pn2 in a1.inner_text("#payments") and pn1 not in a1.inner_text("#payments"))

    # ---- finance confirms the advance ----
    fin.goto(f"{BASE}/admin/finance/notices")
    n = fin.locator("li.notice", has_text=pn1)
    check("Finance sees the advance marked 'On account / advance'", "On account / advance" in n.inner_text())
    proof = n.locator("a", has_text="Proof of payment").get_attribute("href")
    resp = fin.request.get(f"{BASE}{proof}", max_redirects=0)
    check("Finance opens the proof (signed link)", resp.status in (302, 307), str(resp.status))
    box = n.locator("select[name=cash_account_id] option", has_text="USD").first.get_attribute("value")
    n.locator("select[name=cash_account_id]").select_option(box)
    n.get_by_role("button", name=re.compile("Confirm payment")).click()
    fin.locator("li.notice", has_text=pn1).locator(".pill", has_text="Confirmed").wait_for(timeout=20000)
    rc = re.search(r"RC-\d{2}-\d{5}", fin.locator("li.notice", has_text=pn1).inner_text()).group(0)
    fin.goto(f"{BASE}/admin/finance/cash?q={rc}")
    check("Advance deposited in the cash box as 'Payment on account'", "Payment on account" in fin.inner_text("main") and "250.00" in fin.inner_text("main"))

    # ---- agent: receipt and statement ----
    a1.goto(f"{BASE}/admin/statement")
    st = a1.inner_text("main")
    check("Statement shows the receipt as payment on account", rc in st and "On account / advance" in st, st[:600])
    href = a1.locator("a", has_text=rc).first.get_attribute("href")
    pg = a1.context.new_page()
    r = pg.goto(f"{BASE}{href}")
    body = pg.inner_text("body")
    check("Agent prints the on-account receipt", r.status == 200 and "Payment Receipt" in body and "on account" in body.lower() and "250" in body, body[:300])
    pg.close()
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
