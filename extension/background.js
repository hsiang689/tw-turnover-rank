// 只重複使用「這個擴充功能自己開的」TradingView 視窗，不會動到你其他 TradingView 分頁
const ALLOWED = /^https:\/\/([a-z]+\.)?tradingview\.com\/chart\//;
const TAB_KEY = "chartTab";
const NAV_KEY = "nav";

async function get(key) {
  const v = await chrome.storage.session.get(key);
  return v[key] || null;
}

function symbolOf(url) {
  try { return decodeURIComponent(new URL(url).searchParams.get("symbol") || ""); } catch (e) { return ""; }
}

function sendWithTimeout(tabId, msg, ms) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

// info：{ label, index, total }，用來更新 TradingView 視窗裡的切換列
async function showInChartWindow(url, info) {
  if (!ALLOWED.test(url)) return;
  const saved = await get(TAB_KEY);
  if (saved) {
    let tab = null;
    try { tab = await chrome.tabs.get(saved.tabId); } catch (e) { tab = null; }
    if (tab) {
      // 先嘗試在頁面內直接換商品（保留縮放比例），失敗才重新載入網址
      const symbol = symbolOf(url);
      const code = symbol.split(":").pop();
      const res = symbol ? await sendWithTimeout(tab.id, { type: "switch", symbol, code, ...(info || {}) }, 12000) : null;
      if (!res || !res.ok) await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true, state: "maximized" });
      return;
    }
  }
  const win = await chrome.windows.create({ url, type: "popup", state: "maximized", focused: true });
  const tab = win.tabs && win.tabs[0];
  if (tab) await chrome.storage.session.set({ [TAB_KEY]: { tabId: tab.id, windowId: win.id } });
}

function navInfo(nav) {
  return nav && nav.list && nav.list.length
    ? { label: nav.list[nav.index].label, streak: nav.list[nav.index].streak, index: nav.index, total: nav.list.length }
    : null;
}

async function step(dir) {
  const nav = await get(NAV_KEY);
  if (!nav || !nav.list || !nav.list.length) return;
  const index = Math.min(nav.list.length - 1, Math.max(0, nav.index + dir));
  if (index === nav.index) return;
  nav.index = index;
  await chrome.storage.session.set({ [NAV_KEY]: nav });
  await showInChartWindow(nav.list[index].url, navInfo(nav));
  if (nav.rankTabId != null) {
    chrome.tabs.sendMessage(nav.rankTabId, { type: "navChanged", code: nav.list[index].code }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "openChart") {
    (async () => {
      if (msg.nav && Array.isArray(msg.nav.list)) {
        const list = msg.nav.list
          .filter((x) => x && ALLOWED.test(String(x.url)))
          .map((x) => ({ code: String(x.code), url: String(x.url), label: String(x.label).slice(0, 40), streak: Math.max(0, parseInt(x.streak, 10) || 0) }));
        const index = Math.max(0, list.findIndex((x) => x.url === msg.url));
        await chrome.storage.session.set({ [NAV_KEY]: { list, index, rankTabId: sender.tab ? sender.tab.id : null } });
      }
      await showInChartWindow(msg.url, navInfo(await get(NAV_KEY)));
    })();
    return;
  }

  // 以下兩種訊息只接受來自擴充功能自己開的 TradingView 分頁
  if (msg.type === "whoami" || msg.type === "step") {
    (async () => {
      const saved = await get(TAB_KEY);
      const isChart = !!(saved && sender.tab && sender.tab.id === saved.tabId);
      if (!isChart) { sendResponse({ isChart: false }); return; }
      if (msg.type === "step") { await step(msg.dir > 0 ? 1 : -1); sendResponse({ ok: true }); return; }
      const nav = await get(NAV_KEY);
      if (!nav || !nav.list || !nav.list.length) { sendResponse({ isChart: true, total: 0 }); return; }
      sendResponse({ isChart: true, index: nav.index, total: nav.list.length, label: nav.list[nav.index].label, streak: nav.list[nav.index].streak });
    })();
    return true; // 非同步回覆
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const saved = await get(TAB_KEY);
  if (saved && saved.tabId === tabId) await chrome.storage.session.remove(TAB_KEY);
});
