// 只重複使用「這個擴充功能自己開的」TradingView 視窗，不會動到你其他 TradingView 分頁
const ALLOWED = /^https:\/\/([a-z]+\.)?tradingview\.com\/chart\//;
const KEY = "chartTab";

async function getSaved() {
  const v = await chrome.storage.session.get(KEY);
  return v[KEY] || null;
}

async function openChart(url) {
  if (!ALLOWED.test(url)) return;

  const saved = await getSaved();
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
  if (tab) await chrome.storage.session.set({ [KEY]: { tabId: tab.id, windowId: win.id } });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openChart") openChart(msg.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const saved = await getSaved();
  if (saved && saved.tabId === tabId) await chrome.storage.session.remove(KEY);
});
