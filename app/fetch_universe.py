"""네이버 증권에서 종목 유니버스를 수집한다.

수집 항목: [코드, 종목명, 시장, 시가총액(억원), 업종명, 종류]
 - 시가총액: 시가총액 순 목록 API에서 파싱 -> 트리맵 타일 크기에 사용
 - 업종: 업종 API에서 코드->업종 매핑 -> 트리맵 구획에 사용

출력: universe.json

옛 경로(finance.naver.com/sise/sise_market_sum.naver·sise_group.naver)는
2026-09-14경부터 stock.naver.com으로 302 되어 쓸 수 없다. 모바일 증권 JSON API로
갈아탔다. ETF·ETN 공식 목록(finance.naver.com/api/sise/*ItemList.nhn)은 아직 살아 있어
그대로 쓴다.

결과가 기존 universe.json보다 줄면 저장하지 않는다(수집 실패로 본다).
"""
import json
import re
import time
import urllib.request
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
API = "https://m.stock.naver.com/api"
MV_URL = API + "/stocks/marketValue/{market}?page={page}&pageSize=100"
GRP_URL = API + "/stocks/industry?page=1&pageSize=100"
DET_URL = API + "/stocks/industry/{no}?page={page}&pageSize=100"
# ETF·ETN 공식 목록 (네이버 내부 API). 이름 패턴 추측 대신 이걸 정답으로 쓴다.
ETF_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"
ETN_URL = "https://finance.naver.com/api/sise/etnItemList.nhn"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "universe.json")

# 신형 종목코드는 영문자를 품는다(0126Z0 삼성에피스홀딩스, 00680K 미래에셋증권2우B,
# 0167A0 SOL AI반도체TOP2플러스). 여섯 자리이고 첫 자리는 늘 숫자다.
CODE = re.compile(r"\A[0-9][0-9A-Z]{5}\Z")
MAX_PAGE = 100


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return json.loads(raw.decode("euc-kr", "replace"))


def to_int(s):
    try:
        return int(str(s).replace(",", ""))
    except ValueError:
        return 0


def collect_market(market):
    """시가총액 순 목록에서 [코드, 종목명, 시장, 시총(억)] 수집.
    빈 페이지가 나올 때까지 전 종목을 긁는다. 종류(stock/etf/etn)는 따로 돌려준다."""
    out, kinds, seen, page = [], {}, set(), 1
    while page <= MAX_PAGE:
        payload = get(MV_URL.format(market=market, page=page))
        stocks = (payload or {}).get("stocks") or []
        if not stocks:
            print("  %s: page %d empty, stop" % (market, page))
            break
        for it in stocks:
            code = str(it.get("itemCode") or "").strip().upper()
            if not CODE.match(code) or code in seen:
                continue
            seen.add(code)
            # marketValue 단위는 억원이다 (삼성전자 14,586,465 = 1,458조).
            out.append([code, str(it.get("stockName") or "").strip(), market,
                        to_int(it.get("marketValue"))])
            end_type = str(it.get("stockEndType") or "").upper()
            if end_type in ("ETF", "ETN"):
                kinds[code] = end_type
        if page % 10 == 0:
            print("  %s page %d: total %d" % (market, page, len(out)))
        page += 1
        time.sleep(0.25)
    print("  %s %d개" % (market, len(out)))
    return out, kinds


def collect_funds():
    """ETF·ETN 종목코드 집합. 반환: {code: "ETF"|"ETN"}"""
    out = {}
    for url, key, kind in ((ETF_URL, "etfItemList", "ETF"),
                           (ETN_URL, "etnItemList", "ETN")):
        try:
            lst = (get(url) or {}).get("result", {}).get(key, []) or []
            for it in lst:
                c = str(it.get("itemcode") or "").strip().upper()
                if CODE.match(c):
                    out[c] = kind
            print("  %s %d개" % (kind, len(lst)))
        except Exception as e:                  # noqa: BLE001
            print("   ! %s 목록 실패: %s" % (kind, e))
    return out


def collect_sectors():
    """코드 -> 업종명 매핑"""
    groups = (get(GRP_URL) or {}).get("groups") or []
    print("  업종 %d개" % len(groups))
    by_code = {}
    for i, g in enumerate(groups):
        no, name = g.get("no"), str(g.get("name") or "").strip()
        if not no or not name:
            continue
        got = 0
        for page in range(1, 21):
            try:
                det = get(DET_URL.format(no=no, page=page))
            except Exception as e:              # noqa: BLE001
                print("   ! %s 실패: %s" % (name, e))
                break
            stocks = (det or {}).get("stocks") or []
            if not stocks:
                break
            for it in stocks:
                code = str(it.get("itemCode") or "").strip().upper()
                if CODE.match(code):
                    by_code.setdefault(code, name)
            got += len(stocks)
            total = det.get("totalCount")
            if isinstance(total, int) and got >= total:
                break
            time.sleep(0.25)
        if (i + 1) % 20 == 0:
            print("   ...%d/%d" % (i + 1, len(groups)))
        time.sleep(0.25)
    print("  업종 매핑된 종목 %d개" % len(by_code))
    return by_code


def previous_total():
    """기존 universe.json 종목 수. 없으면 0."""
    if not os.path.exists(OUT):
        return 0
    try:
        with open(OUT, encoding="utf-8") as f:
            return len(json.load(f))
    except Exception:                           # noqa: BLE001
        return 0


def main():
    print("[1/3] 시가총액 순 전 종목 수집")
    kospi, kind_kospi = collect_market("KOSPI")
    kosdaq, kind_kosdaq = collect_market("KOSDAQ")
    print("  KOSPI %d / KOSDAQ %d" % (len(kospi), len(kosdaq)))
    rows = kospi + kosdaq

    print("[2/3] 업종 매핑 수집")
    sec = collect_sectors()

    print("[3/3] ETF/ETN 목록 수집")
    funds = collect_funds()
    # 공식 목록이 정답이고, 거기 없는 건 시세 목록의 stockEndType으로 메운다.
    for kinds in (kind_kospi, kind_kosdaq):
        for code, kind in kinds.items():
            funds.setdefault(code, kind)

    # [코드, 종목명, 시장, 시총(억), 업종, 종류(""=주식/"ETF"/"ETN")]
    universe = [r + [sec.get(r[0], "기타"), funds.get(r[0], "")] for r in rows]

    nosec = sum(1 for u in universe if u[4] == "기타")
    nocap = sum(1 for u in universe if not u[3])
    netf = sum(1 for u in universe if u[5] == "ETF")
    netn = sum(1 for u in universe if u[5] == "ETN")
    print("total %d / 주식 %d / ETF %d / ETN %d / 업종없음 %d / 시총없음 %d"
          % (len(universe), len(universe) - netf - netn, netf, netn, nosec, nocap))

    before = previous_total()
    if before and len(universe) < before:
        print("  ! 수집 결과(%d)가 기존(%d)보다 적습니다. 저장하지 않고 원본을 그대로 둡니다."
              % (len(universe), before))
        return 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(universe, f, ensure_ascii=False)
    print("wrote", OUT, "(이전 %d개)" % before)
    print("sample", universe[:2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
