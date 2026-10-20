"""
RUKN end-to-end acceptance test (Playwright, Python).

Runs the real Next.js app against a real Supabase (Auth + PostgREST + Storage).
Usage:
  BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
  SALES_EMAIL=... SALES_PASSWORD=... CONTENT_EMAIL=... CONTENT_PASSWORD=... \
  TRANSLATOR_EMAIL=... TRANSLATOR_PASSWORD=... UPLOAD_IMAGE=path/to/test.png \
  python tests/e2e/acceptance.py
Optional: CHROMIUM=/path/to/chrome

The test changes content and restores it afterwards. Run it against a staging
project, never against production.
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
E = os.environ
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))


def login(page, email, password):
    page.goto(f"{BASE}/admin/login")
    page.fill("#email", email)
    page.fill("#password", password)
    page.click("button[type=submit]")
    page.wait_for_load_state("networkidle")


def logout(page):
    page.context.clear_cookies()


def confirm(page, button_text, confirm_text):
    page.get_by_role("button", name=button_text, exact=True).first.click()
    dlg = page.locator("dialog[open]")
    dlg.get_by_role("button", name=confirm_text, exact=True).click()
    page.wait_for_timeout(1500)
    page.wait_for_load_state("networkidle")


def run():
    stamp = str(int(time.time()))[-5:]
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=E.get("CHROMIUM") or None)
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()

        # ---------------- Public website ----------------
        r = page.goto(f"{BASE}/en")
        check("1. Public website loads", r.status == 200 and page.locator("h1").count() > 0)
        page.locator(".lang-switch a[hreflang=ar]").first.click()
        page.wait_for_load_state("networkidle")
        check("2. Language switch EN → AR", page.url.rstrip("/").endswith("/ar"))
        check("3. Arabic page is RTL", page.evaluate("document.documentElement.dir") == "rtl" and page.evaluate("document.documentElement.lang") == "ar")
        page.goto(f"{BASE}/")
        check("2b. Selected language persists (cookie)", page.url.rstrip("/").endswith("/ar"))
        page.goto(f"{BASE}/en")

        # Honest server-side validation (browser validation bypassed)
        page.goto(f"{BASE}/en/contact")
        page.wait_for_timeout(1800)
        page.evaluate("document.querySelectorAll('form').forEach(f=>f.noValidate=true)")
        page.fill("#contact-name", "X")
        page.fill("#contact-email", "not-an-email")
        page.click("form button[type=submit]")
        page.wait_for_selector(".alert-error", timeout=10000)
        check("19. Invalid submission shows an honest error", page.locator(".alert-error").count() == 1 and page.locator(".field .error").count() >= 1)

        # Real case inquiry
        name = f"E2E Doctor {stamp}"
        page.goto(f"{BASE}/en/case-inquiry?service=clear-aligners")
        page.wait_for_timeout(1800)
        page.fill("#case-name", name)
        page.fill("#case-email", f"e2e{stamp}@example.com")
        page.fill("#case-country", "Germany")
        page.fill("#case-organization", "E2E Dental Clinic")
        page.select_option("#case-role", "orthodontist")
        check("Service pre-selected from URL", page.eval_on_selector("#case-service", "e => e.value") == "clear-aligners")
        page.fill("#case-message", "Automated acceptance test — no patient data.")
        page.check("input[name=consent]")
        page.click("form button[type=submit]")
        page.wait_for_selector(".success-panel", timeout=15000)
        check("11. Public case inquiry submitted", "secure channel" in page.inner_text(".success-panel"))

        # Mobile layout: no horizontal overflow
        m = browser.new_context(viewport={"width": 375, "height": 800}).new_page()
        overflow = []
        for path in ["/en", "/ar", "/en/services/clear-aligners", "/ar/partnerships", "/en/contact", "/en/privacy-policy"]:
            m.goto(f"{BASE}{path}")
            if m.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
                overflow.append(path)
        m.locator(".menu-toggle").first.click()
        menu_ok = m.locator("#mobile-menu").is_visible()
        check("17. Mobile: no horizontal overflow + working menu", not overflow and menu_ok, str(overflow))
        m.context.close()

        # ---------------- Admin ----------------
        page.goto(f"{BASE}/admin/inquiries")
        check("5. Unauthenticated visitor is redirected to login", "/admin/login" in page.url)

        login(page, E["ADMIN_EMAIL"], "wrong-password-123")
        check("4a. Wrong password is rejected with a message", page.locator(".flash.err").count() == 1)
        login(page, E["ADMIN_EMAIL"], E["ADMIN_PASSWORD"])
        check("4. Administrator signs in", page.url.rstrip("/").endswith("/admin") and page.locator("h1", has_text="Dashboard").count() == 1)

        # 12. inquiry in dashboard
        page.goto(f"{BASE}/admin/inquiries?q={name.replace(' ', '+')}")
        check("12. Inquiry appears in admin", page.locator("table.data", has_text=name).count() == 1)
        page.get_by_role("link", name=name).click()
        page.wait_for_load_state("networkidle")
        page.select_option("select[name=status]", "contacted")
        page.get_by_role("button", name="Update").click()
        page.wait_for_selector(".flash.ok")
        page.fill("#body", "Called the clinic (E2E).")
        page.get_by_role("button", name="Add note").click()
        page.wait_for_timeout(1500)
        check("12b. Status change + internal note saved", page.locator(".timeline", has_text="Called the clinic").count() == 1)
        csv = page.request.get(f"{BASE}/admin/inquiries/export?q={name}")
        check("12c. CSV export contains the inquiry", csv.status == 200 and name in csv.text())

        # 6. Edit + publish a headline
        page.goto(f"{BASE}/admin/pages")
        page.get_by_role("link", name="Home").first.click()
        page.wait_for_load_state("networkidle")
        page.locator("table.data a", has_text="Digital Dental Solutions").first.click()
        page.wait_for_load_state("networkidle")
        original = page.input_value("input[name='tr.en.heading']")
        new = f"Digital Dental Solutions. Global Partnerships. {stamp}"
        page.fill("input[name='tr.en.heading']", new)
        page.get_by_role("button", name="Save draft").click()
        page.wait_for_selector(".flash.ok")
        pub = browser.new_context().new_page()
        pub.goto(f"{BASE}/en")
        check("6a. Draft is NOT public before publishing", new not in pub.inner_text("h1"))
        page.get_by_role("button", name="Save & publish").click()
        page.wait_for_selector(".flash.ok:has-text('published')")
        pub.goto(f"{BASE}/en")
        check("6. Edited headline is public after publishing", new in pub.inner_text("h1"))

        # 10. persistence across logout
        logout(page)
        login(page, E["ADMIN_EMAIL"], E["ADMIN_PASSWORD"])
        page.go_back()
        page.goto(page.url)
        pub.goto(f"{BASE}/en")
        check("10. Content persists after refresh and logout", new in pub.inner_text("h1"))

        # restore original headline
        page.goto(f"{BASE}/admin/pages")
        page.get_by_role("link", name="Home").first.click()
        page.locator("table.data a", has_text=stamp).first.click()
        page.fill("input[name='tr.en.heading']", original)
        page.get_by_role("button", name="Save & publish").click()
        page.wait_for_selector(".flash.ok:has-text('published')")

        # 16. SEO metadata
        page.goto(f"{BASE}/admin/pages")
        page.get_by_role("link", name="About Us").click()
        page.wait_for_load_state("networkidle")
        seo_orig = page.input_value("input[name='tr.en.seo_title']")
        page.fill("input[name='tr.en.seo_title']", f"About RUKN SEO {stamp}")
        page.get_by_role("button", name="Save & publish").click()
        page.wait_for_selector(".flash.ok:has-text('published')")
        pub.goto(f"{BASE}/en/about")
        check("16. SEO title changed on the public page", pub.title() == f"About RUKN SEO {stamp}")
        hreflang = pub.locator("link[rel=alternate][hreflang=ar]").count() == 1
        check("16b. hreflang + canonical present", hreflang and pub.locator("link[rel=canonical]").count() == 1)
        page.fill("input[name='tr.en.seo_title']", seo_orig)
        page.get_by_role("button", name="Save & publish").click()
        page.wait_for_selector(".flash.ok:has-text('published')")

        # 7. Add a service
        slug = f"night-guards-{stamp}"
        page.goto(f"{BASE}/admin/services")
        page.fill("input[name=title]", f"Night Guards {stamp}")
        page.fill("input[name=slug]", slug)
        page.get_by_role("button", name="Create draft service").click()
        page.wait_for_url(re.compile(r"/admin/services/[0-9a-f-]{36}"))
        page.fill("textarea[name='tr.en.summary']", "Test service created by the acceptance test.")
        page.get_by_role("button", name="Save & publish").click()
        page.wait_for_selector(".flash.ok:has-text('published')")
        r = pub.goto(f"{BASE}/en/services/{slug}")
        check("7. New service is published and reachable", r.status == 200 and f"Night Guards {stamp}" in pub.inner_text("h1"))

        # 9. Delete with confirmation (soft delete → trash → permanent)
        page.goto(f"{BASE}/admin/services")
        row = page.locator("tr", has_text=f"Night Guards {stamp}")
        row.get_by_role("button", name="Delete").click()
        page.locator("dialog[open]").get_by_role("button", name="Move to Trash").click()
        page.wait_for_timeout(2000)
        r = pub.goto(f"{BASE}/en/services/{slug}")
        check("9. Deleted (with confirmation) service disappears from the site", r.status == 404)
        page.goto(f"{BASE}/admin/trash")
        trow = page.locator("tr", has_text=slug)
        trow.get_by_role("button", name="Delete permanently").click()
        page.locator("dialog[open]").get_by_role("button", name="Delete permanently").click()
        page.wait_for_timeout(2000)
        page.reload()
        check("9b. Permanently deleted from Trash", page.locator("tr", has_text=slug).count() == 0)

        # 15. Upload media
        page.goto(f"{BASE}/admin/media")
        before = page.locator(".media-tile").count()
        page.set_input_files("#up-file", E["UPLOAD_IMAGE"])
        page.wait_for_selector(".timeline li:has-text('Uploaded')", timeout=60000)
        page.reload()
        check("15. Image upload to storage + library", page.locator(".media-tile").count() == before + 1)

        # 8. Replace a service image
        pub.goto(f"{BASE}/en/services/clear-retainers")
        src_before = pub.get_attribute(".hero-media img", "src")
        page.goto(f"{BASE}/admin/media?cat=retainers")
        page.locator(".media-tile", has_text="RUKN_Clear_Aligner_Studio-8").click()
        page.wait_for_load_state("networkidle")
        page.set_input_files("#up-file", E["UPLOAD_IMAGE"])
        page.wait_for_selector(".timeline li:has-text('replaced')", timeout=60000)
        pub.goto(f"{BASE}/en/services/clear-retainers")
        src_after = pub.get_attribute(".hero-media img", "src")
        img_ok = pub.request.get(src_after).status == 200
        check("8. Service image replaced everywhere it is used", src_before != src_after and img_ok)

        # Deleting a used image is refused with an honest message
        page.reload()
        page.get_by_role("button", name="Delete image").click()
        page.locator("dialog[open]").get_by_role("button", name="Delete").click()
        page.wait_for_selector("dialog[open] .flash.err")
        check("8b. Deleting an image that is in use is refused", "still used" in page.inner_text("dialog[open] .flash.err"))
        page.keyboard.press("Escape")

        # 14. Role restrictions (UI + server)
        def role_ctx(email, pw):
            c = browser.new_context()
            pg = c.new_page()
            login(pg, email, pw)
            return pg
        sales = role_ctx(E["SALES_EMAIL"], E["SALES_PASSWORD"])
        sales.goto(f"{BASE}/admin/pages")
        s1 = "denied=1" in sales.url
        sales.goto(f"{BASE}/admin/inquiries")
        s2 = sales.locator("h1", has_text="Inquiries").count() == 1
        content = role_ctx(E["CONTENT_EMAIL"], E["CONTENT_PASSWORD"])
        content.goto(f"{BASE}/admin/inquiries")
        c1 = "denied=1" in content.url
        c2 = content.request.get(f"{BASE}/admin/inquiries/export").status == 403
        content.goto(f"{BASE}/admin/users")
        c3 = "denied=1" in content.url
        tr = role_ctx(E["TRANSLATOR_EMAIL"], E["TRANSLATOR_PASSWORD"])
        tr.goto(f"{BASE}/admin/services")
        tr.locator("table.data a").first.click()
        tr.wait_for_load_state("networkidle")
        t1 = tr.locator("input[name='tr.en.title']").is_disabled() and not tr.locator("input[name='tr.ar.title']").is_disabled()
        t2 = tr.get_by_role("button", name="Save & publish").count() == 0
        tr.goto(f"{BASE}/admin/inquiries")
        t3 = "denied=1" in tr.url
        check("14. Role restrictions: sales / content / translator", all([s1, s2, c1, c2, c3, t1, t2, t3]), str([s1, s2, c1, c2, c3, t1, t2, t3]))

        # 13/20 anonymous API access to private data
        api = E.get("SUPABASE_URL")
        if api:
            res = page.request.get(f"{api}/rest/v1/inquiries?select=*", headers={"apikey": E["SUPABASE_ANON_KEY"]})
            check("13. Anonymous API read of inquiries is denied", res.status in (401, 403) or res.json() == [])

        browser.close()

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    run()
