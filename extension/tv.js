// TradingView 圖表頁：只在擴充功能自己開的視窗裡顯示「上一檔／下一檔」切換列
(function () {
  if (window.top !== window) return;

  chrome.runtime.sendMessage({ type: "whoami" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.isChart || !res.total) return;
    build(res);
  });

  function build(res) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .bar{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:9px;
          background:rgba(22,26,32,.92);border:1px solid #2f3540;box-shadow:0 4px 16px rgba(0,0,0,.35);
          font:13px/1.3 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;color:#d7dbe0;user-select:none}
        button{font:inherit;color:#d7dbe0;background:#262b33;border:1px solid #363c47;border-radius:6px;
          padding:4px 10px;cursor:pointer}
        button:hover:not(:disabled){background:#2f3641}
        button:disabled{opacity:.35;cursor:default}
        .lbl{padding:0 6px;white-space:nowrap;font-variant-numeric:tabular-nums}
        .lbl b{color:#fff;font-weight:600}
        .pos{color:#8a919c;margin-left:4px}
      </style>
      <div class="bar">
        <button class="prev" title="上一檔">◀ 上一檔</button>
        <span class="lbl"><b></b><span class="pos"></span></span>
        <button class="next" title="下一檔">下一檔 ▶</button>
      </div>`;
    root.querySelector("b").textContent = res.label || "";
    root.querySelector(".pos").textContent = `${res.index + 1}/${res.total}`;
    const prev = root.querySelector(".prev"), next = root.querySelector(".next");
    prev.disabled = res.index <= 0;
    next.disabled = res.index >= res.total - 1;
    const go = (dir) => { prev.disabled = next.disabled = true; chrome.runtime.sendMessage({ type: "step", dir }); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    (document.body || document.documentElement).appendChild(host);
  }
})();
