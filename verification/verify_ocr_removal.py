from playwright.sync_api import sync_playwright, expect
import os

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Load the local index.html file
    page.goto(f"file://{os.getcwd()}/index.html")

    # Wait for the app to initialize (login overlay hidden)
    # Based on memory, we need to bypass login logic or simulate it.
    # The app uses Firebase Auth.
    # However, since we are just checking static UI presence/absence, we might see the login screen.
    # The login screen covers everything.

    # We can try to manually hide the login overlay using script
    page.evaluate("document.getElementById('login-overlay').classList.add('hidden')")
    page.evaluate("document.getElementById('app-content').classList.remove('blur-login')")

    # Navigate to 'Add' tab
    page.click('#tab-add')

    # Check if OCR elements are gone
    # The OCR button had id "ocrInput" or similar, or was a button near the top.
    # I should verify that "ocrInput" does NOT exist.

    ocr_input = page.locator('#ocrInput')
    expect(ocr_input).to_have_count(0)

    print("OCR input not found (as expected).")

    # Take a screenshot of the Add page
    page.screenshot(path="verification/ocr_removal_check.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
