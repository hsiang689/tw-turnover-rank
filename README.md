# 台股成交值排行追蹤

每個交易日收盤後，自動抓取上市＋上櫃全市場行情，依成交值合併排名，保存前 150 名（含 ETF）與連續性指標，並產生 TradingView 可匯入的觀察清單。

- 排程：GitHub Actions，週一到週五台北時間 17:07 抓取，21:07 再檢查一次（已抓過就略過）
- 資料：存在這個 repo 裡（`data/raw` 全市場、`docs/data` 網頁用）
- 檢視：GitHub Pages 網頁（`docs/index.html`）

## 部署步驟

1. **建立 repo**：在 GitHub 新增一個 repo（建議 Public：免費帳號的 GitHub Pages 只支援公開 repo，資料本身都是公開行情）。
2. **上傳程式**：
   ```bash
   cd tw-turnover-rank
   git init -b main
   git add .
   git commit -m "init"
   git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
   git push -u origin main
   ```
   （用網頁拖曳上傳時，`.github` 這種隱藏資料夾可能會被漏掉，建議用 git 或 GitHub Desktop。）
3. **開放寫入權限**：Settings → Actions → General → Workflow permissions → 選 **Read and write permissions** → Save。
4. **回補近一週**：Actions → 「每日成交值排行」→ Run workflow，`backfill` 填 `5` → Run。約 1–2 分鐘完成。
5. **開啟網頁**：Settings → Pages → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/docs` → Save。幾分鐘後網址會顯示在同一頁（`https://<帳號>.github.io/<repo名稱>/`）。

之後每天會自動執行，不需要再手動操作。

## 網頁功能

- 選擇日期，查看當日前 150 名
- 名次變化、新進榜標記、跌出榜清單
- 量比：當日成交值 ÷ 前 20 個交易日平均
- 近 5 日／近 20 日在榜天數、連續在榜天數、近 20 日名次走勢
- 篩選：上市／上櫃、隱藏 ETF、只看新進榜、連續在榜天數
- 點任一列直接在 TradingView 開圖，上一檔／下一檔按鈕或鍵盤 ← → 依目前篩選順序切換
- 下載 TradingView 觀察清單（全部 150 檔／新進榜）

## Chrome 擴充功能（同一個視窗切換股票）

一般網頁受 TradingView 安全設定限制，每點一檔都會開新視窗。安裝 `extension` 資料夾裡的擴充功能後，點股票會**重複使用同一個 TradingView 視窗並最大化**，只是換網址。

安裝（一次性）：

1. 下載 `extension` 資料夾到電腦（repo 首頁 Code → Download ZIP，解壓縮後取出 `extension`）
2. Chrome 開 `chrome://extensions`，打開右上角「開發人員模式」
3. 按「載入未封裝項目」，選 `extension` 資料夾
4. 重新整理排行網頁

說明：

- 只在 `*.github.io/tw-turnover-rank/` 這個網站上運作，只操作它自己開的那個 TradingView 視窗，不會動到你其他分頁
- TradingView 視窗下方會出現「◀ 上一檔／下一檔 ▶」切換列，依排行網頁目前的篩選與排序切換；排行網頁上方也有同樣的按鈕（或按鍵盤 ← →），兩邊會同步
- 把那個視窗關掉，下次點擊會再開一個新的
- 更新擴充功能：下載新版 `extension` 資料夾覆蓋舊的，到 `chrome://extensions` 按該擴充功能的重新載入（↻）
- 沒裝擴充功能時，網頁會自動用一般方式開新視窗

## 匯入 TradingView

網頁右上角下載 `.txt` → TradingView 右側觀察清單選單 →「匯入清單」→ 選檔案。

## 手動執行選項

Actions → Run workflow：

| 欄位 | 說明 |
|---|---|
| date | 指定日期 `YYYY-MM-DD`，留空為今天 |
| backfill | 往回補到最近 N 個交易日都有資料 |
| force | `true` 表示已存在的日期也重抓 |

本機執行：`pip install requests && python fetch_rank.py --backfill 5`

## 設定

- 資料保留：只保留最近約 3 個月（以最新交易日往回 92 天），更早的每次執行時自動刪除。要改天數，在 workflow 加環境變數 `KEEP_DAYS`。
- 名次門檻：環境變數 `TOP_N`（預設 150）。在 workflow 的「抓取並建立排行」步驟加 `TOP_N: 200` 即可。
- 排除項目：權證、牛熊證、可轉債、ETN、TDR。保留一般股票與 00 開頭的 ETF。

## 疑難排解

- **Action 失敗並顯示「上市有資料但上櫃沒有」**：櫃買中心資料較晚公布，21:07 那次會自動補抓。
- **連線逾時或 403**：證交所偶爾會限制海外或雲端 IP。若持續發生，可改在自己的電腦用 Windows 工作排程器執行 `fetch_rank.py`，再 push 到 repo。
