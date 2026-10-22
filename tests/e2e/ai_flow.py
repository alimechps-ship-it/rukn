"""
End-to-end test of the AI tools (run against tests/e2e/mock-anthropic.mjs, or a real key on staging):
assistant answers from system data through tools; agents cannot use it; transfer receipts
attached to payment notices are read and compared automatically; case staff can re-check.

  BASE_URL=… AGENT1_EMAIL=… AGENT1_PASSWORD=… CASEMGR_EMAIL=… CASEMGR_PASSWORD=… \
  RECEIPT_MATCH=receipt_match.png RECEIPT_MISMATCH=receipt_mismatch.png python tests/e2e/ai_flow.py
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


def send_notice(page, amount, ref, proof):
    form = page.locator("details:has(summary:has-text('I sent a payment'))")
    if form.get_attribute("open") is None:
        form.locator("summary").click()
    form.locator("#pn-amt").fill(amount)
    form.locator("#pn-ref").fill(ref)
    form.locator("#pn-proof").set_input_files(proof)
    form.get_by_role("button", name=re.compile("Send payment notice")).click()
    page.wait_for_selector(".flash.ok:has-text('Payment notice PN-')", timeout=60000)
    return re.search(r"PN-\d{2}-\d{5}", page.inner_text(".flash.ok:has-text('Payment notice')")).group(0)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
    stamp = str(int(time.time()))[-4:]

    # ---- assistant ----
    ops = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(ops, E["CASEMGR_EMAIL"], E["CASEMGR_PASSWORD"])
    check("AI assistant in the case-manager menu", "AI assistant" in ops.inner_text("aside"))
    ops.goto(f"{BASE}/admin/assistant")
    check("Case manager gets case questions only (no money suggestions)", ops.get_by_role("button", name="ما رصيد كل صندوق الآن؟").count() == 0)
    ops.fill(".chat-input textarea", "كم في الصندوق؟")
    ops.keyboard.press("Enter")
    ops.wait_for_selector(".bubble.assistant:not(.thinking)", timeout=30000)
    ans0 = ops.locator(".bubble.assistant").last.inner_text()
    check("Case manager's assistant has no money tools (answers from case stats)", "USD cash box" not in ans0 and "نتيجة من النظام" in ans0, ans0[:300])
    cm = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(cm, E["FINANCE_EMAIL"], E["FINANCE_PASSWORD"])
    check("AI assistant in the finance menu", "AI assistant" in cm.inner_text("aside"))
    cm.goto(f"{BASE}/admin/assistant")
    cm.get_by_role("button", name="ما رصيد كل صندوق الآن؟").click()
    cm.wait_for_selector(".bubble.assistant:not(.thinking)", timeout=30000)
    ans = cm.locator(".bubble.assistant").last.inner_text()
    check("Assistant answers from the cash boxes via a tool", "نتيجة من النظام" in ans and "\"boxes\"" in ans and "الصناديق" in ans, ans[:300])
    cm.fill(".chat-input textarea", "كم المستحق على كل مندوب؟")
    cm.keyboard.press("Enter")
    cm.locator(".bubble.assistant:not(.thinking)").nth(1).wait_for(timeout=30000)
    ans2 = cm.locator(".bubble.assistant").last.inner_text()
    check("Follow-up question answered from receivables data", "total_outstanding" in ans2 and "المستحقات" in ans2, ans2[:300])
    if SHOTS: cm.screenshot(path=f"{SHOTS}/ai_assistant.png", full_page=True)
    cm.reload()
    check("Conversation kept while navigating (session)", cm.locator(".bubble.user").count() == 2)

    # ---- agents cannot use it ----
    a1 = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    login(a1, E["AGENT1_EMAIL"], E["AGENT1_PASSWORD"])
    check("No assistant in the agent menu", "AI assistant" not in a1.inner_text("aside"))
    r = a1.request.post(f"{BASE}/admin/assistant-api", data={"messages": [{"role": "user", "content": "كم في الصندوق؟"}]})
    check("Agent is refused by the assistant API", r.status == 403)

    # ---- receipt reading ----
    a1.goto(f"{BASE}/admin/cases/new")
    a1.select_option("select[name=service_id]", index=1)
    a1.fill("input[name=clinic_name]", f"AI Test Clinic {stamp}")
    a1.fill("input[name=doctor_name]", "Dr. Test")
    a1.select_option("select[name=country_code]", "AE")
    a1.fill("input[name=patient_ref]", f"AI-{stamp}")
    a1.get_by_role("button", name="Create case").click()
    a1.wait_for_url(re.compile(r"/admin/cases/[0-9a-f-]{36}"), timeout=20000)
    case_url = a1.url.split("?")[0]
    cm.goto(case_url)
    cm.get_by_role("button", name="+ New invoice").click()
    cm.wait_for_url(re.compile(r"/invoices/[0-9a-f-]{36}"), timeout=20000)
    cm.fill("#inv-currency", "USD")
    cm.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Description (English)']").fill("Snap-On smile — upper arch")
    cm.locator("table.inv-lines tbody tr").nth(0).locator("input[aria-label='Unit price']").fill("1000")
    cm.get_by_role("button", name="Issue invoice · إصدار الفاتورة").click()
    cm.wait_for_url(re.compile(r"issued=1"), timeout=20000)

    a1.goto(case_url)
    pn_ok = send_notice(a1, "500", "TRX-AI-1", E["RECEIPT_MATCH"])
    a1.goto(case_url)
    pn_bad = send_notice(a1, "500", "TRX-AI-2", E["RECEIPT_MISMATCH"])
    check("Agent does not see the AI check", "AI check" not in a1.inner_text("#payments"))

    time.sleep(4)  # background check after the response
    cm.goto(f"{BASE}/admin/finance/notices")
    ok_box = cm.locator("li.notice", has_text=pn_ok).inner_text()
    bad_box = cm.locator("li.notice", has_text=pn_bad).inner_text()
    check("Matching receipt is flagged as matching", "AI check: matches" in ok_box and "TRX-AI-1" in ok_box, ok_box[:300])
    check("Different amount on the receipt is flagged (450 vs 500)", "differences found" in bad_box and "450" in bad_box, bad_box[:300])
    if SHOTS: cm.screenshot(path=f"{SHOTS}/ai_notices.png", full_page=True)
    n = cm.locator("li.notice", has_text=pn_bad)
    n.get_by_role("button", name=re.compile("Re-check receipt with AI")).click()
    cm.wait_for_selector(f"li.notice:has-text('{pn_bad}') .inline-ai .flash", timeout=30000)
    check("Finance manager can re-check a receipt on demand", "450" in n.locator(".inline-ai .flash").inner_text())
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
