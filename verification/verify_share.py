from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 375, 'height': 812}) # Mobile viewport
    page = context.new_page()

    page.goto("http://localhost:8000")

    # Mock Data and Bypass Login
    page.evaluate("""
        // Force hide overlay
        const overlay = document.getElementById('login-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.add('hidden');
            overlay.remove(); // Just remove it from DOM
        }
        const appContent = document.getElementById('app-content');
        if (appContent) {
            appContent.classList.remove('blur-login');
            appContent.style.filter = 'none';
        }

        window.currentUser = { uid: 'test_user' };

        window.trades = [
            {
                id: 't1',
                symbolCode: '2330',
                symbolName: '台積電',
                status: 'closed',
                entryDate: '2023-10-01',
                exitDate: '2023-10-10',
                entryPrice: 500,
                totalQuantity: 1000,
                averagePrice: 500,
                persona: 'freelancer',
                strategyName: '強勢日',
                entryWind: '強風',
                history: [
                    { type: 'buy', price: 500, quantity: 1000, date: '2023-10-01' },
                    { type: 'sell', price: 550, quantity: 1000, date: '2023-10-10', averagePrice: 500 }
                ]
            },
            {
                id: 't2',
                symbolCode: '2454',
                symbolName: '聯發科',
                status: 'closed',
                entryDate: '2023-10-05',
                exitDate: '2023-10-12',
                entryPrice: 800,
                totalQuantity: 500,
                averagePrice: 800,
                persona: 'office',
                strategyName: '週趨勢',
                entryWind: '亂流',
                history: [
                    { type: 'buy', price: 800, quantity: 500, date: '2023-10-05' },
                    { type: 'sell', price: 780, quantity: 500, date: '2023-10-12', averagePrice: 800 }
                ]
            }
        ];

        if (!window.personas) {
             window.personas = {
                freelancer: { title: '打工型', color: '#3b82f6', options: [] },
                office: { title: '上班族', color: '#6366f1', options: [] },
                boss: { title: '老闆型', color: '#a855f7', options: [] }
             };
        }

        if (window.switchTab) {
            window.switchTab('history');
        }
    """)

    # Wait for history list
    try:
        page.wait_for_selector('#history-list > div', timeout=5000)
    except:
        page.evaluate("window.renderHistory()")
        page.wait_for_selector('#history-list > div', timeout=5000)

    # Debug screenshot
    page.screenshot(path="verification/before_click.png")

    # Click Selection Mode Button with force
    page.click('#btn-select-mode', force=True)

    # Select the first trade
    page.click('#history-list > div:nth-child(1)', force=True)

    # Click "Generate Image" (Share) button
    page.locator("button", has_text="產生圖片").click(force=True)

    # Wait for modal
    page.wait_for_selector('#shareModal')
    page.wait_for_timeout(2000)

    # Take screenshot
    page.screenshot(path="verification/share_modal.png")
    print("Screenshot taken")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
