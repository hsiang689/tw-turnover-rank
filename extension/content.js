// 在排行網頁上標記「擴充功能已安裝」，並把網頁送來的開圖請求轉給背景程式
document.documentElement.dataset.tvExt = "1";

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const msg = e.data;
  if (!msg || msg.source !== "tw-rank" || msg.type !== "openChart") return;
  chrome.runtime.sendMessage({ type: "openChart", url: String(msg.url || "") });
});
