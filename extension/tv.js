// TradingView 圖表頁（只在擴充功能自己開的視窗裡作用）：
// 1. 顯示「上一檔／下一檔」切換列
// 2. 收到切換指令時，直接在頁面內換商品（不重新載入），保留縮放比例、週期與指標
(function () {
  if (window.top !== window) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ui = null;

  // 視窗剛建立時，背景程式可能還沒記下這個分頁，稍等後重試幾次
  (function ask(n) {
    chrome.runtime.sendMessage({ type: "whoami" }, (res) => {
      if (!chrome.runtime.lastError && res && res.isChart && res.total) { render(res); return; }
      if (n < 5) setTimeout(() => ask(n + 1), 600);
    });
  })(0);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "switch") return;
    switchSymbol(msg.symbol, msg.code).then((ok) => {
      if (ok && msg.total) render(msg);
      sendResponse({ ok });
    });
    return true;
  });

  async function waitFor(fn, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  async function switchSymbol(symbol, code) {
    const btn = document.querySelector("#header-toolbar-symbol-search");
    if (!btn) return false;
    if (btn.innerText.trim() === code) return true;
    try {
      btn.click();
      const dialogSel = '[data-name="symbol-search-items-dialog"]';
      const input = await waitFor(() => document.querySelector(dialogSel + " input"), 2500);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      input.focus();
      setter.call(input, symbol);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(() => document.querySelector(
        dialogSel + ' [data-role="list-item"], ' + dialogSel + ' [class*="itemRow"]'), 3000);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      const ok = await waitFor(() => {
        const b = document.querySelector("#header-toolbar-symbol-search");
        return b && b.innerText.trim() === code;
      }, 5000);
      if (!ok) {
        const inp = document.querySelector(dialogSel + " input");
        if (inp) inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
      }
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function render(info) {
    if (!ui) ui = build();
    ui.label.textContent = info.label || "";
    ui.pos.textContent = `${info.index + 1}/${info.total}`;
    ui.prev.disabled = info.index <= 0;
    ui.next.disabled = info.index >= info.total - 1;
  }

  // 拖曳移動，位置存在擴充功能的本機儲存空間，下次開啟沿用
  function place(host, x, y) {
    const w = host.offsetWidth || 360, h = host.offsetHeight || 40;
    x = Math.min(Math.max(0, x), window.innerWidth - w);
    y = Math.min(Math.max(0, y), window.innerHeight - h);
    host.style.left = x + "px"; host.style.top = y + "px"; host.style.bottom = "auto";
  }
  function makeDraggable(host, grip) {
    chrome.storage.local.get("barPos", (v) => {
      const p = v && v.barPos;
      if (p) requestAnimationFrame(() => place(host, p.x * window.innerWidth, p.y * window.innerHeight));
    });
    let start = null;
    grip.addEventListener("pointerdown", (e) => {
      const r = host.getBoundingClientRect();
      start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      grip.setPointerCapture(e.pointerId); e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (start) place(host, e.clientX - start.dx, e.clientY - start.dy);
    });
    grip.addEventListener("pointerup", () => {
      if (!start) return; start = null;
      const r = host.getBoundingClientRect();
      chrome.storage.local.set({ barPos: { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
    });
    grip.addEventListener("dblclick", () => {
      chrome.storage.local.remove("barPos");
      host.style.left = "72px"; host.style.top = "auto"; host.style.bottom = "96px";
    });
    window.addEventListener("resize", () => {
      if (host.style.top && host.style.top !== "auto") place(host, parseFloat(host.style.left), parseFloat(host.style.top));
    });
  }

  function build() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:72px;bottom:96px;z-index:2147483647;";
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
        .grip{cursor:grab;color:#6b7380;padding:2px 2px 2px 4px;letter-spacing:-2px;touch-action:none}
        .grip:active{cursor:grabbing}
      </style>
      <div class="bar">
        <span class="grip" title="拖曳移動位置（雙擊回到預設位置）">⋮⋮</span>
        <button class="prev" title="上一檔">◀ 上一檔</button>
        <span class="lbl"><b></b><span class="pos"></span></span>
        <button class="next" title="下一檔">下一檔 ▶</button>
      </div>`;
    const prev = root.querySelector(".prev"), next = root.querySelector(".next");
    const go = (dir) => { prev.disabled = next.disabled = true; chrome.runtime.sendMessage({ type: "step", dir }); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    (document.body || document.documentElement).appendChild(host);
    makeDraggable(host, root.querySelector(".grip"));
    return { prev, next, label: root.querySelector("b"), pos: root.querySelector(".pos") };
  }
})();
