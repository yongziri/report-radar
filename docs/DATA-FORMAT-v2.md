# 데이터 형식 v2 (2026-11 개편 규약)

수집기(`scraper/`)가 쓰고 앱(`app/parts/`)이 읽는 파일의 약속이다. 양쪽 작업자는 이 문서를 기준으로 한다.
v1은 `data/reports.json` 한 파일(전체 레코드 배열, 요약·현재가 포함)이었다.

## 원칙

- 리포트 레코드는 한 번 쓰면 거의 안 바뀐다. 자주 바뀌는 값(현재가, 성과)은 별도 파일로 뺀다.
- 한 번의 수집 실행에서 바뀌는 파일은 당월 파일 + `prices.json` + `meta.json` 정도여야 한다.
- 모든 JSON은 UTF-8, `ensure_ascii=False`, 키 순서 고정(불필요한 diff 방지).

## 파일

### `data/meta.json`
기존 필드(`updated_at`, `count`, `latest_date`, `brokers`, `source_status`) 유지 + 추가:

```json
{
  "data_version": 2,
  "months": [ {"month": "2026-11", "count": 1197, "v": "a1b2c3d4e5", "sv": "0f9e8d7c6b"} ],
  "prices_v": "1234567890",
  "perf_v": "abcdef0123",
  "industry_months": [ {"month": "2026-11", "count": 310, "v": "…"} ]
}
```
- `months`는 최신 달이 먼저. `v`는 `data/reports/YYYY-MM.json` 내용의 sha1 앞 10자, `sv`는 `data/summaries/YYYY-MM.json`의 것.
- 앱은 `?v=` 쿼리로 붙여 브라우저 캐시를 쓴다. 값이 같으면 다시 받지 않는다.
- `perf_v`, `industry_months`는 해당 파일이 생긴 뒤부터 기록한다(없으면 앱은 그 기능을 숨긴다).
- `source_status`의 소스 키: `naver`, `hankyung`, `kb`, `nh`, `kis`, `wise`. 각 `{last_date, new_run, total}`.
  `wise`에는 추가로 `fetched_at`(마지막으로 와이즈 목록을 받은 시각, ISO)과 `fetched_last_date`(응답에서 본
  가장 최근 작성일)가 붙는다. 와이즈 건은 상위 소스와 겹치면 흡수돼 사라지므로 `wise.last_date`는
  보관 중인 와이즈 단독 건의 최신일과 `fetched_last_date` 중 늦은 쪽이다.
  `hankyung`도 같은 이유(와이즈보다 아래라 겹치면 흡수됨)로 `fetched_last_date`가 붙는다.
  증권사 직접 수집 2차 소스 키 `im`(iM증권), `bnk`(BNK투자증권), `sangsangin`(상상인증권)도 항상 들어간다.
  이 건들은 같은 리포트가 네이버·와이즈·한경에 있으면 그 레코드에 붙고 사라지므로 `fetched_last_date`
  (목록에서 본 가장 최근 작성일)가 붙는다. `check_sources.py`의 정지 기준은 5영업일.
  `wise`와 직접 수집 2차 소스에는 시도 기록도 붙는다: `tried_at`(마지막 시도 시각, KST ISO)과,
  그 시도가 실패했을 때만 `error`(짧은 사유, 120자 이내. 예: `"ConnectTimeout"`, `"SSLError"`, `"HTTP 403"`,
  `"HTTP 200 non-JSON (text/html, 1532 bytes)"`, `"empty list"`). 다음에 성공하면 `error`는 지워진다.
  응답 본문·쿠키·헤더는 넣지 않는다. 와이즈는 실패하면 `tried_at` 기준 1시간 뒤에 다시 시도한다.
  `check_sources.py`는 날짜를 한 번도 얻은 적 없는 소스(`last_date`·`fetched_last_date` 모두 없음)를
  경고만 하고 잡을 실패시키지 않는다.

### `data/reports/YYYY-MM.json`
그 달(`date` 기준) 리포트 레코드 배열, 날짜 내림차순.
필드: `id, source, date, code, name, industry, sector, title, broker, analyst, rating_raw, rating, target, prev_target, target_change, naver_prev_target, price_at_write, pdf, url, views`
- `source`: `naver`, `kb`, `nh`, `kis`, `im`, `bnk`, `sangsangin`, `wise`(와이즈리포트), `hankyung`. 중복이면 이 순서(naver > kb·nh·kis·im·bnk·sangsangin > wise > hankyung)로 위쪽을 남긴다.
  - `im`·`bnk`·`sangsangin`(증권사 직접 수집 2차): `pdf`는 증권사 사이트의 공개 PDF, `url`도 같은 PDF
    (못 받았으면 목록 페이지). `views`·`price_at_write`·`naver_prev_target`은 `null`. 단독 레코드로 남는 것은
    네이버·와이즈·한경에 같은 리포트가 없을 때뿐이다(아래 `direct`).
  - `wise` 레코드: `pdf`는 `null`(원문은 로그인 필요), `url`은 종목별 리포트 목록 페이지
    (`https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=<code>`), `views`는 `null`(와이즈 조회수는 척도가 달라 쓰지 않음),
    `price_at_write`·`naver_prev_target`은 `null`.
- v1에서 빠지는 필드: `summary`(→ summaries), `price`, `price_date`, `gap`(→ prices.json, 괴리율은 앱이 계산).
- 추가 필드(없으면 생략 가능):
  - `suspect`: 문자열. 값이 의심스러운 이유. 예 `"target_range"`(목표가가 기준가의 0.3~3.5배 밖), `"name_is_broker"`. 앱은 이 레코드를 통계에서 빼고 "확인 필요"로 표시한다.
    `target_range`는 수집 때 한 번 판정하고, 하루 한 번 성과 단계에서 발간일 종가(휴장이면 직전 거래일)로 다시 판정한다.
    이때 기준가는 `price_at_write`가 그 종가와 2배 넘게 다르면 종가, 아니면 `price_at_write`, 없으면 종가다.
  - `rating_inferred`: `true`면 원문에 의견이 없어 같은 종목+증권사의 직전 의견을 이어받은 것.
  - `has_summary`: `true`면 summaries 파일에 요약이 있다.
- 같은 (code, date, 정규화한 broker, 공백·문장부호를 뗀 title)은 한 건만 존재한다. 같은 증권사가 같은 날 같은 종목에 제목이 다른 리포트를 두 건 내는 경우(실적 리뷰 + 컨퍼런스콜 요약 등)는 둘 다 둔다.
  - `detail_tries`: 수집기 내부용. 상세 재요청 실패 횟수(3회면 포기). 앱은 무시한다.
    직접 수집 2차 단독 레코드에서는 PDF에서 목표가를 못 읽은 횟수다.
  - `direct`: 문자열. 이 레코드에 붙은 증권사 직접 수집 2차 건의 id(예 `"im:15078"`, `"bnk:85446"`,
    `"sangsangin:4698"`). 같은 리포트(종목·증권사, 작성일 ±3일, 제목 유사)를 찾으면 직접 수집 건은 지우고
    여기에 붙인다. 와이즈·한경 레코드는 이때 `pdf`·`url`이 증권사 PDF로 바뀌고, 의견·목표가는 직접 수집
    값이 우선한다(목표가가 2배 넘게 다르면 기존 값 유지). 네이버 레코드는 빈 칸만 채운다.
    그래서 `source: "wise"`인데 `pdf`가 있는 레코드가 생긴다.

### `data/summaries/YYYY-MM.json`
`{ "<id>": "<요약 본문>" }`. 앱은 그 달의 행을 처음 펼칠 때 받는다.

### `data/prices.json`
`{ "updated_at": "...", "prices": { "005930": {"p": 209000, "d": "2026-11-13"} } }`
리포트에 등장하는 모든 종목의 수집 시점 현재가. 앱은 라이브 시세를 못 받은 종목의 대체값으로 쓴다.

### `data/perf.json` (성과, 하루 1회 갱신)
`{ "updated_at": "...", "items": { "<id>": {"paw": 27150, "max": 31000, "min": 25000, "hit": "2026-11-20"} } }`
- `paw`: 발간일 종가(네이버 `price_at_write`가 있으면 그 값). `max`/`min`: 발간 다음 거래일 이후 고가 최댓값/저가 최솟값. `hit`: 고가가 목표가에 처음 닿은 날짜 또는 `null`.
  - 발간일이 휴장일이면 직전 거래일 종가. `price_at_write`가 그 종가와 2배 넘게 다르면 종가를 쓴다(네이버 값이 틀린 경우가 있다).
  - 발간일이 마지막 거래일이면 `max`·`min`·`hit`가 `null`이다.
- 목표가가 없거나 `suspect`인 레코드는 넣지 않는다. 일봉을 못 받은 종목의 레코드도 빠진다.
- 갱신: 16:00 KST 이후 첫 실행, 또는 파일이 없거나 20시간 넘게 지났을 때. 내용이 같으면 파일을 다시 쓰지 않는다.

### `data/industry/YYYY-MM.json` (산업·시황 리포트)
배열. 필드: `id, kind("industry"|"market"), date, title, broker, analyst, category(산업 리포트의 업종명, 없으면 null), pdf, url, views`
- 날짜 내림차순(같은 날은 id 내림차순), 한 줄에 한 레코드. `id`는 `industry:<researchId>` / `market:<researchId>`.
- `analyst`는 네이버가 주지 않아 늘 `null`. `pdf`는 상세에서 받으며 못 받으면 `null`. `views`는 처음 수집할 때의 조회수.

### `data/reports.json` (v1)
수집기가 처음 v2로 돌 때 이 파일을 읽어 위 형식으로 옮기고 삭제한다. 앱은 `meta.json`에 `months`가 없으면 v1 방식으로 이 파일을 읽는다(전환 구간 대비).

## 보관 기간
730일. 지난 달 파일은 통째로 지운다(달 단위).
