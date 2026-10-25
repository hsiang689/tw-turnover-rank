// 只重複使用「這個擴充功能自己開的」TradingView 視窗，不會動到你其他 TradingView 分頁
const ALLOWED = /^https:\/\/([a-z]+\.)?tradingview\.com\/chart\//;
const TAB_KEY = "chartTab";
const NAV_KEY = "nav";

async function get(key) {
  const v = await chrome.storage.session.get(key);
  return v[key] || null;
}

async function showInChartWindow(url) {
  if (!ALLOWED.test(url)) return;
  const saved = await get(TAB_KEY);
  if (saved) {
    try {
      const tab = await chrome.tabs.get(saved.tabId);
      await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true, state: "maximized" });
      return;
    } catch (e) {
      // 視窗已被關閉，改開新的
    }
  }
  const win = await chrome.windows.create({ url, type: "popup", state: "maximized", focused: true });
  const tab = win.tabs && win.tabs[0];
  if (tab) await chrome.storage.session.set({ [TAB_KEY]: { tabId: tab.id, windowId: win.id } });
}

async function step(dir) {
  const nav = await get(NAV_KEY);
  if (!nav || !nav.list || !nav.list.length) return;
  const index = Math.min(nav.list.length - 1, Math.max(0, nav.index + dir));
  if (index === nav.index) return;
  nav.index = index;
  await chrome.storage.session.set({ [NAV_KEY]: nav });
  await showInChartWindow(nav.list[index].url);
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
          .map((x) => ({ code: String(x.code), url: String(x.url), label: String(x.label).slice(0, 40) }));
        const index = Math.max(0, list.findIndex((x) => x.url === msg.url));
        await chrome.storage.session.set({ [NAV_KEY]: { list, index, rankTabId: sender.tab ? sender.tab.id : null } });
      }
      await showInChartWindow(msg.url);
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
      sendResponse({ isChart: true, index: nav.index, total: nav.list.length, label: nav.list[nav.index].label });
    })();
    return true; // 非同步回覆
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const saved = await get(TAB_KEY);
  if (saved && saved.tabId === tabId) await chrome.storage.session.remove(TAB_KEY);
});
