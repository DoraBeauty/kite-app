
from playwright.sync_api import sync_playwright
import time

def verify(page):
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.goto("http://localhost:8080/index.html")

    # Wait for window.viewDetails to be defined
    page.wait_for_function("() => typeof window.viewDetails === 'function'")

    # Inject dummy trade and render
    page.evaluate("""
        window.trades = [{
            id: 'test-trade-1',
            symbolCode: '2330',
            symbolName: '台積電',
            status: 'open',
            totalQuantity: 1000,
            averagePrice: 500,
            persona: 'freelancer',
            strategyName: 'Test Strategy',
            entryDate: '2023-01-01',
            history: [
                { type: 'buy', date: '2023-01-01', price: 500, quantity: 2000, note: '', wind: '強風' },
                { type: 'sell', date: '2023-01-02', price: 550, quantity: 1000, note: '', wind: '強風', averagePrice: 500 }
            ]
        }];
        window.personas = {
            freelancer: { title: '打工型', color: '#3b82f6', options: [] }
        };
        // Mock getFeeSettings if not already defined (it is defined in index.html but maybe we need to stub if it relies on DB)
        if(!window.getFeeSettings) window.getFeeSettings = () => ({ discount: 2.8, minFee: 20 });
        if(!window.calculateCost) window.calculateCost = () => 20;
        if(!window.calculateNetPnL) window.calculateNetPnL = (cost, price, qty) => (price - cost) * qty;

        // Render
        window.viewDetails('test-trade-1');
    """)

    # Wait for modal
    page.locator("#detailsModal").wait_for(state="visible", timeout=5000)

    # Check for the main edit button in subtitle
    edit_btn = page.locator("#detail-subtitle button .lucide-edit-2")
    # Note: Lucide icons render as SVG, sometimes with class lucide-edit-2 or just svg
    # My code used <i data-lucide="edit-2"></i> which gets replaced by svg by lucide.createIcons()
    # The class `lucide-edit-2` is usually added by the library to the SVG.

    if edit_btn.count() > 0:
        print("Main Average Price Edit Button Found!")
    else:
        # Fallback check for svg
        if page.locator("#detail-subtitle button svg").count() > 0:
             print("Main Average Price Edit Button Found (SVG)!")
        else:
             print("Main Average Price Edit Button NOT Found!")

    # Check for the history edit button
    history_edit_btn = page.locator("text=成本均價").locator("..").locator("button svg")
    if history_edit_btn.count() > 0:
        print("History Cost Edit Button Found!")
    else:
        print("History Cost Edit Button NOT Found!")

    page.screenshot(path="verification/edit_cost_ui.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        verify(page)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()
