"""네이버 금융에서 종목 유니버스를 수집한다.

수집 항목: [코드, 종목명, 시장, 시가총액(억원), 업종명]
 - 시가총액: 시가총액 상위 페이지(sise_market_sum)에서 파싱 -> 트리맵 타일 크기에 사용
 - 업종: 업종별 시세(sise_group_detail)에서 코드->업종 매핑 -> 트리맵 구획에 사용

출력: universe.json
페이지는 모두 EUC-KR 인코딩이므로 반드시 euc-kr로 디코딩한다.
"""
import json
import re
import time
import urllib.request
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
SUM_URL = "https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
GRP_URL = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
# ETF·ETN 공식 목록 (네이버 내부 API). 이름 패턴 추측 대신 이걸 정답으로 쓴다.
ETF_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"
ETN_URL = "https://finance.naver.com/api/sise/etnItemList.nhn"
DET_URL = "https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no={no}"

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
ITEM = re.compile(r'/item/main\.naver\?code=(\d{6})"[^>]*>([^<]+)</a>')
# 숫자 셀은 <em>/<span> 마크업을 품는 경우가 있어 태그를 걷어낸 뒤 텍스트를 본다
NUMTD = re.compile(r'<td class="number">(.*?)</td>', re.S)
TAG = re.compile(r"<[^>]+>")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("euc-kr", "replace")


def to_int(s):
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return 0


def collect_market(sosok, market, want=None):
    """시가총액 페이지에서 [코드, 종목명, 시장, 시총(억)] 수집.
    want=None 이면 빈 페이지가 나올 때까지 전 종목을 긁는다."""
    out, seen, page = [], set(), 1
    while (want is None or len(out) < want) and page <= 200:
        html = get(SUM_URL.format(sosok=sosok, page=page))
        hits = 0
        for tr in ROW.findall(html):
            m = ITEM.search(tr)
            if not m:
                continue
            code, name = m.group(1), m.group(2).strip()
            hits += 1
            if code in seen:
                continue
            nums = [TAG.sub("", c).strip() for c in NUMTD.findall(tr)]
            # 컬럼 순서: 현재가, 전일비, 등락률, 액면가, 시가총액(억), 상장주식수, ...
            cap = to_int(nums[4]) if len(nums) > 4 else 0
            seen.add(code)
            out.append([code, name, market, cap])
        if not hits:
            print("  %s: page %d empty, stop" % (market, page))
            break
        if page % 10 == 0 or hits < 40:
            print("  %s page %d: total %d" % (market, page, len(out)))
        page += 1
        time.sleep(0.35)
    return out[:want] if want else out


def collect_funds():
    """ETF·ETN 종목코드 집합. 반환: {code: "ETF"|"ETN"}"""
    import json
    out = {}
    for url, key, kind in ((ETF_URL, "etfItemList", "ETF"), (ETN_URL, "etnItemList", "ETN")):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
            try:
                txt = raw.decode("utf-8")
            except UnicodeDecodeError:
                txt = raw.decode("euc-kr", "replace")
            lst = json.loads(txt).get("result", {}).get(key, []) or []
            for it in lst:
                c = str(it.get("itemcode") or "").strip()
                if c:
                    out[c] = kind
            print("  %s %d개" % (kind, len(lst)))
        except Exception as e:                  # noqa: BLE001
            print("   ! %s 목록 실패: %s" % (kind, e))
    return out


def collect_sectors():
    """코드 -> 업종명 매핑"""
    html = get(GRP_URL)
    sectors = re.findall(
        r'sise_group_detail\.naver\?type=upjong&no=(\d+)"[^>]*>([^<]+)<', html)
    print("  업종 %d개" % len(sectors))
    by_code = {}
    for i, (no, name) in enumerate(sectors):
        name = name.strip()
        try:
            det = get(DET_URL.format(no=no))
        except Exception as e:
            print("   ! %s 실패: %s" % (name, e))
            continue
        for code, _ in ITEM.findall(det):
            by_code.setdefault(code, name)
        if (i + 1) % 20 == 0:
            print("   ...%d/%d" % (i + 1, len(sectors)))
        time.sleep(0.25)
    print("  업종 매핑된 종목 %d개" % len(by_code))
    return by_code


def main():
    print("[1/2] 시가총액 페이지 전 종목 수집")
    kospi = collect_market(0, "KOSPI")
    kosdaq = collect_market(1, "KOSDAQ")
    print("  KOSPI %d / KOSDAQ %d" % (len(kospi), len(kosdaq)))
    rows = kospi + kosdaq

    print("[2/3] 업종 매핑 수집")
    sec = collect_sectors()

    print("[3/3] ETF/ETN 목록 수집")
    funds = collect_funds()

    # [코드, 종목명, 시장, 시총(억), 업종, 종류(""=주식/"ETF"/"ETN")]
    universe = [r + [sec.get(r[0], "기타"), funds.get(r[0], "")] for r in rows]
    with open("universe.json", "w", encoding="utf-8") as f:
        json.dump(universe, f, ensure_ascii=False)

    nosec = sum(1 for u in universe if u[4] == "기타")
    nocap = sum(1 for u in universe if not u[3])
    netf = sum(1 for u in universe if u[5] == "ETF")
    netn = sum(1 for u in universe if u[5] == "ETN")
    print("total %d / 주식 %d / ETF %d / ETN %d / 업종없음 %d / 시총없음 %d"
          % (len(universe), len(universe) - netf - netn, netf, netn, nosec, nocap))
    print("sample", universe[:2])


if __name__ == "__main__":
    main()
