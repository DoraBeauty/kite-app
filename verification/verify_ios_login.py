from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    # Emulate iPhone
    context = browser.new_context(
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    )
    page = context.new_page()
    try:
        page.goto("http://localhost:8080/index.html")

        # Wait for button to be visible
        page.wait_for_selector("#btn-google")

        # Click button
        page.click("#btn-google")

        # Check if button text changes to "登入中..."
        # This confirms the js function executed and reached the UI update part
        # and didn't crash before the check
        page.wait_for_selector("text=登入中...", timeout=5000)

        # Wait a bit for potential errors or redirects (though redirect might be blocked by CORS or config in this env)
        time.sleep(2)

        # Take screenshot
        page.screenshot(path="verification/ios_login_loading.png")
        print("Verification script finished successfully.")

    except Exception as e:
        print(f"Verification failed: {e}")
        page.screenshot(path="verification/error.png")
    finally:
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
