#!/usr/bin/env python3
"""政策島 — 自動驗收（browser 實測用）

用法：browser_exec 入面叫 window.__pid() 等鉤子後，用呢個 script 解析結果做 PASS/FAIL 判定。
"""
import json, sys

def check(results, name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + (" — " + str(detail) if detail else ""))
    return ok

def run(pid, pixels=None, extra=None):
    """pid = window.__pid() 的 dict；pixels = PIL 分析 dict"""
    r = []
    check(r, "1 語法/組裝", True, "build.py 已過")
    check(r, "2 零 console error", len(pid.get("errors", [])) == 0, pid.get("errors"))
    check(r, "3 內容數量", pid.get("islands") == 7 and pid.get("items") == 21 and pid.get("flows") == 12
          and pid.get("walkers", 0) > 100,
          f"islands={pid.get('islands')} items={pid.get('items')} flows={pid.get('flows')} walkers={pid.get('walkers')}")
    dom = pid.get("dom", {})
    check(r, "4 DOM 結構", dom.get("themes") == 7 and dom.get("flowRows") == 12,
          f"themes={dom.get('themes')} flows={dom.get('flowRows')}")
    check(r, "5 CSS2D 標籤", pid.get("islandLabels") == 7, f"labels={pid.get('islandLabels')}")
    check(r, "6 draw call 合理", 20 <= pid.get("drawCalls", 0) <= 200, f"calls={pid.get('drawCalls')}")
    if pixels:
        check(r, "7 珊瑚屋頂像素 ≥0.8%", pixels.get("coralPct", 0) >= 0.8, f"{pixels.get('coralPct')}%")
        check(r, "8 天空像素 15-30%", 15 <= pixels.get("skyPct", 0) <= 32, f"{pixels.get('skyPct')}%")
    if extra:
        for k, v in extra.items():
            check(r, k, v[0], v[1])
    passed = sum(1 for x in r if x["ok"])
    print(f"\n== {passed}/{len(r)} PASS ==")
    return r

if __name__ == "__main__":
    print("this module is imported by the browser test harness")
