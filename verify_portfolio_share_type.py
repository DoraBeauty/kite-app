import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"PAGE CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        # Load the page
        url = "http://localhost:8000/index.html"
        await page.goto(url)
        print(f"Loaded {url}")

        # --- Inject mock data and remove login overlay ---
        await page.evaluate("""
            window.currentUser = { uid: 'test-user', email: 'test@example.com' };
            window.trades = [
                {
                    id: 'trade-1',
                    symbolCode: '2330',
                    symbolName: '台積電',
                    status: 'open',
                    entryDate: '2023-10-01',
                    entryPrice: 500,
                    totalQuantity: 1000,
                    averagePrice: 500,
                    history: [
                        { type: 'buy', date: '2023-10-01', price: 500, quantity: 1000 }
                    ],
                    persona: 'freelancer',
                    strategyName: 'Strategy A'
                }
            ];
            window.livePrices = { '2330': 550 };

            // Remove login overlay
            const overlay = document.getElementById('login-overlay');
            if(overlay) overlay.remove();
            document.body.classList.remove('blur-login');
            const appContent = document.getElementById('app-content');
            if(appContent) appContent.classList.remove('blur-login');
        """)

        # --- Test Portfolio Page ---
        # 1. Switch to Portfolio Tab
        await page.evaluate("window.switchTab('portfolio')")

        # 2. Wait for Portfolio UI to render
        try:
            await page.wait_for_selector("#portfolio-list", timeout=3000)
            await page.wait_for_selector("#btn-portfolio-select-mode", timeout=3000)
            print("Portfolio page rendered.")
        except Exception as e:
            print(f"ERROR: Portfolio page elements not found: {e}")
            await browser.close()
            return

        # 3. Enter Selection Mode
        await page.click("#btn-portfolio-select-mode")
        print("Clicked select mode button.")

        # 4. Select a trade
        try:
            trade_card_selector = "#portfolio-list > div"
            await page.wait_for_selector(trade_card_selector, timeout=3000)
            await page.click(trade_card_selector)
            print("Selected first trade.")
        except Exception as e:
            print(f"ERROR: Could not select trade: {e}")

        # 5. Click "Share Portfolio" button
        share_btn_selector = "button:has-text('分享庫存')"
        try:
            # Check if button exists in DOM even if hidden
            btn_count = await page.locator(share_btn_selector).count()
            print(f"Found {btn_count} share buttons in DOM.")

            await page.wait_for_selector(share_btn_selector, state="visible", timeout=3000)
            await page.click(share_btn_selector)
            print("Clicked 'Share Portfolio' button.")
        except Exception as e:
            print(f"ERROR: Share button failure: {e}")
            # print(await page.content())
            await browser.close()
            return

        # 6. Verify Share Modal State
        share_type = await page.evaluate("window.shareType")
        print(f"window.shareType: {share_type}")

        if share_type != 'portfolio':
             print("FAILURE: window.shareType is not 'portfolio'")
        else:
             print("SUCCESS: window.shareType is correct.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
