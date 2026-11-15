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

### `data/reports/YYYY-MM.json`
그 달(`date` 기준) 리포트 레코드 배열, 날짜 내림차순.
필드: `id, source, date, code, name, industry, sector, title, broker, analyst, rating_raw, rating, target, prev_target, target_change, naver_prev_target, price_at_write, pdf, url, views`
- v1에서 빠지는 필드: `summary`(→ summaries), `price`, `price_date`, `gap`(→ prices.json, 괴리율은 앱이 계산).
- 추가 필드(없으면 생략 가능):
  - `suspect`: 문자열. 값이 의심스러운 이유. 예 `"target_range"`(목표가가 기준가의 0.3~3배 밖), `"name_is_broker"`. 앱은 이 레코드를 통계에서 빼고 "확인 필요"로 표시한다.
  - `rating_inferred`: `true`면 원문에 의견이 없어 같은 종목+증권사의 직전 의견을 이어받은 것.
  - `has_summary`: `true`면 summaries 파일에 요약이 있다.
- 같은 (code, date, 정규화한 broker, 공백·문장부호를 뗀 title)은 한 건만 존재한다. 같은 증권사가 같은 날 같은 종목에 제목이 다른 리포트를 두 건 내는 경우(실적 리뷰 + 컨퍼런스콜 요약 등)는 둘 다 둔다.
  - `detail_tries`: 수집기 내부용. 상세 재요청 실패 횟수(3회면 포기). 앱은 무시한다.

### `data/summaries/YYYY-MM.json`
`{ "<id>": "<요약 본문>" }`. 앱은 그 달의 행을 처음 펼칠 때 받는다.

### `data/prices.json`
`{ "updated_at": "...", "prices": { "005930": {"p": 209000, "d": "2026-11-13"} } }`
리포트에 등장하는 모든 종목의 수집 시점 현재가. 앱은 라이브 시세를 못 받은 종목의 대체값으로 쓴다.

### `data/perf.json` (성과, 하루 1회 갱신)
`{ "updated_at": "...", "items": { "<id>": {"paw": 27150, "max": 31000, "min": 25000, "hit": "2026-11-20"} } }`
- `paw`: 발간일 종가(네이버 `price_at_write`가 있으면 그 값). `max`/`min`: 발간 다음 거래일 이후 고가 최댓값/저가 최솟값. `hit`: 고가가 목표가에 처음 닿은 날짜 또는 `null`.
- 목표가가 없거나 `suspect`인 레코드는 넣지 않는다.

### `data/industry/YYYY-MM.json` (산업·시황 리포트)
배열. 필드: `id, kind("industry"|"market"), date, title, broker, analyst, category(산업 리포트의 업종명, 없으면 null), pdf, url, views`

### `data/reports.json` (v1)
수집기가 처음 v2로 돌 때 이 파일을 읽어 위 형식으로 옮기고 삭제한다. 앱은 `meta.json`에 `months`가 없으면 v1 방식으로 이 파일을 읽는다(전환 구간 대비).

## 보관 기간
730일. 지난 달 파일은 통째로 지운다(달 단위).
