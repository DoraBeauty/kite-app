from playwright.sync_api import sync_playwright
import os
import time

def verify_calendar():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the file
        page.goto("file:///app/index.html")

        # Wait for the login overlay to be visible (meaning Firebase Auth has likely initialized to 'no user')
        # The overlay has id "login-overlay"
        page.wait_for_selector("#login-overlay", state="visible")

        # Now force hide it
        page.evaluate("""
            const overlay = document.getElementById('login-overlay');
            if (overlay) overlay.style.display = 'none';
            const content = document.getElementById('app-content');
            if (content) content.classList.remove('blur-login');
        """)

        # Now try to click
        page.click('#tab-journal')

        # Wait for calendar
        page.wait_for_selector('#calendar-container')

        # Take screenshot
        page.screenshot(path="/app/verification/journal_tab.png")
        print("Journal tab screenshot taken.")

        browser.close()

if __name__ == "__main__":
    verify_calendar()
