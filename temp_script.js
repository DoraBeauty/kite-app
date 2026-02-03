
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
        import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

        const firebaseConfig = {
            apiKey: "AIzaSyB4BuO5gvNfkHYYp48FvwYhK-VXpnb7NSg",
            authDomain: "stock-app-4e8cd.firebaseapp.com",
            projectId: "stock-app-4e8cd",
            storageBucket: "stock-app-4e8cd.firebasestorage.app",
            messagingSenderId: "755625283902",
            appId: "1:755625283902:web:8789da17765e35e5e2dc6f"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const provider = new GoogleAuthProvider();

        let currentUser = null;
        let trades = [];
        let dailyLogs = {};
        let unsubscribe = null;
        let unsubscribeLogs = null;
        let unsubscribeSession = null;
        let keepAliveInterval = null;
        let chartInstance = null;
        let currentDeviceId = null;
        let visibilityHandler = null;

        window.trades = trades;
        // --- 🚀 新增：Google Sheet 連線設定 ---
        const GAS_URL = "https://script.google.com/macros/s/AKfycbyvQyrjFdchuPKOilwP8pn1MiWiJtmZLRfj4cIGerrZsdw-PIFQGAHZOpmBSJmhbDJvDg/exec";
        window.livePrices = {}; // 存現價：{ "2330": 600 }
        window.stockNames = {}; // 存名稱：{ "2330": "台積電" }

        // 1. 從 Sheet 抓取最新股價
        window.updateStockData = async () => {
            const btn = document.getElementById('refresh-btn-icon');
            if(btn) btn.classList.add('animate-spin');

            try {
                const res = await fetch(GAS_URL);
                const data = await res.json();

                // 整理資料
                data.forEach(row => {
                    const code = row.symbolCode.toString();
                    if (row.livePrice && row.livePrice !== "#N/A") {
                        window.livePrices[code] = parseFloat(row.livePrice);
                    }
                    if (row.symbolName) {
                        window.stockNames[code] = row.symbolName;
                    }
                });

                console.log("股價已更新", window.livePrices);
                renderPortfolio(); // 更新介面
                updateGlobalStats(); // 更新總損益
            } catch (e) {
                console.error("股價更新失敗", e);
            } finally {
                if(btn) btn.classList.remove('animate-spin');
            }
        };

        // 2. 將新交易同步寫入 Sheet
        window.syncToSheet = (trade) => {
            fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify({
                    symbolCode: trade.symbolCode,
                    symbolName: trade.symbolName,
                    entryPrice: trade.entryPrice,
                    quantity: trade.totalQuantity
                })
            }).then(() => console.log("已同步至 Sheet"));
        };

        // 3. 設定定時器：每 60 秒自動更新一次
        setInterval(window.updateStockData, 60000);
        // =========== 🛑 補上這段：輸入代號自動跳名稱 ===========
        // 等待 1 秒確保網頁載入完成，然後開始監聽
        setTimeout(() => {
            const codeInput = document.getElementById('symbolCode');

            if(codeInput) {
                // 當你在「代號」欄位打字時...
                codeInput.addEventListener('input', (e) => {
                    const inputCode = e.target.value; // 你輸入的數字 (例如 2330)

                    // 去檢查我們腦袋裡的名單 (window.stockNames) 有沒有這個號碼
                    if (window.stockNames[inputCode]) {
                        // 有的話，把名稱填入「名稱」欄位
                        document.getElementById('symbolName').value = window.stockNames[inputCode];
                        console.log(`找到股票：${inputCode} ${window.stockNames[inputCode]}`);
                    }
                });
                console.log("自動填入功能已啟動！");
            } else {
                console.error("找不到代號輸入框！");
            }
        }, 1000);
        // ====================================================
        // --- 🚀 結束 ---

        // 生成或獲取設備ID
        function getDeviceId() {
            if (!currentDeviceId) {
                let deviceId = localStorage.getItem('kite_device_id');
                if (!deviceId) {
                    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    localStorage.setItem('kite_device_id', deviceId);
                }
                currentDeviceId = deviceId;
            }
            return currentDeviceId;
        }

        // 更新用戶會話信息
        async function updateUserSession(userId) {
            const deviceId = getDeviceId();
            const sessionRef = doc(db, "users", userId, "session", "current");
            await setDoc(sessionRef, {
                deviceId: deviceId,
                lastActive: serverTimestamp(),
                userAgent: navigator.userAgent,
                platform: navigator.platform
            }, { merge: true });
        }

        // 監聽會話變化，如果其他設備登入則登出當前設備
        function monitorSession(userId) {
            // 清理之前的定時器和事件監聽器
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            if (visibilityHandler) {
                document.removeEventListener('visibilitychange', visibilityHandler);
                visibilityHandler = null;
            }

            const sessionRef = doc(db, "users", userId, "session", "current");
            unsubscribeSession = onSnapshot(sessionRef, async (snapshot) => {
                if (snapshot.exists()) {
                    const sessionData = snapshot.data();
                    const currentDeviceId = getDeviceId();

                    // 如果會話中的設備ID與當前設備不同，說明其他設備登入了
                    if (sessionData.deviceId && sessionData.deviceId !== currentDeviceId) {
                        // 清理定時器和事件監聽器
                        if (keepAliveInterval) {
                            clearInterval(keepAliveInterval);
                            keepAliveInterval = null;
                        }
                        if (visibilityHandler) {
                            document.removeEventListener('visibilitychange', visibilityHandler);
                            visibilityHandler = null;
                        }
                        // 強制登出當前設備
                        alert('偵測到您已在其他設備登入，此設備將自動登出。');
                        await signOut(auth);
                        location.reload();
                    }
                }
            }, (error) => {
                console.error("Session monitoring error:", error);
            });

            // 定期更新會話活躍時間（每30秒）
            keepAliveInterval = setInterval(async () => {
                if (currentUser && currentUser.uid === userId) {
                    await updateUserSession(userId);
                } else {
                    if (keepAliveInterval) {
                        clearInterval(keepAliveInterval);
                        keepAliveInterval = null;
                    }
                }
            }, 30000);

            // 頁面可見性變化時也更新會話（只添加一次）
            if (!visibilityHandler) {
                visibilityHandler = async () => {
                    if (!document.hidden && currentUser && currentUser.uid === userId) {
                        await updateUserSession(userId);
                    }
                };
                document.addEventListener('visibilitychange', visibilityHandler);
            }
        }

        // --- 手續費計算核心 ---
        window.getFeeSettings = () => {
            const saved = localStorage.getItem('kite_fee_settings');
            const defaults = { discount: 1.7, minFee: 1, initialCapital: 1000000 };

            if (saved) {
                try {
                    const savedSettings = JSON.parse(saved);
                    // 將儲存的設定與預設值合併，確保所有欄位都存在
                    return { ...defaults, ...savedSettings };
                } catch (e) {
                    console.error("讀取設定失敗，使用預設值。", e);
                    return defaults; // 如果解析失敗，回傳預設值
                }
            }
            return defaults; // 如果沒有儲存過，回傳預設值
        };

        window.openSettingsModal = () => {
            const s = window.getFeeSettings();
            document.getElementById('setting-discount').value = s.discount;
            document.getElementById('setting-min-fee').value = s.minFee;
            document.getElementById('setting-initial-capital').value = s.initialCapital || 0;
            document.getElementById('user-menu').classList.add('hidden');
            document.getElementById('settingsModal').classList.remove('hidden');
        };

        window.closeSettingsModal = () => document.getElementById('settingsModal').classList.add('hidden');

        window.saveSettings = () => {
            const discount = parseFloat(document.getElementById('setting-discount').value) || 1.7;
            const minFee = parseInt(document.getElementById('setting-min-fee').value) || 1;
            const initialCapital = parseInt(document.getElementById('setting-initial-capital').value) || 0;
            localStorage.setItem('kite_fee_settings', JSON.stringify({ discount, minFee, initialCapital }));
            closeSettingsModal();
            renderHistory();
            updateGlobalStats();
            renderStrategyPage();
            alert('費率已更新！所有損益已重新計算。');
        };

        window.calculateCost = (price, qty, type) => {
            const s = window.getFeeSettings();
            const feeRate = 0.001425 * (s.discount / 10);
            const rawFee = Math.floor(price * qty * feeRate);
            const finalFee = Math.max(s.minFee, rawFee);
            const tax = type === 'sell' ? Math.floor(price * qty * 0.003) : 0;
            return finalFee + tax;
        };

        window.calculateNetPnL = (buyPrice, sellPrice, qty) => {
            const buyCost = (buyPrice * qty) + window.calculateCost(buyPrice, qty, 'buy');
            const sellRevenue = (sellPrice * qty) - window.calculateCost(sellPrice, qty, 'sell');
            return sellRevenue - buyCost;
        };

        // 計算包含手續費的平均成本
        window.calculateAveragePriceWithFee = (price, qty) => {
            const totalCost = (price * qty) + window.calculateCost(price, qty, 'buy');
            return totalCost / qty;
        };

        // 計算多筆交易的平均成本（含手續費）
        window.calculateWeightedAverage = (oldAvgPrice, oldQty, newPrice, newQty) => {
            const oldTotalCost = (oldAvgPrice * oldQty) + window.calculateCost(oldAvgPrice, oldQty, 'buy');
            const newTotalCost = (newPrice * newQty) + window.calculateCost(newPrice, newQty, 'buy');
            const totalQty = oldQty + newQty;
            return (oldTotalCost + newTotalCost) / totalQty;
        };
        // ---------------------------

        window.handleGoogleLogin = async () => {
            const btn = document.getElementById('btn-google');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i data-lucide="loader-2" class="w-6 h-6 animate-spin"></i> 登入中...`;
            lucide.createIcons();
            try {
                const result = await signInWithPopup(auth, provider);
                // 登入成功後更新會話信息
                if (result.user) {
                    await updateUserSession(result.user.uid);
                }
            } catch (error) {
                console.error("Login Failed:", error);
                alert("登入失敗: " + error.message);
                btn.innerHTML = originalText;
                lucide.createIcons();
            }
        };

        window.handleLogout = async () => {
            // 清理會話監聽、定時器和事件監聽器
            if (unsubscribeSession) {
                unsubscribeSession();
                unsubscribeSession = null;
            }
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            if (visibilityHandler) {
                document.removeEventListener('visibilitychange', visibilityHandler);
                visibilityHandler = null;
            }
            await signOut(auth);
            location.reload();
        };

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;

                // 更新會話信息（確保會話是最新的）
                await updateUserSession(user.uid);

                // 開始監聽會話變化
                monitorSession(user.uid);

                document.getElementById('login-overlay').classList.add('hidden');
                document.getElementById('app-content').classList.remove('blur-login');
                if(user.photoURL) document.getElementById('user-avatar').src = user.photoURL;
                if(user.displayName) document.getElementById('menu-user-name').textContent = user.displayName;
                subscribeToTrades(user.uid);
                subscribeToDailyLogs(user.uid);
                // 🚀 步驟 4：登入成功，開始抓股價！
                window.updateStockData();
            } else {
                // 清理會話監聽、定時器和事件監聽器
                if (unsubscribeSession) {
                    unsubscribeSession();
                    unsubscribeSession = null;
                }
                if (keepAliveInterval) {
                    clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                }
                if (visibilityHandler) {
                    document.removeEventListener('visibilitychange', visibilityHandler);
                    visibilityHandler = null;
                }

                document.getElementById('login-overlay').classList.remove('hidden');
                document.getElementById('app-content').classList.add('blur-login');
                if(unsubscribe) unsubscribe();
                if(unsubscribeLogs) unsubscribeLogs();
                trades = [];
                dailyLogs = {};
                renderPortfolio();
            }
        });

        function subscribeToTrades(userId) {
            const q = query(collection(db, "users", userId, "trades"), orderBy("createdAt", "desc"));
            unsubscribe = onSnapshot(q, (snapshot) => {
                trades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                renderPortfolio();
                renderHistory();
                updateGlobalStats();
                if(!document.getElementById('page-journal').classList.contains('hidden')) renderCalendar();
            });
        }

        function subscribeToDailyLogs(userId) {
            const q = collection(db, "users", userId, "dailyLogs");
            unsubscribeLogs = onSnapshot(q, (snapshot) => {
                dailyLogs = {};
                snapshot.docs.forEach(doc => {
                    dailyLogs[doc.id] = doc.data();
                });
                if(!document.getElementById('page-journal').classList.contains('hidden')) {
                    renderCalendar();
                    selectDate(window.selectedDate);
                }
            });
        }

        window.handleTradeSubmit = async () => {
            if(!currentUser) return alert("請先登入");
            const idx = document.getElementById('subStrategyInput').value;
            const price = parseFloat(document.getElementById('entryPrice').value);
            const qty = parseInt(document.getElementById('quantity').value);

            // 計算包含手續費的平均成本
            const avgPriceWithFee = window.calculateAveragePriceWithFee(price, qty);

            const newTrade = {
                persona: window.currentPersona,
                strategyIdx: idx,
                strategyName: personas[window.currentPersona].options[idx].name,
                symbolCode: document.getElementById('symbolCode').value,
                symbolName: document.getElementById('symbolName').value,
                averagePrice: avgPriceWithFee,
                totalQuantity: qty,
                entryPrice: price,
                quantity: qty,
                entryDate: document.getElementById('entryDate').value,
                entryWind: document.getElementById('entryWindInput').value,
                note: document.getElementById('note').value,
                screenshot: window.tempScreenshot || null,
                status: 'open',
                history: [{ type: 'buy', date: document.getElementById('entryDate').value, price, quantity: qty, wind: document.getElementById('entryWindInput').value, note: document.getElementById('note').value, screenshot: window.tempScreenshot || null, timestamp: Date.now() }],
                createdAt: Date.now()
            };

            const btn = document.querySelector('#tradeForm button');
            const oldText = btn.innerHTML;
            btn.innerHTML = '儲存中...';
            try {
                await addDoc(collection(db, "users", currentUser.uid, "trades"), newTrade);
                // 🚀 步驟 3：儲存時同步通知 Google Sheet
                window.syncToSheet(newTrade);
                document.getElementById('tradeForm').reset();
                window.tempScreenshot = null;
                document.getElementById('upload-preview-container').classList.add('hidden');
                document.getElementById('upload-placeholder').classList.remove('hidden');
                document.getElementById('form-container').classList.add('hidden');
                document.querySelectorAll('.persona-card').forEach(c => c.classList.remove('selected'));
                switchTab('portfolio');
            } catch(e) {
                alert("儲存失敗");
                console.error(e);
            } finally {
                btn.innerHTML = oldText;
            }
        };

        window.confirmAddPosition = async () => {
            if(!window.tradeToAddId) return;
            const price = parseFloat(document.getElementById('addPosPrice').value);
            const qty = parseInt(document.getElementById('addPosQty').value);
            const t = trades.find(item => item.id === window.tradeToAddId);
            if (t && price && qty) {
                // 舊的總成本（如果 averagePrice 已含手續費，則直接使用；否則需要加上手續費）
                // 為了安全起見，我們假設 averagePrice 可能已含手續費，所以直接用它計算舊總成本
                const oldTotalCost = t.averagePrice * t.totalQuantity;
                // 新的總成本（含手續費）
                const newTotalCost = (price * qty) + window.calculateCost(price, qty, 'buy');
                const newTotalQty = t.totalQuantity + qty;
                const newAvg = (oldTotalCost + newTotalCost) / newTotalQty;
                const newHistory = [...t.history, { type: 'buy', date: document.getElementById('addPosDate').value, price, quantity: qty, wind: '加碼', note: document.getElementById('addPosNote').value, timestamp: Date.now() }];
                await updateDoc(doc(db, "users", currentUser.uid, "trades", t.id), { totalQuantity: newTotalQty, averagePrice: newAvg, history: newHistory });
                closeAddPositionModal();
            }
        };

        window.confirmSellAction = async () => {
             if(!window.tradeToSellId) return;
             const price = parseFloat(document.getElementById('sellPrice').value);
             const qty = parseInt(document.getElementById('sellQty').value);
             const t = trades.find(item => item.id === window.tradeToSellId);
             if (t && price && qty) {
                const newQty = t.totalQuantity - qty;
                const newHistory = [...t.history, { type: 'sell', date: document.getElementById('sellDate').value, price, quantity: qty, wind: document.getElementById('exitWindInput').value, note: document.getElementById('sellNote').value, timestamp: Date.now() }];
                const updateData = { totalQuantity: newQty, history: newHistory };
                if (newQty <= 0) {
                    updateData.status = 'closed';
                    updateData.exitPrice = price;
                    updateData.exitDate = document.getElementById('sellDate').value;
                    updateData.exitWind = document.getElementById('exitWindInput').value;
                }
                await updateDoc(doc(db, "users", currentUser.uid, "trades", t.id), updateData);
                closeModal();
                if(newQty <= 0) switchTab('history');
             }
        };

        window.confirmAction = async () => {
            if(window.tradeToDeleteId) {
                await deleteDoc(doc(db, "users", currentUser.uid, "trades", window.tradeToDeleteId));
            }
            closeConfirmModal();
        };

        window.currentPersona = '';
        window.tradeToSellId = null;
        window.tradeToAddId = null;
        window.tradeToDeleteId = null;
        window.filterDates = { start: null, end: null };
        window.tempScreenshot = null;
        window.currentYear = new Date().getFullYear();
        window.currentMonth = new Date().getMonth();

        window.getLocalISODate = () => {
            const d = new Date();
            const offset = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - offset).toISOString().split('T')[0];
        };
        window.selectedDate = window.getLocalISODate();

        window.switchTab = (t) => {
            ['add','portfolio','history','strategy', 'journal'].forEach(p=>{
                document.getElementById(`page-${p}`).classList.add('hidden');
                document.getElementById(`tab-${p}`).classList.remove('active');
            });
            document.getElementById(`page-${t}`).classList.remove('hidden');
            document.getElementById(`tab-${t}`).classList.add('active');
            if(t==='strategy') renderStrategyPage();
            if(t==='journal') renderJournalPage();
            window.scrollTo(0,0);
        };

        window.toggleUserMenu = () => document.getElementById('user-menu').classList.toggle('hidden');
        window.toggleThemeMenu = () => document.getElementById('theme-menu').classList.toggle('hidden');

        // 應用主題的實際邏輯
        window.applyTheme = (theme) => {
            const h = document.documentElement;
            if (theme === 'dark') {
                h.classList.add('dark');
            } else if (theme === 'light') {
                h.classList.remove('dark');
            } else {
                // system mode - 跟隨系統設定
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (prefersDark) {
                    h.classList.add('dark');
                } else {
                    h.classList.remove('dark');
                }
            }
        };

        // 設置主題並保存
        window.setTheme = (m) => {
            if (m === 'dark') {
                localStorage.setItem('kite_theme', 'dark');
            } else if (m === 'light') {
                localStorage.setItem('kite_theme', 'light');
            } else {
                // system mode
                localStorage.removeItem('kite_theme');
            }
            window.applyTheme(m);
            document.getElementById('theme-menu').classList.add('hidden');
            updateThemeIcons();
        };

        // 監聽系統主題變化
        window.setupSystemThemeListener = () => {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = (e) => {
                const currentTheme = localStorage.getItem('kite_theme') || 'system';
                if (currentTheme === 'system') {
                    window.applyTheme('system');
                }
            };
            // 使用 addEventListener 監聽變化（現代瀏覽器）
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', handleChange);
            } else {
                // 舊版瀏覽器使用 addListener
                mediaQuery.addListener(handleChange);
            }
        };

        window.updateThemeIcons = () => {
            document.getElementById('theme-icon-light').classList.add('hidden');
            document.getElementById('theme-icon-dark').classList.add('hidden');
            document.getElementById('theme-icon-auto').classList.add('hidden');
            const s = localStorage.getItem('kite_theme') || 'system';
            if (s === 'light') {
                document.getElementById('theme-icon-light').classList.remove('hidden');
            } else if (s === 'dark') {
                document.getElementById('theme-icon-dark').classList.remove('hidden');
            } else {
                document.getElementById('theme-icon-auto').classList.remove('hidden');
            }
        };
        window.showFilterModal = () => document.getElementById('filterModal').classList.remove('hidden');
        window.hideFilterModal = () => document.getElementById('filterModal').classList.add('hidden');
        window.quickSetDate = (type) => { const today = new Date(); let s = new Date(), e = new Date(); if (type === 'thisMonth') { s = new Date(today.getFullYear(), today.getMonth(), 1); } else if (type === 'lastMonth') { s = new Date(today.getFullYear(), today.getMonth() - 1, 1); e = new Date(today.getFullYear(), today.getMonth(), 0); } else if (type === 'thisYear') { s = new Date(today.getFullYear(), 0, 1); } else if (type === 'last30') { s.setDate(today.getDate() - 30); } const fmt = d => d.toISOString().split('T')[0]; document.getElementById('filterStartDate').value = fmt(s); document.getElementById('filterEndDate').value = fmt(e); };
        window.applyDateFilter = () => { window.filterDates.start = document.getElementById('filterStartDate').value; window.filterDates.end = document.getElementById('filterEndDate').value; hideFilterModal(); renderHistory(); updateGlobalStats(); };
        window.resetDateFilter = () => { window.filterDates = {start:null, end:null}; document.getElementById('filterStartDate').value=''; document.getElementById('filterEndDate').value=''; hideFilterModal(); renderHistory(); updateGlobalStats(); };
        window.showWindHelp = () => document.getElementById('windHelpModal').classList.remove('hidden');
        window.hideWindHelp = () => document.getElementById('windHelpModal').classList.add('hidden');
        window.showPersonaHelp = () => document.getElementById('personaHelpModal').classList.remove('hidden');
        window.hidePersonaHelp = () => document.getElementById('personaHelpModal').classList.add('hidden');
        window.closeImageModal = () => document.getElementById('imageModal').classList.add('hidden');

        window.openImageModal = (src) => {
            document.getElementById('fullImage').src = src;
            document.getElementById('imageModal').classList.remove('hidden');
        };

        window.selectWind = (phase, w) => { document.querySelectorAll(`#${phase==='entry'?'entryWindContainer':'exitWindContainer'} .wind-card`).forEach(c=>c.classList.remove('selected')); document.querySelector(`#${phase==='entry'?'entryWindContainer':'exitWindContainer'} .wind-card.${w}`).classList.add('selected'); document.getElementById(`${phase==='entry'?'entryWindInput':'exitWindInput'}`).value=w; };

        window.selectPersona = (p) => { window.currentPersona=p; document.querySelectorAll('.persona-card').forEach(c=>c.classList.remove('selected')); document.getElementById(`p-${p}`).classList.add('selected'); document.getElementById('form-container').classList.remove('hidden'); document.getElementById('persona-indicator').style.backgroundColor=personas[p].color; const container=document.getElementById('subStrategyContainer'); container.innerHTML = personas[p].options.map((o,i)=>`<div onclick="selectStrategy(${i})" id="strat-${i}" class="cursor-pointer bg-slate-50 dark:bg-slate-800 border-2 border-transparent p-3 rounded-2xl flex items-center gap-2 btn-press"><div class="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 flex items-center justify-center strategy-check"><div class="w-2 h-2 rounded-full bg-white opacity-0 strategy-dot"></div></div><span class="font-black text-xs text-slate-600 dark:text-slate-300">${o.name}</span></div>`).join(''); selectStrategy(0); document.getElementById('entryDate').valueAsDate = new Date(); selectWind('entry','強風'); };
        window.selectStrategy = (i) => { document.getElementById('subStrategyInput').value=i; document.querySelectorAll('#subStrategyContainer > div').forEach(c=>{ c.classList.remove('border-indigo-500','bg-indigo-50','dark:bg-indigo-900/20'); c.querySelector('.strategy-check').classList.remove('bg-indigo-600','border-indigo-600'); c.querySelector('.strategy-dot').classList.remove('opacity-100'); }); const s=document.getElementById(`strat-${i}`); if(s){ s.classList.add('border-indigo-500','bg-indigo-50','dark:bg-indigo-900/20'); const c=s.querySelector('.strategy-check'); c.classList.add('bg-indigo-600','border-indigo-600'); c.querySelector('.strategy-dot').classList.add('opacity-100'); updateSubSop(); } };
        window.updateSubSop = () => { const i=document.getElementById('subStrategyInput').value; if(i==="")return; const o=personas[window.currentPersona].options[i]; document.getElementById('persona-summary-text').textContent=o.summary; document.getElementById('rule-sl').textContent=o.sl; document.getElementById('rule-tp').textContent=o.tp; };

        window.handleImageUpload = (e) => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{ const img=new Image(); img.src=ev.target.result; img.onload=()=>{ const c=document.createElement('canvas'); const ctx=c.getContext('2d'); const s=800/img.width; const w=(s<1)?800:img.width; const h=(s<1)?img.height*s:img.height; c.width=w; c.height=h; ctx.drawImage(img,0,0,w,h); window.tempScreenshot=c.toDataURL('image/jpeg',0.5); document.getElementById('upload-preview').src=window.tempScreenshot; document.getElementById('upload-placeholder').classList.add('hidden'); document.getElementById('upload-preview-container').classList.remove('hidden'); }}; r.readAsDataURL(f); };
        window.clearImage = (e) => { e.preventDefault(); window.tempScreenshot=null; document.getElementById('tradeScreenshot').value=''; document.getElementById('upload-preview').src=''; document.getElementById('upload-preview-container').classList.add('hidden'); document.getElementById('upload-placeholder').classList.remove('hidden'); };

        window.openSellModal = (id) => {
            window.tradeToSellId=id;
            const t=trades.find(item=>item.id===id);
            document.getElementById('sellModal').classList.remove('hidden');
            document.getElementById('sellPrice').value='';
            document.getElementById('sellQty').value=t.totalQuantity;
            document.getElementById('sellQty').max=t.totalQuantity;
            document.getElementById('sellNote').value='';
            document.getElementById('sell-current-qty').textContent=t.totalQuantity.toLocaleString();
            document.getElementById('sell-avg-cost').textContent='$'+t.averagePrice.toFixed(2);

            // 計算已付手續費
            let totalFeesPaid = 0;
            t.history.forEach(h => {
                if(h.type === 'buy') {
                    totalFeesPaid += window.calculateCost(h.price, h.quantity, 'buy');
                }
            });
            document.getElementById('sell-paid-fee').textContent='$'+totalFeesPaid.toLocaleString();

            document.getElementById('sellDate').valueAsDate=new Date();
            document.getElementById('sell-estimate').classList.add('hidden');
            selectWind('exit','強風');
            updateSellEstimate();
        };

        window.updateSellEstimate = () => {
            if(!window.tradeToSellId) return;
            const t = trades.find(item => item.id === window.tradeToSellId);
            const price = parseFloat(document.getElementById('sellPrice').value);
            const qty = parseInt(document.getElementById('sellQty').value);
            const el = document.getElementById('sell-estimate');

            if(price && qty && t) {
                const sellFee = window.calculateCost(price, qty, 'sell');
                const netPnL = window.calculateNetPnL(t.averagePrice, price, qty);
                const colorClass = netPnL >= 0 ? 'text-red-500' : 'text-green-600';
                document.getElementById('sell-estimate-val').innerHTML = `
                    <div class="space-y-1.5">
                        <div class="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400">
                            <span>賣出手續費+稅:</span>
                            <span class="font-black">$${sellFee.toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs font-bold ${colorClass} pt-1 border-t border-slate-200 dark:border-slate-700">
                            <span>預估淨損益:</span>
                            <span class="font-black text-base">${netPnL >= 0 ? '+' : ''}$${Math.round(netPnL).toLocaleString()}</span>
                        </div>
                    </div>
                `;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        };

        window.closeModal = () => { document.getElementById('sellModal').classList.add('hidden'); window.tradeToSellId=null; };

        window.addPosition = (id) => { window.tradeToAddId=id; document.getElementById('addPositionModal').classList.remove('hidden'); document.getElementById('addPosPrice').value=''; document.getElementById('addPosQty').value=''; document.getElementById('addPosNote').value=''; document.getElementById('addPosDate').valueAsDate=new Date(); };
        window.closeAddPositionModal = () => { document.getElementById('addPositionModal').classList.add('hidden'); window.tradeToAddId=null; };

        window.requestDelete = (id) => { window.tradeToDeleteId=id; document.getElementById('confirmModal').classList.remove('hidden'); };
        window.closeConfirmModal = () => { document.getElementById('confirmModal').classList.add('hidden'); window.tradeToDeleteId=null; };

        window.viewDetails = (id) => {
            const t = trades.find(item => item.id === id);
            if(!t) return;
            document.getElementById('detail-title').textContent = `${t.symbolCode} ${t.symbolName}`;
            document.getElementById('detail-subtitle').textContent = `均價 $${t.averagePrice.toFixed(2)} / 持倉 ${t.totalQuantity}股`;
            const list = document.getElementById('detail-list');
            let currentCost = 0, currentQty = 0, avgPrice = 0;

            // Map with original index to ensure robust editing even if sorted or timestamps missing
            const historyWithIndex = t.history.map((h, i) => ({ ...h, originalIndex: i }));
            const sortedHistory = historyWithIndex.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));

            const htmlItems = sortedHistory.map(h => {
                let pnlDisplay = '';
                let feeDisplay = '';
                if(h.type === 'buy') {
                    // 買入時，總成本包含手續費
                    const buyFee = window.calculateCost(h.price, h.quantity, 'buy');
                    const buyCost = (h.price * h.quantity) + buyFee;
                    currentCost += buyCost;
                    currentQty += h.quantity;
                    avgPrice = currentCost / currentQty;
                    feeDisplay = `<div class="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400"><span class="font-bold">手續費:</span> <span class="font-black">$${buyFee.toLocaleString()}</span></div>`;
                } else if(h.type === 'sell') {
                    let cost = avgPrice * h.quantity;
                    const sellFee = window.calculateCost(h.price, h.quantity, 'sell');
                    let realizedPnL = window.calculateNetPnL(avgPrice, h.price, h.quantity);
                    let pct = cost > 0 ? ((realizedPnL / cost) * 100).toFixed(1) : 0;
                    const pnlClass = realizedPnL >= 0 ? 'text-red-500' : 'text-green-600';
                    feeDisplay = `<div class="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400"><span class="font-bold">手續費+稅:</span> <span class="font-black">$${sellFee.toLocaleString()}</span></div>`;
                    pnlDisplay = `<div class="mt-2 pt-2 border-t dark:border-slate-700 flex justify-between items-center text-xs font-bold ${pnlClass}"><span>淨損益: ${realizedPnL >= 0 ? '+' : ''}$${Math.round(realizedPnL).toLocaleString()} (${pct}%)</span></div>`;
                    currentCost -= avgPrice * h.quantity;
                    currentQty -= h.quantity;
                }

                const imageHtml = h.screenshot
                    ? `<div onclick="openImageModal('${h.screenshot}')" class="mt-2 h-16 w-24 rounded-xl bg-slate-100 dark:bg-slate-800 bg-cover bg-center border border-slate-200 dark:border-slate-700 cursor-pointer relative group overflow-hidden" style="background-image: url('${h.screenshot}')">
                         <div class="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <div class="bg-black/50 text-white p-1.5 rounded-full backdrop-blur-md"><i data-lucide="zoom-in" class="w-3 h-3"></i></div>
                         </div>
                       </div>`
                    : '';

                // Use originalIndex for ID and handlers
                const idx = h.originalIndex;

                return `<div class="p-4 rounded-2xl border ${h.type === 'buy' ? 'bg-indigo-50/50 border-indigo-100 dark:bg-indigo-900/10 dark:border-indigo-900/30' : 'bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded ${h.type === 'buy' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300'}">${h.type === 'buy' ? '買進' : '賣出'}</span>
                        <span class="text-[10px] text-slate-400 font-bold">${h.date}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm font-black text-slate-700 dark:text-slate-200">${h.quantity}股 @ $${h.price}</span>
                        <span class="text-[10px] font-bold text-slate-400">${h.wind || '-'}</span>
                    </div>
                    ${feeDisplay}

                    <div id="note-view-${idx}" class="group relative">
                        <p class="text-sm font-bold text-slate-700 dark:text-slate-300 mt-2 leading-relaxed border-t border-dashed border-slate-200 dark:border-slate-700 pt-2 whitespace-pre-wrap">${window.escapeHtml(h.note) || '<span class="text-slate-400 italic font-normal text-xs">無備註</span>'}</p>
                        <button onclick="toggleEditNote('${t.id}', ${idx})" class="absolute top-2 right-0 p-1 text-slate-300 hover:text-indigo-500 transition-colors"><i data-lucide="edit-2" class="w-3 h-3"></i></button>
                    </div>

                    <div id="note-edit-${idx}" class="hidden mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700">
                        <textarea id="note-input-${idx}" rows="2" class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-sm font-bold focus:ring-2 focus:ring-indigo-500 mb-2">${h.note || ''}</textarea>
                        <div class="flex justify-end gap-2">
                            <button onclick="toggleEditNote('${t.id}', ${idx})" class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">取消</button>
                            <button onclick="saveHistoryNote('${t.id}', ${idx})" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">儲存</button>
                        </div>
                    </div>

                    ${imageHtml}
                    ${pnlDisplay}
                </div>`;
            });
            list.innerHTML = htmlItems.reverse().join('');
            lucide.createIcons();
            document.getElementById('detailsModal').classList.remove('hidden');
        };

        window.closeDetailsModal = () => document.getElementById('detailsModal').classList.add('hidden');

        window.toggleEditNote = (tradeId, idx) => {
            const viewEl = document.getElementById(`note-view-${idx}`);
            const editEl = document.getElementById(`note-edit-${idx}`);
            if(viewEl && editEl) {
                viewEl.classList.toggle('hidden');
                editEl.classList.toggle('hidden');
            }
        };

        window.saveHistoryNote = async (tradeId, idx) => {
            const t = trades.find(item => item.id === tradeId);
            if(!t) return;

            const newContent = document.getElementById(`note-input-${idx}`).value;
            // Directly modify the item at original index
            const newHistory = [...t.history];
            if(newHistory[idx]) {
                newHistory[idx] = { ...newHistory[idx], note: newContent };
            } else {
                return; // Index out of bounds?
            }

            try {
                await updateDoc(doc(db, "users", currentUser.uid, "trades", tradeId), { history: newHistory });

                // Simple DOM update:
                const viewEl = document.getElementById(`note-view-${idx}`);
                const pEl = viewEl.querySelector('p');
                if (newContent) {
                    pEl.textContent = newContent;
                } else {
                    pEl.innerHTML = '<span class="text-slate-400 italic font-normal text-xs">無備註</span>';
                }
                document.getElementById(`note-input-${idx}`).value = newContent;

                window.toggleEditNote(tradeId, idx);
            } catch(e) {
                console.error("Error updating note:", e);
                alert("更新失敗");
            }
        };

        // Journal Logic
        window.renderJournalPage = () => {
            renderCalendar();
            selectDate(window.selectedDate);
        };

        window.renderCalendar = () => {
            const container = document.getElementById('calendar-container');
            const year = window.currentYear;
            const month = window.currentMonth;

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

            let html = `
                <div class="flex items-center justify-between mb-6">
                    <button onclick="prevMonth()" class="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><i data-lucide="chevron-left" class="w-6 h-6 text-slate-400"></i></button>
                    <h3 class="text-xl font-black text-slate-800 dark:text-slate-100">${year}年 ${monthNames[month]}</h3>
                    <button onclick="nextMonth()" class="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><i data-lucide="chevron-right" class="w-6 h-6 text-slate-400"></i></button>
                </div>

                <div class="grid grid-cols-7 gap-1 mb-2">
                    ${['日','一','二','三','四','五','六'].map(d => `<div class="text-center text-[10px] font-black text-slate-400 py-2">${d}</div>`).join('')}
                </div>

                <div class="grid grid-cols-7 gap-1">
            `;

            // Empty cells before first day
            for (let i = 0; i < firstDay; i++) {
                html += `<div></div>`;
            }

            // Days
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = dateStr === window.selectedDate;
                const isToday = dateStr === window.getLocalISODate();
                const hasLog = dailyLogs[dateStr] && dailyLogs[dateStr].content;
                const hasTrade = trades.some(t => t.entryDate === dateStr || t.exitDate === dateStr || t.history.some(h => h.date === dateStr));

                let bgClass = isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : (isToday ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300');

                html += `
                    <div onclick="selectDate('${dateStr}')" class="aspect-square rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all btn-press relative ${bgClass}">
                        <span class="text-sm font-black">${day}</span>
                        <div class="flex gap-0.5 mt-1">
                            ${hasTrade ? `<div class="w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-red-500'}"></div>` : ''}
                            ${hasLog ? `<div class="w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-green-500'}"></div>` : ''}
                        </div>
                    </div>
                `;
            }

            html += `</div>`;
            container.innerHTML = html;
            lucide.createIcons();
        };

        window.prevMonth = () => {
            window.currentMonth--;
            if(window.currentMonth < 0) { window.currentMonth = 11; window.currentYear--; }
            renderCalendar();
        };

        window.nextMonth = () => {
            window.currentMonth++;
            if(window.currentMonth > 11) { window.currentMonth = 0; window.currentYear++; }
            renderCalendar();
        };

        window.selectDate = (dateStr) => {
            window.selectedDate = dateStr;
            renderCalendar(); // Re-render to update selected style

            document.getElementById('daily-log-editor').classList.remove('hidden');
            document.getElementById('journal-date-title').textContent = dateStr.replace(/-/g, '/');

            // Check content
            const log = dailyLogs[dateStr];
            document.getElementById('journal-content').value = log ? log.content : '';

            // Status text
            const tradeCount = trades.filter(t => t.entryDate === dateStr || t.exitDate === dateStr || t.history.some(h => h.date === dateStr)).length;
            const statusText = [];
            if(tradeCount > 0) statusText.push(`${tradeCount} 筆交易活動`);
            if(log) statusText.push(`已寫日誌`);
            document.getElementById('journal-status').textContent = statusText.join(' • ');
        };

        window.saveDailyLog = async () => {
            if(!currentUser) return alert("請先登入");
            const dateStr = window.selectedDate;
            const content = document.getElementById('journal-content').value;

            const btn = document.querySelector('#daily-log-editor button');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 儲存中...`;
            lucide.createIcons();

            try {
                await setDoc(doc(db, "users", currentUser.uid, "dailyLogs", dateStr), {
                    content: content,
                    updatedAt: serverTimestamp()
                }, { merge: true });

                // Update local cache immediately for better UX
                dailyLogs[dateStr] = { ...dailyLogs[dateStr], content: content };
                renderCalendar();
                selectDate(dateStr); // Refresh status text

                // Show success feedback
                btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> 已儲存`;
                btn.classList.add('bg-green-600');
                lucide.createIcons();
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('bg-green-600');
                    lucide.createIcons();
                }, 2000);
            } catch (e) {
                console.error("Error saving log:", e);
                alert("儲存失敗");
                btn.innerHTML = originalText;
                lucide.createIcons();
            }
        };

        // Strategy Logic
        window.renderStrategyPage = () => {
            const closedTrades = trades.filter(t => t.status === 'closed');

            const personaStats = { freelancer: 0, office: 0, boss: 0 };
            const windStats = { 強風: 0, 亂流: 0, 陣風: 0, 無風: 0 };
            const comboStats = {};

            closedTrades.forEach(t => {
                let pnl = 0;
                let exitWind = t.exitWind || '無風';
                t.history.forEach(h => { if(h.type === 'sell') pnl += window.calculateNetPnL(t.averagePrice, h.price, h.quantity); });

                if (personaStats[t.persona] !== undefined) personaStats[t.persona] += pnl;
                if (windStats[exitWind] !== undefined) windStats[exitWind] += pnl;

                const comboKey = `${t.persona}-${exitWind}`;
                if (!comboStats[comboKey]) comboStats[comboKey] = 0;
                comboStats[comboKey] += pnl;
            });

            const bestPersona = Object.entries(personaStats).reduce((a, b) => a[1] > b[1] ? a : b, ['無', -Infinity]);
            const bestWind = Object.entries(windStats).reduce((a, b) => a[1] > b[1] ? a : b, ['無', -Infinity]);
            const worstCombo = Object.entries(comboStats).reduce((a, b) => a[1] < b[1] ? a : b, ['無', Infinity]);

            const personaTitles = { freelancer: '打工型', office: '上班族', boss: '老闆型', '無': '尚未交易' };

            document.getElementById('best-persona').textContent = personaTitles[bestPersona[0]] || '尚未交易';
            document.getElementById('best-wind').textContent = bestWind[0] || '無';

            if (worstCombo[0] !== '無' && worstCombo[1] < 0) {
                const [p, w] = worstCombo[0].split('-');
                document.getElementById('worst-combo').textContent = `${personaTitles[p]} + ${w}`;
                document.getElementById('worst-combo-desc').textContent = `此組合虧損達 $${Math.abs(Math.round(worstCombo[1])).toLocaleString()}，建議避免。`;
            } else {
                document.getElementById('worst-combo').textContent = "表現優良";
                document.getElementById('worst-combo-desc').textContent = "暫無顯著虧損組合。";
            }

            renderStrategyMatrix(closedTrades);
            renderEquityChart();
        };

        function renderStrategyMatrix(closedTrades) {
            const matrix = document.getElementById('strategy-matrix');
            const winds = ['強風', '亂流', '陣風', '無風'];
            const personasList = ['freelancer', 'office', 'boss'];

            let html = `<div class="bg-transparent"></div>`;
            winds.forEach(w => html += `<div class="text-[10px] text-center font-black text-slate-400 uppercase tracking-widest py-2">${w}</div>`);

            personasList.forEach(p => {
                html += `<div class="flex flex-col items-center justify-center gap-1.5">
                    <div class="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs" style="background-color: ${personas[p].color}">
                        <i data-lucide="${getPersonaIcon(p)}" class="w-4 h-4"></i>
                    </div>
                    <span class="text-[10px] font-black text-slate-600 dark:text-slate-300">${personas[p].title}</span>
                </div>`;

                winds.forEach(w => {
                    const tradesInCell = closedTrades.filter(t => t.persona === p && t.exitWind === w);
                    let cellPnl = 0;
                    let winCount = 0;
                    tradesInCell.forEach(t => {
                        let pnl = 0;
                        t.history.forEach(h => { if(h.type === 'sell') pnl += window.calculateNetPnL(t.averagePrice, h.price, h.quantity); });
                        cellPnl += pnl;
                        if(pnl > 0) winCount++;
                    });

                    const winRate = tradesInCell.length > 0 ? Math.round((winCount / tradesInCell.length) * 100) : 0;
                    const bgClass = cellPnl > 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300' : (cellPnl < 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-300' : 'bg-slate-50 dark:bg-slate-800 text-slate-300');

                    html += `
                        <div class="matrix-cell ${bgClass} rounded-xl p-2 flex flex-col items-center justify-center min-h-[60px]">
                            <span class="text-[10px] font-bold">${winRate}%</span>
                            <span class="text-xs font-black">${formatLargeNumber(cellPnl)}</span>
                        </div>
                    `;
                });
            });

            matrix.innerHTML = html;
            lucide.createIcons();
        }

        function getPersonaIcon(p) {
            if(p === 'freelancer') return 'zap';
            if(p === 'office') return 'briefcase';
            return 'crown';
        }

        function renderEquityChart() {
            const ctx = document.getElementById('equityChart').getContext('2d');
            if (chartInstance) chartInstance.destroy();

            const allHistory = [];
            trades.forEach(t => {
                t.history.forEach(h => {
                    if (h.type === 'sell') {
                        const pnl = window.calculateNetPnL(t.averagePrice, h.price, h.quantity);
                        allHistory.push({ date: h.date, pnl: pnl });
                    }
                });
            });

            allHistory.sort((a, b) => new Date(a.date) - new Date(b.date));

            let accumulated = 0;
            const labels = [];
            const dataPoints = [];

            allHistory.forEach(h => {
                accumulated += h.pnl;
                labels.push(h.date.substring(5));
                dataPoints.push(accumulated);
            });

            if (dataPoints.length === 0) { labels.push('Start'); dataPoints.push(0); }

            const isDark = document.documentElement.classList.contains('dark');
            const gridColor = isDark ? '#334155' : '#e2e8f0';
            const textColor = isDark ? '#94a3b8' : '#64748b';

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '累計淨損益',
                        data: dataPoints,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 6 } },
                        y: { grid: { color: gridColor, borderDash: [4, 4] }, ticks: { color: textColor, callback: function(value) { return '$' + formatLargeNumber(value); } } }
                    },
                    interaction: { mode: 'nearest', axis: 'x', intersect: false }
                }
            });
        }

        const personas = {
    freelancer: {
        title: '打工型',
        color: '#3b82f6',
        options: [
            {
                name: '強勢日(追漲策略)',
                summary: '核心：頻繁進出。重點：選營收YOY或成值最強標的，第一/二根紅K，週MACD向上，建議10:00後觀察。',
                sl: '1. 買進3日內未脫離成本(-1~2%)\n2. 虧損達5%',
                tp: '1. 獲利10%以上(放出風箏)\n2. 收盤跌破5日/10日線'
            },
            {
                name: '日拉回(低吸策略)',
                summary: '核心：飆股休息。重點：拉回5日線附近買進。建議分3次買進建立成本。',
                sl: '1. 3~5天沒發動下一波攻勢\n2. 跌破5日線',
                tp: '1. 獲利10%以上\n2. 收盤跌破5日/10日線'
            }
        ]
    },
    office: {
        title: '上班族',
        color: '#6366f1',
        options: [
            {
                name: '強勢週(趨勢策略)',
                summary: '核心：MACD趨勢。重點：參與日MACD剛翻多1-2天，確認週MACD向上。建議11:30後出手。',
                sl: '1. 買進4日內未脫離成本(-1~3%)\n2. 收盤跌破5日線',
                tp: '1. 獲利10%以上\n2. 收盤跌破5日/10日線'
            },
            {
                name: '週趨勢(拉回策略)',
                summary: '核心：易漲循環。重點：參與週MACD剛翻多1-2週，拉回5日線買下跌。',
                sl: '1. 當週五收盤低於上週五\n2. 跌破10日線',
                tp: '1. 獲利10%以上\n2. 週MACD紅柱縮短(週五)\n3. 跌破5週線(5MA)'
            }
        ]
    },
    boss: {
        title: '老闆型',
        color: '#a855f7',
        options: [
            {
                name: '週拉回 / 廉價收購',
                summary: '重點：營收YoY>30%且創高。強風/亂流分3-5批靠近月線買；陣/無風分10-15批破月線買。',
                sl: '1. 月MACD紅柱縮短\n2. 營收YoY轉負\n3. 守季線',
                tp: '1. 週K站不回5週線\n2. 週五收盤比上週五低'
            }
        ]
    }
};        const windColors={'強風':'bg-red-500','亂流':'bg-amber-500','陣風':'bg-blue-500','無風':'bg-slate-400'};
        function formatLargeNumber(n){const a=Math.abs(n);if(a>=1000000000000)return(a/1000000000000).toFixed(2)+'兆';if(a>=100000000)return(a/100000000).toFixed(2)+'億';if(a>=10000)return(a/10000).toFixed(1)+'萬';return Math.round(a).toLocaleString();}
        window.escapeHtml = (text) => {
            if (!text) return text;
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };

        // Initialize UI
        const savedTheme = localStorage.getItem('kite_theme') || 'system';
        setTheme(savedTheme);
        setupSystemThemeListener(); // 設置系統主題變化監聽
        lucide.createIcons();

        // Render Functions
        window.renderPortfolio = () => {
            const list = document.getElementById('portfolio-list');
            const openTrades = trades.filter(t => t.status === 'open').sort((a, b) => b.createdAt - a.createdAt);

            // 取得當前時間
            const now = new Date();
            const updateTimeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 重新整理按鈕
            const refreshHeader = `
                <div class="col-span-full flex justify-end mb-2">
                    <button onclick="updateStockData()" class="flex items-center gap-1 text-[10px] font-bold bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95 transition-all text-slate-500">
                        <i data-lucide="refresh-cw" class="w-3 h-3" id="refresh-btn-icon"></i>
                        <span>更新報價</span>
                    </button>
                </div>`;

            if (openTrades.length === 0) {
                list.innerHTML = refreshHeader + `<div class="col-span-full text-center py-12 text-slate-300 font-bold text-xs border-2 border-dashed rounded-3xl border-slate-100 dark:border-slate-800">無持倉</div>`;
                lucide.createIcons();
                return;
            }

            const cardsHtml = openTrades.map(t => {
                const hasImg = t.history.some(h => h.screenshot);
                const imgIcon = hasImg ? `<i data-lucide="image" class="w-3.5 h-3.5 text-indigo-400"></i>` : '';

                const entryDateObj = new Date(t.entryDate);
                const daysHeld = Math.floor((new Date() - entryDateObj) / (1000 * 60 * 60 * 24));

                // === 修改處：顯示完整年月日 (YYYY/MM/DD) ===
                const entryDateDisplay = t.entryDate.replace(/-/g, '/');

                const livePrice = window.livePrices[t.symbolCode] || t.averagePrice;
                const isLive = !!window.livePrices[t.symbolCode];
                const marketValue = livePrice * t.totalQuantity;
                const costValue = t.averagePrice * t.totalQuantity;
                const unPnl = marketValue - costValue;
                const roi = costValue > 0 ? ((unPnl / costValue) * 100).toFixed(2) : 0;

                const pnlClass = unPnl >= 0 ? 'text-red-500' : 'text-green-500';
                const bgClass = unPnl >= 0 ? 'bg-red-50 dark:bg-red-900/10' : 'bg-green-50 dark:bg-green-900/10';

                return `<div class="bg-white dark:bg-slate-900 p-5 rounded-[2rem] shadow-sm border border-slate-100 dark:border-slate-800 btn-press relative overflow-hidden" onclick="viewDetails('${t.id}')">

                    <div class="absolute right-0 top-0 bottom-0 w-24 ${bgClass} opacity-50 blur-2xl pointer-events-none"></div>

                    <div class="flex justify-between items-start relative z-10 mb-2">
                        <div class="flex flex-col gap-1">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-[9px] font-black px-1.5 py-0.5 rounded text-white shadow-sm" style="background-color: ${personas[t.persona].color}">${personas[t.persona].title}</span>
                                <span class="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">${t.strategyName}</span>
                            </div>

                            <div class="flex items-baseline gap-1.5">
                                <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 leading-none">${t.symbolName}</h3>
                                <span class="text-sm font-bold text-slate-400">${t.symbolCode}</span>
                                ${imgIcon}
                            </div>

                            <div class="flex items-center gap-1 mt-0.5">
                                <i data-lucide="clock" class="w-3 h-3 text-slate-300"></i>
                                <p class="text-[10px] font-bold text-slate-400">${entryDateDisplay} (${daysHeld}天)</p>
                            </div>
                        </div>

                        <div class="text-right">
                            <p class="text-2xl font-black ${pnlClass} tracking-tight">${unPnl >= 0 ? '+' : ''}${Math.round(unPnl).toLocaleString()}</p>
                            <p class="text-xs font-bold ${pnlClass} mb-1">${roi}%</p>
                        </div>
                    </div>

                    <div class="flex justify-between items-end border-t border-slate-50 dark:border-slate-800/50 pt-3 relative z-10">
                        <div class="text-left">
                            <p class="text-[10px] text-slate-300 dark:text-slate-600 font-bold uppercase">成本 / 股數</p>
                            <p class="text-xs font-black text-slate-600 dark:text-slate-400">$${t.averagePrice.toFixed(1)} <span class="text-slate-300">|</span> ${t.totalQuantity}股</p>
                        </div>
                        <div class="text-right">
                            <div class="flex items-center justify-end gap-1">
                                <p class="text-[9px] text-slate-300 dark:text-slate-600 font-bold">${updateTimeStr} 更新</p>
                                ${isLive ? '<span class="relative flex h-1.5 w-1.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span></span>' : ''}
                            </div>
                            <p class="text-sm font-black text-slate-800 dark:text-slate-200">現價 $${livePrice}</p>
                        </div>
                    </div>

                    <div class="flex gap-2 mt-3 pt-2" onclick="event.stopPropagation()">
                        <button onclick="addPosition('${t.id}')" class="flex-1 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-400 px-3 py-2.5 rounded-xl flex items-center justify-center gap-1 transition-colors"><i data-lucide="plus" class="w-3.5 h-3.5"></i><span class="text-[10px] font-black">加碼</span></button>
                        <button onclick="openSellModal('${t.id}')" class="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-3 py-2.5 rounded-xl flex items-center justify-center gap-1 transition-colors"><i data-lucide="log-out" class="w-3.5 h-3.5"></i><span class="text-[10px] font-black">平倉</span></button>

                        <button onclick="requestDelete('${t.id}')" class="bg-red-50 hover:bg-red-100 text-red-500 dark:bg-red-900/20 dark:text-red-400 px-3 py-2.5 rounded-xl flex items-center justify-center transition-colors border border-transparent hover:border-red-200"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>`;
            }).join('');

            list.innerHTML = refreshHeader + cardsHtml;
            lucide.createIcons();
        };
        window.renderHistory = () => {
            const list = document.getElementById('history-list');
            const stats = document.getElementById('history-stats');

            const closedTrades = trades.filter(t => t.status === 'closed').sort((a, b) => {
                const getLastSellTime = (trade) => {
                    const lastSell = [...trade.history].reverse().find(h => h.type === 'sell');
                    if (lastSell && lastSell.timestamp) return lastSell.timestamp;
                    if (trade.exitDate) return new Date(trade.exitDate).getTime();
                    return 0;
                };
                return getLastSellTime(b) - getLastSellTime(a);
            });

            if (closedTrades.length === 0) {
                list.innerHTML = `<div class="text-center py-12 text-slate-300 font-bold text-xs border-2 border-dashed rounded-3xl border-slate-100 dark:border-slate-800">尚無歷史交易</div>`;
                if (stats) stats.innerHTML = '';
                return;
            }

            list.innerHTML = closedTrades.map(t => {
                let totalPnL = 0;
                let totalFees = 0;
                let totalCost = 0;

                t.history.forEach(h => {
                    if(h.type === 'sell') {
                        totalPnL += window.calculateNetPnL(t.averagePrice, h.price, h.quantity);
                        totalFees += window.calculateCost(h.price, h.quantity, 'sell');
                        totalCost += (t.averagePrice * h.quantity);
                    } else if(h.type === 'buy') {
                        totalFees += window.calculateCost(h.price, h.quantity, 'buy');
                    }
                });

                const roi = totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(1) : 0;
                const sign = totalPnL >= 0 ? '+' : '-';
                const exitDateStr = t.exitDate || t.history[t.history.length - 1]?.date || '';

                const start = new Date(t.entryDate);
                const end = new Date(exitDateStr);
                const daysHeld = Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)));

                // === 修改處：顯示完整年月日 (YYYY/MM/DD) ===
                const dateDisplay = t.entryDate.replace(/-/g, '/');

                const pnlClass = totalPnL >= 0 ? 'text-red-500' : 'text-green-600';
                const borderClass = totalPnL >= 0 ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-green-500';

                return `<div class="bg-white dark:bg-slate-900 px-5 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 ${borderClass} btn-press flex justify-between items-center group relative" onclick="viewDetails('${t.id}')">

                    <div class="flex flex-col gap-1.5">
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">${dateDisplay}</span>
                            <span class="text-[9px] font-black px-1.5 py-0.5 rounded text-white" style="background-color: ${personas[t.persona].color}">${personas[t.persona].title}</span>
                        </div>

                        <div class="flex items-baseline gap-1.5">
                            <h3 class="text-base font-black text-slate-800 dark:text-slate-100">${t.symbolName}</h3>
                            <span class="text-xs font-bold text-slate-400">${t.symbolCode}</span>
                        </div>

                        <div class="flex items-center gap-2 text-[10px] text-slate-400 font-bold">
                            <span class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 flex items-center gap-1"><i data-lucide="hourglass" class="w-2.5 h-2.5"></i> ${daysHeld}天</span>
                            <span>費 $${totalFees.toLocaleString()}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-4">
                        <div class="text-right">
                            <p class="text-lg xs:text-xl font-black ${pnlClass}">
                                ${sign}$${formatLargeNumber(totalPnL)}
                                <span class="text-xs font-bold ml-0.5">(${roi}%)</span>
                            </p>
                            <p class="text-[10px] font-bold text-slate-300 dark:text-slate-600">已實現淨利</p>
                        </div>

                        <button onclick="event.stopPropagation(); requestDelete('${t.id}')" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-all">
                            <i data-lucide="trash-2" class="w-5 h-5"></i>
                        </button>
                    </div>

                </div>`;
            }).join('');

            lucide.createIcons();
        };
        // ✅ 貼上這段新的 (包含彈窗開關 + 詳細費用計算)
window.showStatsModal = () => document.getElementById('statsModal').classList.remove('hidden');
        window.closeStatsModal = () => document.getElementById('statsModal').classList.add('hidden');

        window.updateGlobalStats = () => {
            let tPL = 0, tCost = 0;
            let allTimePL = 0; // 用於計算現金流的全時段損益
            let totalBuyFee = 0, totalSellFee = 0, totalTax = 0;
            let winCount = 0, closedCount = 0;

            // --- 新增：未實現損益計算變數 ---
            let tUnrealized = 0;
            let tOpenCost = 0;
            const s = window.getFeeSettings();
            const feeRate = 0.001425 * (s.discount / 10);

            trades.forEach(t => {
                t.history.forEach(h => {
                    if(h.type === 'sell'){
                        const pnl = window.calculateNetPnL(t.averagePrice, h.price, h.quantity);

                        // 1. 累計全時段損益 (算現金用)
                        allTimePL += pnl;

                        // 2. 累計篩選區間損益 (顯示用)
                        if(window.filterDates.start && window.filterDates.end && (h.date < window.filterDates.start || h.date > window.filterDates.end)) return;

                        // 計算費用細項
                        const bFee = Math.max(s.minFee, Math.floor(t.entryPrice * h.quantity * feeRate));
                        const sFee = Math.max(s.minFee, Math.floor(h.price * h.quantity * feeRate));
                        const tax = Math.floor(h.price * h.quantity * 0.003);
                        totalBuyFee += bFee; totalSellFee += sFee; totalTax += tax;

                        // 計算損益
                        let cost = (t.averagePrice * h.quantity);
                        tPL += pnl; tCost += cost;
                        if(pnl > 0) winCount++; closedCount++;
                    }
                });

                // 2. 計算未實現 (Unrealized) - 針對持倉中
                if (t.status === 'open') {
                    const currentPrice = window.livePrices[t.symbolCode] || t.averagePrice;
                    const marketVal = currentPrice * t.totalQuantity;
                    const costVal = t.averagePrice * t.totalQuantity;
                    tUnrealized += (marketVal - costVal);
                    tOpenCost += costVal;
                }
            });

            // 計算資產數據
            const initialCapital = s.initialCapital || 0;
            const availableCash = initialCapital + allTimePL - tOpenCost; // 本金 + 歷史總賺賠 - 目前卡在股票裡的錢
            const marketValue = tOpenCost + tUnrealized; // 持倉成本 + 未實現損益
            const totalAssets = availableCash + marketValue;

            // 更新 Header 卡片數據
            const totalAssetsEl = document.getElementById('header-total-assets');
            if(totalAssetsEl) totalAssetsEl.textContent = `$${formatLargeNumber(totalAssets)}`;

            const initCapEl = document.getElementById('header-initial-capital');
            if(initCapEl) initCapEl.textContent = `$${formatLargeNumber(initialCapital)}`;

            const mktValEl = document.getElementById('header-market-value');
            if(mktValEl) mktValEl.textContent = `$${formatLargeNumber(marketValue)}`;

            const cashEl = document.getElementById('header-available-cash');
            if(cashEl) cashEl.textContent = `$${formatLargeNumber(availableCash)}`;

            // 更新 Header - 已實現損益 (受篩選影響)
            const plEl = document.getElementById('header-total-pl');
            if(plEl){ plEl.textContent = `${tPL >= 0 ? '+' : ''}$${formatLargeNumber(tPL)}`; plEl.className = `text-base font-black ${tPL >= 0 ? 'text-red-500' : 'text-green-600'}`; }

            // 更新 Header - 未實現損益
            const unPlEl = document.getElementById('header-unrealized-pl');
            const unPctEl = document.getElementById('header-unrealized-pct');
            if(unPlEl) {
                unPlEl.textContent = `${tUnrealized >= 0 ? '+' : ''}$${formatLargeNumber(tUnrealized)}`;
                unPlEl.className = `text-base font-black ${tUnrealized >= 0 ? 'text-red-500' : 'text-green-600'}`;
            }
            if(unPctEl) {
                let unRoi = tOpenCost > 0 ? ((tUnrealized / tOpenCost) * 100).toFixed(1) : 0.0;
                unPctEl.textContent = `${unRoi >= 0 ? '+' : ''}${unRoi}%`;
                unPctEl.className = `text-[10px] font-bold ${unRoi >= 0 ? 'text-red-400' : 'text-green-500'}`;
            }

            // 更新彈窗數據 (把算好的費用填進去)
            const winStr = closedCount > 0 ? ((winCount / closedCount) * 100).toFixed(0) + '%' : '0%';
            const totalFees = totalBuyFee + totalSellFee;
            document.getElementById('modal-net-pnl').textContent = `${tPL >= 0 ? '+' : ''}$${formatLargeNumber(tPL)}`;
            document.getElementById('modal-net-pnl').className = `text-3xl font-black ${tPL >= 0 ? 'text-red-500' : 'text-green-600'}`;
            document.getElementById('modal-total-fee').textContent = `$${formatLargeNumber(totalFees)}`;
            document.getElementById('modal-total-tax').textContent = `$${formatLargeNumber(totalTax)}`;
            document.getElementById('modal-win-rate').textContent = winStr;
        };