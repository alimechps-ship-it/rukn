"""
End-to-end test of exchange rates: automatic update, manual (locked) rates, and
transfers between boxes in different currencies with the automatic or an edited rate.

  BASE_URL=… FINANCE_EMAIL=… FINANCE_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… python tests/e2e/fx_flow.py
  (the app must run with FX_API_URL=http://localhost:54400/fx and tests/e2e/mock-anthropic.mjs started)
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


def transfer_done(page):
    """The form clears the amount once the server confirmed the transfer."""
    for _ in range(60):
        if page.input_value("#tr-amt") == "":
            break
        page.wait_for_timeout(250)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)


def rate_row(page, cur):
    return page.locator("table.data tbody tr", has=page.locator("td:first-child strong", has_text=re.compile(f"^{cur}$"))).first


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-5:]
    fin = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(fin, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    check("Exchange rates in the finance menu", "Exchange rates" in fin.inner_text("aside"))

    # ---- automatic update ----
    fin.goto(f"{BASE}/admin/finance/rates")
    fin.get_by_role("button", name=re.compile("Update rates now")).click()
    ok(fin, "Rates updated automatically")
    fin.reload()
    egp = rate_row(fin, "EGP").inner_text()
    check("Automatic rate loaded from the internet service (1 USD = 50.25 EGP)", "50.25" in egp and "automatic" in egp, egp)

    # ---- manual, locked rate survives the automatic update ----
    row = rate_row(fin, "EUR")
    row.locator("input[name=per_usd]").fill("0.95")
    row.locator("input[name=locked]").check()
    row.get_by_role("button", name="Save").click()
    ok(fin, "Rate saved")
    fin.get_by_role("button", name=re.compile("Update rates now")).click()
    ok(fin, "Rates updated automatically")
    fin.reload()
    eur = rate_row(fin, "EUR").inner_text()
    check("Locked manual rate is kept by the automatic update", "0.95" in eur and "locked" in eur, eur)
    check("Change history records who changed what", "0.95" in fin.inner_text("section:has(h2:has-text('Recent changes'))"))
    rate_row(fin, "EUR").get_by_role("button", name=re.compile("Automatic")).click()
    for _ in range(40):  # the button disappears once unlocked
        if "locked" not in rate_row(fin, "EUR").inner_text():
            break
        fin.wait_for_timeout(500)
    fin.reload()
    check("Unlocked rate goes back to automatic (0.9)", "automatic" in rate_row(fin, "EUR").inner_text())
    if SHOTS: fin.screenshot(path=f"{SHOTS}/fx_rates.png", full_page=True)

    # ---- two boxes ----
    for name, cur, opening in [(f"FX USD {stamp}", "USD", "1000"), (f"FX EGP {stamp}", "EGP", "0")]:
        fin.goto(f"{BASE}/admin/finance/cash")
        fin.locator("summary", has_text="Add a cash box").click()
        fin.fill("#na-name", name)
        fin.select_option("#na-cur", cur)
        fin.fill("#na-open", opening)
        fin.get_by_role("button", name="Add box").click()
        ok(fin, "")
    fin.goto(f"{BASE}/admin/finance/cash")
    check("Cash page shows the totals converted at today's rates", "at today's rates" in fin.inner_text(".stats"))
    usd = fin.locator("#tr-from option", has_text=f"FX USD {stamp}").first.get_attribute("value")
    egp_box = fin.locator("#tr-to option", has_text=f"FX EGP {stamp}").first.get_attribute("value")

    # ---- transfer with the automatic rate ----
    fin.select_option("#tr-from", usd)
    fin.select_option("#tr-to", egp_box)
    fin.fill("#tr-amt", "100")
    check("Automatic rate proposed for USD → EGP", fin.input_value("#tr-rate") == "50.25" and "automatic" in fin.inner_text("label[for=tr-rate]"), fin.input_value("#tr-rate"))
    check("Received amount computed automatically (5025)", fin.input_value("#tr-amt2") in ("5025", "5025.0"), fin.input_value("#tr-amt2"))
    fin.get_by_role("button", name="Record transfer").click()
    transfer_done(fin)

    # ---- transfer with an edited rate ----
    fin.select_option("#tr-from", usd)
    fin.select_option("#tr-to", egp_box)
    fin.fill("#tr-amt", "100")
    fin.fill("#tr-rate", "51")
    check("Editing the rate recalculates the received amount (5100) and marks it edited", fin.input_value("#tr-amt2") == "5100" and "edited" in fin.inner_text("label[for=tr-rate]"), fin.input_value("#tr-amt2"))
    fin.get_by_role("button", name="Record transfer").click()
    transfer_done(fin)

    # ---- transfer with a typed received amount ----
    fin.select_option("#tr-from", usd)
    fin.select_option("#tr-to", egp_box)
    fin.fill("#tr-amt", "100")
    fin.fill("#tr-amt2", "4980")
    check("Typing the received amount derives the rate (49.8)", fin.input_value("#tr-rate") == "49.8", fin.input_value("#tr-rate"))
    fin.get_by_role("button", name="Record transfer").click()
    transfer_done(fin)
    if SHOTS: fin.screenshot(path=f"{SHOTS}/fx_transfer.png", full_page=True)

    fin.goto(f"{BASE}/admin/finance/cash/{egp_box}")
    st = fin.inner_text("main")
    check("EGP box received 5025 + 5100 + 4980 = 15,105 EGP", "15,105.00 EGP" in st, st[:500])
    check("Vouchers show the rate used (auto / manual)", "1 USD = 50.250000 EGP (auto rate)" in st and "1 USD = 51.000000 EGP (manual rate)" in st and "1 USD = 49.800000 EGP (manual rate)" in st)
    fin.goto(f"{BASE}/admin/finance/cash/{usd}")
    check("USD box paid out 300", "700.00 USD" in fin.inner_text("main"))

    # ---- case manager has no access ----
    cm = b.new_context().new_page()
    login(cm, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    cm.goto(f"{BASE}/admin/finance/rates")
    check("Case manager cannot open exchange rates", "denied" in cm.url or "/finance/rates" not in cm.url)
    b.close()

failed = [n for n, ok_ in results if not ok_]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
