// 排行網頁：標記擴充功能已安裝，轉送開圖請求，並把 TradingView 視窗裡的切換結果回報給網頁
document.documentElement.dataset.tvExt = "1";

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const msg = e.data;
  if (!msg || msg.source !== "tw-rank" || msg.type !== "openChart") return;
  chrome.runtime.sendMessage({ type: "openChart", url: String(msg.url || ""), nav: msg.nav || null });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "navChanged") {
    window.postMessage({ source: "tw-rank-ext", type: "navChanged", code: msg.code }, location.origin);
  }
});
