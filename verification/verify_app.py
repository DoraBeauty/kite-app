from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load local file
        app_path = os.path.abspath("index.html")
        page.goto(f"file://{app_path}")

        # 1. Verify Title
        title = page.title()
        print(f"Page Title: {title}")
        assert "v1.5.1" in title, "Title should contain version v1.5.1"

        # Bypass Login Overlay
        page.evaluate('document.getElementById("login-overlay").classList.add("hidden")')
        page.evaluate('document.getElementById("app-content").classList.remove("blur-login")')

        # 2. Check Defaults in Settings
        # Click user menu to open dropdown
        # Wait for animation/state
        page.wait_for_timeout(500)

        # Force the settings modal open directly via JS if UI interaction is flaky due to "not logged in" state
        # But UI buttons should work even if not logged in?
        # Actually user menu might rely on "currentUser" check?
        # Let's check code: toggleUserMenu() just toggles class. It should work.

        page.locator("#user-btn").click()
        page.wait_for_timeout(500)

        # Click Settings
        page.get_by_text("手續費設定").click()
        page.wait_for_timeout(500)

        # Check Discount Input
        discount = page.locator("#setting-discount").input_value()
        print(f"Default Discount: {discount}")
        assert discount == "2.8", f"Expected discount 2.8, got {discount}"

        # Take screenshot of settings
        page.screenshot(path="verification/settings_check.png")
        print("Screenshot saved to verification/settings_check.png")

        browser.close()

if __name__ == "__main__":
    run()
