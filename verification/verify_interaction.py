from playwright.sync_api import sync_playwright
import os
import time

def verify_journal_interaction():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the file
        page.goto("file:///app/index.html")

        # Wait for overlay
        page.wait_for_selector('#login-overlay')

        # Force hide login overlay and enable pointer events
        page.evaluate("""
            const overlay = document.getElementById('login-overlay');
            if (overlay) overlay.style.display = 'none';
            const content = document.getElementById('app-content');
            if (content) {
                content.classList.remove('blur-login');
                content.style.filter = 'none';
                content.style.pointerEvents = 'auto';
            }
        """)

        # Click Journal Tab
        page.click('#tab-journal')

        # Wait for calendar
        page.wait_for_selector('#calendar-container')

        # Find a date cell (e.g., text '15') and click it
        page.locator('#calendar-container div').filter(has_text="15").first.click()

        # Check if details container is visible
        # The id is 'journal-details-container'
        # It has 'hidden' class initially. selectDate removes it.

        # Wait for it to be visible
        try:
            page.wait_for_selector('#journal-details-container', state='visible', timeout=2000)
            print("SUCCESS: #journal-details-container is visible after clicking date.")

            # Check header
            header_text = page.locator('#journal-details-container h3').first.text_content()
            print(f"Header text: {header_text}")

        except Exception as e:
            print(f"FAILURE: {e}")
            # print html content for debugging
            # print(page.content())

        # Take screenshot
        page.screenshot(path="/app/verification/journal_interaction.png")

        browser.close()

if __name__ == "__main__":
    verify_journal_interaction()
