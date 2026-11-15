# 리포트 레이더

국내 증권사의 종목 리포트를 매일 자동으로 모으고, 그 위에 네이버 금융 실시간 시세를 얹어
한 화면에서 훑어보는 정적 사이트. 원래 따로 굴리던 **주식 대시보드**(핀비즈 스타일 시세·차트·
스크리너)와 **리포트 레이더**(증권사 리포트 집계)를 한 앱으로 합친 것이다.
수집은 GitHub Actions가 대신 돌리고, 결과는 GitHub Pages로 올라간다.

배포: <https://yongziri.github.io/report-radar/>

## 탭

| 탭 | 하는 일 |
| --- | --- |
| 대시보드 | 지수·등락 게이지, Top Gainers/Losers·거래대금, 업종별 퍼포먼스, 시총 상위 150 트리맵, **오늘의 리포트**, 시장 뉴스·공시, 관심종목, 경제 캘린더, 포트폴리오 |
| 리포트 | 증권사 리포트 표 / 종목별 / 업종별 / 히트맵 4개 서브뷰 + 기간·레이팅·목표가변동·업종·증권사·검색 필터 |
| 종목분석 | 캔들 차트·이동평균·RSI, 핀비즈식 스탯 그리드, **증권사 리포트 패널(목표가 컨센서스)**, 뉴스·공시 |
| 기업분석 | 와이즈리포트(FnGuide) 리포트 삽입 |
| 스크리너 | 전종목 스캔·필터·프리셋·심층분석·CSV, **리포트(1M)·컨센 괴리율 컬럼** |
| 알림 | 가격·등락률 조건 알림 |

## 구조

```
report-radar/
├─ index.html                    # 빌드 산출물 (약 1.6MB, 폰트 내장). 직접 고치지 말 것
├─ app/                          # 화면 소스
│  ├─ parts/                     # index.html 을 이루는 조각들
│  │  ├─ 01_head.html            #   <head> + CSS 전부
│  │  ├─ 02_body.html            #   마크업 전부
│  │  ├─ 03_core.js              #   유니버스·상태·JSONP·네이버 API·RSS·지표
│  │  ├─ 04_dash.js              #   시세 갱신·대시보드·트리맵·검색
│  │  ├─ 05_analysis.js          #   종목분석(차트)·기업분석·캘린더
│  │  ├─ 06_screener.js          #   스크리너
│  │  ├─ 08_import.js            #   잔고 붙여넣기 파서
│  │  ├─ 09_reports.js           #   증권사 리포트 (리포트 탭·대시보드/종목분석 연동)
│  │  ├─ 07_init.js              #   이벤트 바인딩·초기화 (항상 마지막)
│  │  └─ _fonts.css              #   우리다움체 base64 (embed_fonts.py 산출물)
│  ├─ build.py                   # parts/* 를 이어붙여 ../index.html 생성
│  ├─ fetch_universe.py          # 코스피·코스닥 전종목 + 시총 + 업종 수집
│  ├─ universe.json              # 그 결과 (4,296종목: 주식 2,762 / ETF 1,170 / ETN 364)
│  ├─ embed_fonts.py, fonts/     # TTF → WOFF2 base64 내장
│  ├─ cloudflare-worker.js       # RSS 프록시 (선택) — PROXY_SETUP.md 참고
│  ├─ samples/, make_import_samples.py, test_parsers.mjs
│  └─ PROXY_SETUP.md
├─ data/
│  ├─ reports/YYYY-MM.json       # 월별 리포트 (최근 730일, 최신순 배열, 요약 제외)
│  ├─ summaries/YYYY-MM.json     # 월별 요약 {id: 본문}
│  ├─ prices.json                # 리포트 종목의 수집 시점 현재가
│  ├─ sectors.json               # 업종 분류표 (종목코드 → 업종 → 대분류)
│  └─ meta.json                  # 갱신 시각·건수·증권사 목록·소스 상태 + 월별 파일 버전(v2)
├─ scraper/
│  ├─ collect.py                 # 수집기 (CLI)
│  ├─ check_sources.py           # 소스 정지 경보 (meta.json 점검)
│  ├─ brokers.py                 # 증권사 직접 수집 (KB·NH·한투 네트워크 호출)
│  ├─ sectors.py                 # 업종 분류 수집 + 대분류 매핑표
│  ├─ parsers.py                 # 순수 파싱·계산 함수 (네트워크를 타지 않음)
│  ├─ normalize.py               # 저장 전 정규화 (중복 병합·의견 승계·확인 필요 표시)
│  ├─ store.py                   # 데이터 파일 읽기/쓰기 (형식 v2, v1 이전)
│  ├─ test_parsers.py            # 픽스처 기반 테스트
│  └─ requirements.txt
├─ docs/stock-helper-PLAN.md     # 합치기 전 주식 대시보드 설계 메모
└─ .github/workflows/collect.yml # 수집 cron + Pages 배포
```

**`index.html` 은 빌드 산출물이다.** 화면을 고칠 때는 `app/parts/` 의 조각을 고치고
다시 빌드한다. 워크플로는 커밋된 `index.html` 을 그대로 서빙하므로, 빌드를 잊으면
화면이 갱신되지 않는다.

```bash
python app/build.py     # app/parts/* + app/universe.json → index.html
```

빌드는 `01 → 02 → 03 → 04 → 05 → 06 → 08 → 09 → 07` 순으로 붙인다.
`07_init.js` 의 `init()` 이 즉시 실행되므로 새 파트는 반드시 그 **앞**에 넣는다.
`__FONTS__`·`__KR_KOSPI__`·`__KR_KOSDAQ__`·`__SECTORS__`·`__INDUSTRIES__` 자리표시자를
`build.py` 가 채운다.

화면은 `data/*.json` 을 상대경로로 `fetch` 할 뿐이고, 런타임 의존성(번들러·프레임워크)은
없다. 리포트 데이터는 앱이 뜬 뒤 **백그라운드로** 읽으므로, 못 읽어도 리포트 탭에만
안내가 뜨고 나머지 탭은 정상 동작한다. 5분마다 `meta.json` 을 확인해 갱신분만 다시 받는다.

## 데이터 소스

| 소스 | 쓰임 | 비고 |
| --- | --- | --- |
| 네이버 증권 리서치 API (`m.stock.naver.com/api/research/company`) | 리포트 목록·목표가·투자의견·요약·PDF | 목록은 배열, 상세는 `/{researchId}`. **브라우저 UA 필수**, JSON UTF-8. 목록에 날짜 파라미터가 없어 최신순으로 넘기다 범위를 벗어나면 멈춘다(상한 60페이지) |
| 네이버 실시간 시세 API | 현재가 | 한 번에 100종목씩 조회 |
| [한경 컨센서스](https://consensus.hankyung.com/analysis/list?report_type=CO) | 애널리스트명 보강, 네이버에 없는 리포트 추가 | **브라우저 UA 필수**. 아니면 본문이 `Block access`로 돌아온다 |
| [KB증권 리서치](https://rc.kbsec.com/) | KB증권 리포트 (`source: "kb"`) | 목록 JSON에 의견·목표가·요약이 다 들어 있다. **JSON 바디로 POST** 해야 한다(form이면 500) |
| [NH투자증권 리서치](https://www.nhsec.com/research/boardList.action?rsh_ppr_dit_cd=01) | NH투자증권 리포트 (`source: "nh"`) | 목록엔 의견·목표가가 없어 요약문에서 캔다. 응답 인코딩이 **EUC-KR**인데 본문은 JSON이다 |
| [한국투자증권 리서치](https://securities.koreainvestment.com/main/research/research/Strategy.jsp?jkGubun=10) | 한국투자증권 리포트 (`source: "kis"`) | **브라우저 UA 필수**. 의견·목표가는 상세 본문에서 캔다. PDF는 로그인이 필요해 `pdf`가 `null`이다 |
| 네이버 증권 업종 API (`m.stock.naver.com/api/stocks/industry`) | 종목의 업종(`industry`)·대분류(`sector`) | 업종 목록 1회 + 업종별 종목(`/{no}?page=N&pageSize=100`) 79회를 훑는다. **7일마다** 다시 받는다 |
| 네이버 증권 시총 API (`m.stock.naver.com/api/stocks/marketValue/{KOSPI\|KOSDAQ}`) | 앱 유니버스(`app/universe.json`)의 코드·종목명·시총 | `app/fetch_universe.py` 전용. ETF·ETN 목록은 `finance.naver.com/api/sise/etfItemList.nhn`·`etnItemList.nhn` |

> 2026-09-14경 `finance.naver.com`의 리서치·시세·업종 페이지가 `stock.naver.com`으로 302 되면서
> HTML을 긁던 경로가 통째로 막혔다(네이버 소스 0건). 위 모바일 증권 JSON API로 갈아탔고,
> 같은 사고를 조용히 넘기지 않으려고 네이버 요청은 **리다이렉트를 따르지 않고**
> 최종 호스트가 다르면 실패로 처리한다. 목록 API 한 페이지도 못 받으면 수집을 중단한다.
>
> 향후: 산업분석 `/api/research/industry`, 시황 `/api/research/market` 도 같은 모양으로 열려 있다.
> 지금은 종목분석(`/api/research/company`)만 쓴다.

이 세 곳은 네이버 리서치에 리포트를 거의 올리지 않아 각 사 사이트에서 직접 긁는다.
소스 우선순위는 **네이버 > KB·NH·한투 > 한경**이다. `(종목코드, 작성일, 증권사 정규화명)`으로
같은 리포트를 맞춰, 상위 소스 레코드가 있으면 하위 레코드를 새로 넣지 않고 상위 레코드의
빈 칸(`analyst`·`target`·`rating_raw`·`summary`·`pdf`)만 채운다.
어느 소스가 실패해도 전체 수집은 계속된다(경고만 남긴다).

## 실행

### 준비

```bash
pip install -r scraper/requirements.txt
```

### 수집

```bash
# 기본: 오늘 포함 최근 3일 (주말·누락분 대비) + 현재가 갱신
python scraper/collect.py

# 초기 백필
python scraper/collect.py --days 45

# 기간 직접 지정
python scraper/collect.py --from 2026-08-01 --to 2026-08-31

# 저장하지 않고 결과만 확인
python scraper/collect.py --dry-run

# 보조 소스 끄기
python scraper/collect.py --no-hankyung --no-brokers --no-price

# 업종 분류만 강제로 다시 받기 / 아예 건너뛰기
python scraper/collect.py --refresh-sectors
python scraper/collect.py --no-sectors

# 네트워크 없이 저장된 데이터의 v1→v2 이전·정규화만
python scraper/collect.py --migrate-only

# 저장된 한투 리포트 전부의 상세를 다시 받아 목표가·의견을 다시 읽기 (추출 규칙 수정 후 1회)
python scraper/collect.py --refetch-kis
```

요청 사이에 0.4초를 쉬고, 실패하면 2회까지 다시 시도한다. 상세 페이지를 못 읽어도
목록에서 얻은 정보만으로 저장한다(목표가·투자의견은 `null`).
종료 코드는 네이버 목록을 한 건도 받지 못했을 때만 `1`, 그 밖에는 `0`이다.

### 테스트

```bash
python scraper/test_parsers.py
```

네트워크 없이 픽스처 문자열만으로 돈다. 목록·상세·한경·KB·NH·한투·업종 파서,
본문에서 의견·목표가를 캐는 추출기, 투자의견 정규화, 괴리율, 목표가 변동 판정,
업종 79개가 모두 대분류에 매핑되는지, 소스 정지 판정(`stale_sources`)이
영업일 경계에서 맞는지를 검증한다.

### 화면 빌드

```bash
python app/build.py                 # app/parts/* → index.html
python app/fetch_universe.py        # 종목 유니버스 갱신 (가끔)
python app/embed_fonts.py           # 폰트 다시 내장 (fonts/ 를 바꿨을 때만)
node app/test_parsers.mjs           # 잔고 붙여넣기 파서 테스트 (Node 필요)
```

### 화면 확인

`file://`로 열면 브라우저 보안 정책 때문에 JSON을 못 읽는다. 반드시 서버로 띄운다.

```bash
python -m http.server 3491
# http://localhost:3491
```

## 레코드 스키마

데이터 형식은 v2다(규약: `docs/DATA-FORMAT-v2.md`). 리포트는 작성월별로
`data/reports/YYYY-MM.json`에 최신순 배열로 들어 있고, 각 항목은 다음과 같다.

```json
{
  "id": "naver:96032",
  "source": "naver",
  "date": "2026-09-07",
  "code": "031980",
  "name": "피에스케이홀딩스",
  "industry": "반도체와반도체장비",
  "sector": "IT",
  "title": "홀딩스의 시간이 온다",
  "broker": "DS투자증권",
  "analyst": null,
  "rating_raw": "매수",
  "rating": "BUY",
  "target": 200000,
  "prev_target": 180000,
  "target_change": "up",
  "naver_prev_target": 180000,
  "price_at_write": 152000,
  "pdf": "https://stock.pstatic.net/.../20260907_company_169484000.pdf",
  "url": "https://m.stock.naver.com/research/company/96032",
  "views": 4031,
  "has_summary": true
}
```

- 요약은 `data/summaries/YYYY-MM.json`(`{id: 본문}`)에, 현재가는 `data/prices.json`
  (`{"updated_at", "prices": {code: {"p": 가격, "d": "수집일"}}}`)에 따로 있다.
  v1에 있던 `summary`·`price`·`price_date`·`gap`은 레코드에서 빠졌고, 괴리율은 앱이 계산한다.
- **`meta.json`** — `updated_at`·`count`·`latest_date`·`brokers`·`source_status`에 더해
  `data_version: 2`, `months`(최신 달 먼저, `{month, count, v, sv}`), `prices_v`.
  `v`·`sv`·`prices_v`는 각 파일 내용의 sha1 앞 10자이고, 앱은 `?v=` 캐시 키로 쓴다.
- **`rating`** — 원문(`rating_raw`)을 `BUY`/`HOLD`/`SELL`/`NR` 넷으로 정규화한 값.
  매수·Buy·비중확대·Outperform 등은 `BUY`, 중립·Hold·시장수익률은 `HOLD`,
  매도·Sell·비중축소는 `SELL`, 없음·Not Rated는 `NR`이다.
  표에 없는 값이 오면 `NR`로 두되 원문은 `rating_raw`에 그대로 남긴다.
- **`rating_inferred`** — `true`면 목표가는 있는데 원문 의견이 없어(`NR`) 같은 종목+증권사의
  직전(더 이른 날짜) 의견을 이어받은 것. 매 실행 다시 계산한다.
- **`suspect`** — 값이 의심스러운 이유. 앱은 통계에서 빼고 "확인 필요"로 표시한다.
  - `name_is_broker`: 종목명이 곧 증권사명(`…증권`)이고 제목도 그 회사 얘기가 아님.
    한경 소스에서 이런 행은 원문 입력 오류라 아예 버린다.
  - `target_range`: 목표가가 기준가의 0.3~3배 밖. 기준가는 본인 `price_at_write` →
    같은 종목 다른 리포트의 `price_at_write`(작성일 ±7일 안) → 판정 시점 현재가 순.
    리포트마다 한 번(처음 모았을 때, 목표가가 바뀌었을 때)만 판정하고 결과를 남긴다.
    주가가 나중에 움직여도 다시 판정하지 않는다. 목표가 값은 그대로 둔다.
- **`detail_tries`** — 수집기 내부용. 상세에서 의견을 못 뽑은 횟수. 3회가 되면 더 요청하지 않는다.
- **`target_change`** — 같은 `code` + 같은 `broker`의 **직전(더 오래된 날짜)** 리포트
  목표가와 비교한 결과. `up`/`down`/`same`, 직전 리포트가 없으면 `new`,
  둘 중 하나라도 목표가가 없으면 `null`. 매 실행마다 전체 이력을 놓고 다시 계산한다.
  우리 이력에 직전 리포트가 없어 `new`가 될 건은 네이버가 알려주는 `naver_prev_target`이
  있으면 그 값으로 `prev_target`을 채우고 다시 판정한다.
- **`naver_prev_target`·`price_at_write`** — 네이버 상세가 주는 직전 목표가(`prevGoalPrice`)와
  작성일 종가(`priceAtWriteDate`). 우리가 이력으로 계산하는 `prev_target`과는 별개 필드이고,
  네이버 소스가 아닌 리포트에서는 `null`이다(중복 병합으로 네이버 값을 받은 경우 제외).
- **`source`** — `naver`·`kb`·`nh`·`kis`·`hankyung`. `id`는 `소스:원본키` 꼴이다
  (`naver:96032`, `kb:20260904133704237K`, `nh:000000000000147095`, `kis:159058`).
- **`code`** — 종목코드. 2026년부터 영문자를 품는 신형 코드가 섞여 나온다
  (`0126Z0` 삼성에피스홀딩스, `00680K` 미래에셋증권2우B, `0167A0` SOL AI반도체TOP2플러스).
  여섯 자리이고 첫 자리는 늘 숫자다. 수집기·앱 모두 `\d{6}`이 아니라
  `[0-9][0-9A-Z]{5}`로 판정한다. 시세 API도 영문자 코드를 그대로 받는다.
- **중복** — 같은 (`code`, `date`, 정규화한 `broker`)는 한 건만 남긴다. 제목이 같으면
  (공백·문장부호 무시) 합치고, 같은 소스에서 제목이 다르면 둘 다 남긴다(하루 두 편).
  다른 소스끼리 제목이 다르면 한쪽이 한경일 때만 같은 리포트로 본다. 남는 쪽은
  naver > kb·nh·kis > hankyung 순이고, 빈 `analyst`·`target`·`rating_raw`·`summary`·`pdf`는
  합쳐지는 쪽에서 채운다. 매 실행 전체 레코드에 다시 돌린다.
- 작성월이 730일 전 날짜가 속한 달보다 이전이면 그 달 파일을 통째로 지운다.
- 저장은 내용이 바뀐 파일만 다시 쓴다(바이트 비교). 보통 한 번의 실행에서 바뀌는 파일은
  당월 리포트·요약, `prices.json`, `meta.json`이다.

- **`industry`·`sector`** — 종목의 업종과 대분류. 아래 *업종 분류* 참고. 매 실행마다
  전체 레코드에 다시 붙인다. 분류표에 없는 종목(신규 상장·스팩 등)은 둘 다 `null`이다.

v1 `data/reports.json`(전체 배열 한 파일)이 남아 있고 `data/reports/`가 없으면, 수집기가
처음 실행할 때 읽어서 v2로 옮기고 지운다. 저장은 임시파일에 쓴 뒤 이름을 바꾸는 방식이라,
도중에 죽어도 반쪽짜리 JSON이 남지 않는다.

## 업종 분류

**출처는 네이버 증권 업종 API(`https://m.stock.naver.com/api/stocks/industry`)** 다.
업종 목록에서 업종 79개를 읽고, 업종마다 `/{no}?page=N&pageSize=100`을 열어 소속 종목코드를
모은다(요청 간격 0.4초, 총 80회 정도). 결과는 `data/sectors.json`에 이렇게 쌓인다.

```json
{
  "updated_at": "2026-09-08T10:27:31+09:00",
  "industries": {"반도체와반도체장비": "IT", "제약": "헬스케어", "…": "…"},
  "codes": {"005930": "반도체와반도체장비", "…": "…"}
}
```

**갱신 주기는 7일**이다. `data/sectors.json`이 없거나 `updated_at`이 7일 이상 지났을 때만
다시 받는다. `--refresh-sectors`로 강제할 수 있고 `--no-sectors`로 건너뛴다.
수집에 실패하면 기존 파일을 그대로 쓰고 경고만 남긴다(업종이 없어도 나머지 수집은 계속된다).

대분류(`sector`)는 `scraper/sectors.py`의 `SECTOR_MAP`에 **하드코딩**한 표를 따른다.
네이버 업종 79개를 다음 11개로 접는다.

`IT` · `헬스케어` · `금융` · `산업재` · `경기소비재` · `필수소비재` · `소재` · `에너지` ·
`유틸리티` · `통신·미디어` · `기타`

네이버가 업종을 새로 만들어 표에 없는 이름이 나오면 그 업종은 `기타`로 두고 경고를 남긴다.
`test_parsers.py`가 79개 업종이 하나도 빠짐없이 매핑되는지 검사하므로, 업종이 늘거나
이름이 바뀌면 테스트가 먼저 깨진다. KB·NH가 자체적으로 주는 업종 값은 쓰지 않는다
(소스마다 기준이 달라 섞이면 집계가 어긋난다).

## 리포트 기능

리포트 관련 화면은 전부 `app/parts/09_reports.js` 한 파일에 있다. 시세(`naverRealtime`·
`QUOTES`), 유니버스(종목명·업종·시총), 트리맵(`squarify`), 테마·표·패널 CSS는 앱의 기존 것을
그대로 쓴다(중복 구현 없음). 리포트 쪽 `localStorage` 키는 `rr:` 접두를 붙여 대시보드 설정
(`stockHelper.v1`)과 분리했다.

### 리포트 탭

- **기간** 오늘 / 3일 / 1주 / 1개월 / 전체.
  휴장일에 빈 화면이 되지 않도록 오늘이 아니라 **데이터의 최신 날짜**를 기준으로 센다.
- **필터** 증권사 다중 선택, 레이팅(BUY·HOLD·SELL·NR), 목표가 변동(상향·하향·신규),
  업종(대분류 칩 다중 선택 + 세부 업종 하나), 검색. 세부 업종 목록에는 **지금 조건에 실제로
  있는 업종만** 건수와 함께 뜬다.
- **검색 자동완성** 타이핑 중에는 표를 다시 그리지 않고 드롭다운만 갱신한다. 종목(리포트 수
  많은 순)·증권사를 제안하고, 고르면 칩으로 남는다. Enter만 치면 제목까지 훑는 자유 텍스트
  검색이 걸린다. 빈 입력창에서 Backspace를 누르면 마지막 칩이 빠진다.
- **정렬** 표 머리를 눌러 오름/내림. 값이 빈 행은 방향과 상관없이 항상 아래로 내린다.
- **점진 렌더** 정렬·집계는 전체를 대상으로 끝내고, 그리는 행만 500개씩 끊는다.
- **종목별** 같은 종목의 리포트를 묶어 업종, 리포트 수, 의견 분포, 평균·최고·최저 목표가,
  현재가, 평균 목표가 기준 괴리율을 보여준다.
- **업종별** 대분류 → 세부 업종 2단계. 행을 누르면 리포트 뷰로 옮겨 가며 그 업종만 남는다.
- **히트맵** 타일 크기 = 리포트 수, 구획 = 대분류. 색은 괴리율 또는 BUY 비율.
  괴리율 색은 **0%가 아니라 지금 화면에 있는 종목들의 중앙값을 중립**으로 두고
  사분위 범위(IQR)로 포화시킨다. 시장 전체가 한쪽으로 쏠린 기간에도 상대 대비가 살아 있다.
  범례가 실제 기준값(`중앙값 ±IQR`)을 그대로 적어 준다. 타일을 누르면 그 종목만 남는다.
- **현재가** 리포트 탭이 열려 있는 동안, 화면에 보이는 종목(최대 120개)의 시세를 앱의 기존
  자동갱신 타이머에 얹어 함께 받아 온다. 장외에는 1회만 받는다(타이머를 따로 두지 않는다).
  괴리율은 실시간가로 다시 계산한 값이고, 시세가 없으면 수집 시점 종가를 쓴다.

### 다른 탭과의 연동

- **대시보드 → 오늘의 리포트** 최신 영업일의 리포트 건수·BUY 비율·목표가 상향/하향·평균
  괴리율과, 목표가를 올린 종목을 괴리율 순으로 최대 8건. "더 보기"로 리포트 탭으로 간다.
- **종목분석 → 증권사 리포트** 선택 종목의 최근 3개월 컨센서스(평균·최고·최저 목표가,
  BUY 비율, 현재가 대비 괴리율)와 리포트 30건. 리포트가 없으면 "최근 리포트 없음".
- **리포트 표 → 종목분석** 종목명을 누르면 종목분석 탭에서 그 종목이 열린다.
  네이버 금융은 코드 옆 작은 `↗` 아이콘으로 따로 열 수 있다.
- **스크리너** 선택 컬럼에 `리포트(1M)`(최근 1개월 리포트 수)와 `컨센 괴리율`(같은 기간
  평균 목표가 대비)이 있다. 스캔 결과에 붙여 정렬·CSV까지 그대로 쓸 수 있다.

## 배포 설정

1. 저장소를 GitHub에 올린다.
2. **Settings → Actions → General → Workflow permissions** 에서
   *Read and write permissions* 를 켠다. 수집 결과를 커밋해야 하기 때문이다.
3. Pages는 워크플로가 `enablement: true`로 알아서 켠다.
   (자동으로 안 되면 **Settings → Pages → Source** 를 *GitHub Actions* 로 바꾼다.)
4. `main`에 처음 밀면 바로 수집 + 배포가 한 번 돈다.
   이후에는 평일 KST 07:00~19:00 매시 정각에 자동으로 돈다.
   **Actions → 리포트 수집 및 배포 → Run workflow** 로 수동 실행도 된다.

수집(`collect`)과 배포(`deploy`)를 한 워크플로에 묶어 둔 이유가 있다.
`schedule`로 돌아간 워크플로가 밀어넣은 커밋은 다른 워크플로를 다시 깨우지 않기 때문에,
배포를 별도 워크플로로 떼어 두면 데이터만 쌓이고 사이트는 갱신되지 않는다.

### 소스 정지 경보

2026-09-14에 네이버가 리서치 페이지를 옮겨 1차 소스가 사흘 동안 0건이었는데도
워크플로는 계속 success였다. 수집이 "성공"해도 알맹이가 없을 수 있어서,
수집기는 `data/meta.json` 의 `source_status` 에 소스별 최신 리포트 날짜(`last_date`),
이번 실행 신규 건수(`new_run`), 보관 건수(`total`)를 남긴다.
워크플로는 데이터를 커밋·push한 **뒤에** `python scraper/check_sources.py` 를 돌려,
KST 오늘 기준으로 어떤 소스의 최신 리포트가 2영업일(한경은 3영업일) 이상 밀렸으면
`::error::` 를 찍고 잡을 실패시킨다 — 그러면 GitHub가 메일로 알려 준다.
커밋 뒤에 두었으므로 경보가 떠도 그날 모은 데이터는 그대로 남고,
`deploy` 잡도 `if: always()` 라 사이트는 평소대로 갱신된다.
주말에는 리포트가 나오지 않으므로 점검을 건너뛴다.
화면에서도 리포트 탭 개요 소제목 옆에 소스별 최신일이 작게 붙고,
밀린 소스는 붉게 표시된다.

## 알아 둘 것

- **네이버 리서치 목록은 과거를 오래 보관하지 않는다.** 넓은 날짜 범위를 한 번에 요청하면
  최근 것부터 페이지를 채워 준다. `--days`를 크게 줘도 아주 오래된 리포트까지
  거슬러 올라가지는 못한다.
- 목록 페이지에서 파싱되는 행 수는 요청한 페이지 크기보다 적을 수 있다(종목코드가 없는
  행 등). 그래서 "행이 적으면 마지막 페이지"라고 판단하지 않고, 페이지네이션이 알려주는
  마지막 페이지 번호를 따라간다.
- 현재가는 조회 시점 값이라 장중에 돌리면 실시간가, 장 마감 후에는 종가가 들어온다.
  `price_date`는 조회한 날짜다.
- **KB증권 목록에는 산업 리포트가 대표 종목코드를 달고 섞여 온다.** (예: 제약 위클리가
  `stkCd` 128940인데 제목은 `제약 (350510)`) 제목의 `(코드)`와 `stkCd`가 같을 때만
  종목 리포트로 본다. 그래서 종목명이 제목에 안 들어간 KB 리포트는 빠질 수 있다.
- **NH·한투는 의견·목표가를 자연어에서 캔다.** NH는 요약문, 한투는 상세 본문에서
  `투자의견 …`, `목표주가 … 원`을 찾는다. 본문이 수치를 PDF에만 적어 두면
  `rating_raw`·`target`이 `null`로 남는다(한투 스몰캡·간담회 노트가 특히 그렇다).
  `기존 170,000원` 같은 직전 목표가는 건너뛰고 새 목표가를 집는다.
  의견을 못 캔 NH·한투 건은 다음 수집 때 수집 범위 안이면 한 번 더 시도한다.
- 한국투자증권 PDF는 로그인해야 열린다. 그래서 `pdf`는 `null`이고 제목을 누르면
  상세 페이지가 열린다. NH는 로그인 없이 열리는 PDF 직링크를 준다.
- 이 페이지는 리포트를 모아 보여줄 뿐 투자 권유가 아니다. 판단과 책임은 투자자 본인에게 있다.
