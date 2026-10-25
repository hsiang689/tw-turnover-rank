#!/usr/bin/env python3
"""
台股成交值排行追蹤（上市＋上櫃合併）

資料來源
  上市：證交所 MI_INDEX（每日收盤行情，不含權證/牛熊證）
  上櫃：櫃買中心 dailyQuotes（上櫃股票行情）

用法
  python fetch_rank.py                    # 抓今天（台北時間）
  python fetch_rank.py --date 2026-10-22  # 抓指定日期
  python fetch_rank.py --backfill 5       # 往回補到最近 5 個交易日都有資料
  python fetch_rank.py --rebuild-only     # 不抓資料，只重算排名與網頁用 JSON

輸出
  data/raw/YYYY-MM-DD.csv            當日全市場（已排除權證、可轉債等），含全市場名次
  docs/data/daily/YYYY-MM-DD.json    當日前 N 名＋連續性指標（網頁用）
  docs/data/index.json               已有資料的日期清單
  docs/data/tradingview_topN.txt     TradingView 可匯入的觀察清單
  docs/data/tradingview_new.txt      當日新進榜清單
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

TOP_N = int(os.environ.get("TOP_N", "150"))
HIST_WINDOW = 20          # 名次走勢、在榜天數用的交易日數
SLEEP_SEC = 4.0           # 證交所有頻率限制，請求間隔
TZ = ZoneInfo("Asia/Taipei")

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
WEB_DIR = ROOT / "docs" / "data"
DAILY_DIR = WEB_DIR / "daily"

TWSE_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
TPEX_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes"

# 保留：一般股票（4 碼，可帶英文字母如特別股）與 ETF（00 開頭）
# 排除：權證（6 碼）、可轉債（5 碼）、TDR 6 碼、ETN（02 開頭）等
CODE_RE = re.compile(r"^(\d{4}[A-Z]?|00\d{2,4}[A-Z]?)$")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
}

RAW_FIELDS = ["rank", "code", "name", "market", "close", "change", "chg_pct",
              "open", "high", "low", "volume", "value", "trades"]


class FetchError(RuntimeError):
    pass


# ---------------------------------------------------------------- helpers
def num(s):
    """'1,234.5' -> 1234.5；'--'、空字串 -> None"""
    if s is None:
        return None
    s = re.sub(r"<[^>]+>", "", str(s)).replace(",", "").strip()
    if s in ("", "--", "---", "X", "除權", "除息", "除權息"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def get_json(url, params, tries=4):
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            wait = 5 * (i + 1)
            print(f"  ! {url} 失敗（{e}），{wait}s 後重試", file=sys.stderr)
            time.sleep(wait)
    raise FetchError(f"{url} {params} 連續失敗：{last}")


def today_tw() -> date:
    return datetime.now(TZ).date()


# ---------------------------------------------------------------- fetchers
def fetch_twse(d: date):
    j = get_json(TWSE_URL, {"date": d.strftime("%Y%m%d"),
                            "type": "ALLBUT0999", "response": "json"})
    if str(j.get("stat", "")).upper() != "OK":
        return None  # 休市或尚未公布
    table = None
    for t in j.get("tables", []):
        f = t.get("fields") or []
        if "證券代號" in f and "成交金額" in f:
            table = t
            break
    if not table or not table.get("data"):
        return None
    f = table["fields"]
    ix = {k: f.index(k) for k in f}
    rows = []
    for r in table["data"]:
        sign_txt = re.sub(r"<[^>]+>", "", str(r[ix["漲跌(+/-)"]])).strip()
        diff = num(r[ix["漲跌價差"]]) or 0.0
        change = -diff if sign_txt == "-" else diff
        rows.append({
            "code": str(r[ix["證券代號"]]).strip(),
            "name": str(r[ix["證券名稱"]]).strip(),
            "market": "TWSE",
            "close": num(r[ix["收盤價"]]),
            "change": change,
            "open": num(r[ix["開盤價"]]),
            "high": num(r[ix["最高價"]]),
            "low": num(r[ix["最低價"]]),
            "volume": num(r[ix["成交股數"]]),
            "value": num(r[ix["成交金額"]]),
            "trades": num(r[ix["成交筆數"]]),
        })
    return rows


def fetch_tpex(d: date):
    j = get_json(TPEX_URL, {"date": d.strftime("%Y/%m/%d"), "id": "",
                            "response": "json"})
    if str(j.get("stat", "")).lower() != "ok":
        return None
    if str(j.get("date", "")) not in ("", d.strftime("%Y%m%d")):
        return None  # 回傳的不是要求的日期（休市時會給最近一日）
    rows = []
    for t in j.get("tables", []):
        f = t.get("fields") or []
        if "代號" not in f:
            continue
        vkey = next((k for k in f if k.startswith("成交金額")), None)
        if not vkey:
            continue
        ix = {k: f.index(k) for k in f}
        for r in t.get("data") or []:
            rows.append({
                "code": str(r[ix["代號"]]).strip(),
                "name": str(r[ix["名稱"]]).strip(),
                "market": "TPEX",
                "close": num(r[ix["收盤"]]),
                "change": num(r[ix["漲跌"]]),
                "open": num(r[ix["開盤"]]),
                "high": num(r[ix["最高"]]),
                "low": num(r[ix["最低"]]),
                "volume": num(r[ix["成交股數"]]),
                "value": num(r[ix[vkey]]),
                "trades": num(r[ix["成交筆數"]]),
            })
    return rows or None


def fetch_day(d: date):
    """回傳當日全市場（已過濾、已排名）；休市回傳 None。"""
    print(f"抓取 {d} 上市…")
    twse = fetch_twse(d)
    time.sleep(SLEEP_SEC)
    if twse is None:
        print(f"  {d} 上市無資料（休市或尚未公布）")
        return None
    print(f"抓取 {d} 上櫃…")
    tpex = fetch_tpex(d)
    time.sleep(SLEEP_SEC)
    if tpex is None:
        raise FetchError(f"{d} 上市有資料但上櫃沒有，可能尚未公布，稍後再跑")

    rows = [r for r in twse + tpex
            if CODE_RE.match(r["code"]) and r["value"] and r["value"] > 0]
    for r in rows:
        c, ch = r["close"], r["change"]
        prev = (c - ch) if (c is not None and ch is not None) else None
        r["chg_pct"] = round(ch / prev * 100, 2) if prev else None
    rows.sort(key=lambda r: r["value"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    print(f"  上市 {len(twse)}、上櫃 {len(tpex)} 筆，過濾後 {len(rows)} 檔")
    return rows


# ---------------------------------------------------------------- storage
def raw_path(d: date) -> Path:
    return RAW_DIR / f"{d.isoformat()}.csv"


def save_raw(d: date, rows):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with raw_path(d).open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=RAW_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in RAW_FIELDS})


def load_raw(p: Path):
    out = {}
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            for k in ("rank",):
                r[k] = int(r[k])
            for k in ("close", "change", "chg_pct", "open", "high", "low",
                      "volume", "value", "trades"):
                r[k] = float(r[k]) if r[k] not in ("", "None") else None
            out[r["code"]] = r
    return out


def stored_dates():
    return sorted(p.stem for p in RAW_DIR.glob("*.csv"))


# ---------------------------------------------------------------- outputs
def build_outputs():
    dates = stored_dates()
    if not dates:
        print("沒有任何資料可建立輸出")
        return
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    days = {d: load_raw(RAW_DIR / f"{d}.csv") for d in dates}

    for i, d in enumerate(dates):
        today = days[d]
        prev = days[dates[i - 1]] if i > 0 else None
        window = dates[max(0, i - HIST_WINDOW + 1): i + 1]
        last5 = dates[max(0, i - 4): i + 1]
        prev_dates = dates[max(0, i - HIST_WINDOW): i]  # 不含當日

        top = sorted((r for r in today.values() if r["rank"] <= TOP_N),
                     key=lambda r: r["rank"])
        out_rows = []
        for r in top:
            c = r["code"]
            hist = [days[w][c]["rank"] if c in days[w] else None for w in window]
            prev_rank = prev[c]["rank"] if prev and c in prev else None
            streak = 0
            for w in reversed(dates[: i + 1]):
                if c in days[w] and days[w][c]["rank"] <= TOP_N:
                    streak += 1
                else:
                    break
            pv = [days[w][c]["value"] for w in prev_dates if c in days[w]]
            vratio = round(r["value"] / (sum(pv) / len(pv)), 2) if pv else None
            out_rows.append({
                "rank": r["rank"], "code": c, "name": r["name"],
                "market": r["market"], "etf": c.startswith("00"),
                "close": r["close"], "change": r["change"],
                "chg_pct": r["chg_pct"], "value": r["value"],
                "volume": r["volume"], "trades": r["trades"],
                "prev_rank": prev_rank,
                "rank_chg": (prev_rank - r["rank"]) if prev_rank else None,
                "new": prev is not None and (prev_rank is None or prev_rank > TOP_N),
                "in5": sum(1 for w in last5 if c in days[w] and days[w][c]["rank"] <= TOP_N),
                "in20": sum(1 for w in window if c in days[w] and days[w][c]["rank"] <= TOP_N),
                "streak": streak,
                "vratio": vratio,
                "hist": hist,
            })

        dropped = []
        if prev:
            for c, pr in prev.items():
                if pr["rank"] <= TOP_N and (c not in today or today[c]["rank"] > TOP_N):
                    dropped.append({"code": c, "name": pr["name"],
                                    "market": pr["market"],
                                    "prev_rank": pr["rank"],
                                    "rank": today[c]["rank"] if c in today else None})
            dropped.sort(key=lambda x: x["prev_rank"])

        total_value = sum(r["value"] for r in today.values())
        payload = {
            "date": d, "top_n": TOP_N, "window": window,
            "market_value": total_value,
            "top_value_share": round(sum(r["value"] for r in top) / total_value * 100, 1)
            if total_value else None,
            "rows": out_rows, "dropped": dropped,
        }
        (DAILY_DIR / f"{d}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")

    # 日期索引
    (WEB_DIR / "index.json").write_text(json.dumps({
        "dates": dates, "top_n": TOP_N,
        "updated": datetime.now(TZ).isoformat(timespec="seconds"),
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # TradingView 觀察清單（最新一日）
    latest = json.loads((DAILY_DIR / f"{dates[-1]}.json").read_text(encoding="utf-8"))

    def tv(r):
        return f"{'TWSE' if r['market'] == 'TWSE' else 'TPEX'}:{r['code']}"

    (WEB_DIR / f"tradingview_top{TOP_N}.txt").write_text(
        ",".join(tv(r) for r in latest["rows"]), encoding="utf-8")
    (WEB_DIR / "tradingview_new.txt").write_text(
        ",".join(tv(r) for r in latest["rows"] if r["new"]), encoding="utf-8")
    print(f"已輸出 {len(dates)} 個交易日，最新 {dates[-1]}")


# ---------------------------------------------------------------- main
def run_date(d: date, force=False) -> bool:
    """抓單日；回傳 True 表示這天有資料（含原本就存在）。"""
    if raw_path(d).exists() and not force:
        print(f"{d} 已存在，略過")
        return True
    if d.weekday() >= 5:
        return False
    rows = fetch_day(d)
    if rows is None:
        return False
    save_raw(d, rows)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD，預設今天（台北時間）")
    ap.add_argument("--backfill", type=int, default=0,
                    help="往回補到最近 N 個交易日都有資料")
    ap.add_argument("--force", action="store_true", help="已存在也重抓")
    ap.add_argument("--rebuild-only", action="store_true")
    a = ap.parse_args()

    if not a.rebuild_only:
        end = date.fromisoformat(a.date) if a.date else today_tw()
        if a.backfill > 0:
            got, d, limit = 0, end, end - timedelta(days=a.backfill * 3 + 14)
            while got < a.backfill and d >= limit:
                if run_date(d, a.force):
                    got += 1
                d -= timedelta(days=1)
            print(f"回補完成：{got} 個交易日")
        else:
            if not run_date(end, a.force):
                print(f"{end} 沒有交易資料（休市、週末或尚未公布）")
    build_outputs()


if __name__ == "__main__":
    main()
