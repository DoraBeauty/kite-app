from playwright.sync_api import sync_playwright
import time

def verify(page):
    # Enable console logs
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda msg: print(f"PAGE ERROR: {msg}"))

    # Start server first in background (I'll assume I run it manually via tool)
    page.goto("http://localhost:8080/index.html")

    # Wait for showToast to be defined (module load)
    try:
        page.wait_for_function("() => typeof window.showToast === 'function'", timeout=10000)
    except:
        print("Timeout waiting for showToast. Script might have crashed.")
        return

    # Inject code to simulate the condition since we can't login easily
    # We will invoke showToast manually to verify the visual appearance matches expectations for a toast
    page.evaluate("""
        window.showToast("系統更新：請點擊選單中的「資料修正 (FIFO)」以校正歷史均價", 'info');
    """)

    # Wait for toast
    # Looking for the text in the DOM
    page.get_by_text("系統更新").wait_for(timeout=5000)

    page.screenshot(path="verification/toast_check.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        verify(page)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()
