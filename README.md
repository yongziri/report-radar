# 리포트 레이더

국내 증권사의 종목 리포트를 매일 자동으로 모아 한 화면에서 훑어보는 정적 사이트.
리포트 제목·증권사·투자의견·목표주가·현재가·괴리율을 표로 보여주고 기간·증권사·레이팅으로
걸러 볼 수 있다. 수집은 GitHub Actions가 대신 돌리고, 결과는 GitHub Pages로 올라간다.

## 구조

```
report-radar/
├─ index.html                    # 화면 전부. 외부 라이브러리 없는 단일 파일
├─ data/
│  ├─ reports.json               # 리포트 누적 (최근 180일, 최신순 배열)
│  └─ meta.json                  # 갱신 시각·건수·최신 리포트 날짜·증권사 목록
├─ scraper/
│  ├─ collect.py                 # 수집기 (CLI)
│  ├─ parsers.py                 # 순수 파싱·계산 함수 (네트워크를 타지 않음)
│  ├─ test_parsers.py            # 픽스처 기반 테스트
│  └─ requirements.txt
└─ .github/workflows/collect.yml # 수집 cron + Pages 배포
```

화면(`index.html`)은 `data/*.json`을 상대경로로 `fetch` 할 뿐이다. 빌드 단계가 없으므로
Node도, 번들러도 필요 없다.

## 데이터 소스

| 소스 | 쓰임 | 비고 |
| --- | --- | --- |
| [네이버 금융 리서치](https://finance.naver.com/research/company_list.naver) | 리포트 목록·목표가·투자의견·요약 | 응답이 **EUC-KR**이다. HTML 메타는 utf-8이라고 거짓말하므로 강제로 디코딩한다 |
| 네이버 실시간 시세 API | 현재가 | 한 번에 100종목씩 조회 |
| [한경 컨센서스](https://consensus.hankyung.com/analysis/list?report_type=CO) | 애널리스트명 보강, 네이버에 없는 리포트 추가 | **브라우저 UA 필수**. 아니면 본문이 `Block access`로 돌아온다 |

네이버 레코드와 한경 레코드는 `(종목코드, 작성일, 증권사 정규화명)`으로 맞춰 붙인다.
한경 수집이 실패해도 전체 수집은 계속된다(경고만 남긴다).

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
python scraper/collect.py --no-hankyung --no-price
```

요청 사이에 0.4초를 쉬고, 실패하면 2회까지 다시 시도한다. 상세 페이지를 못 읽어도
목록에서 얻은 정보만으로 저장한다(목표가·투자의견은 `null`).
종료 코드는 네이버 목록을 한 건도 받지 못했을 때만 `1`, 그 밖에는 `0`이다.

### 테스트

```bash
python scraper/test_parsers.py
```

네트워크 없이 픽스처 문자열만으로 돈다. 목록·상세·한경 파서, 투자의견 정규화,
괴리율, 목표가 변동 판정을 검증한다.

### 화면 확인

`file://`로 열면 브라우저 보안 정책 때문에 JSON을 못 읽는다. 반드시 서버로 띄운다.

```bash
python -m http.server 3491
# http://localhost:3491
```

## 레코드 스키마

`data/reports.json`은 최신순 배열이고, 각 항목은 다음과 같다.

```json
{
  "id": "naver:96032",
  "source": "naver",
  "date": "2026-09-07",
  "code": "031980",
  "name": "피에스케이홀딩스",
  "title": "홀딩스의 시간이 온다",
  "broker": "DS투자증권",
  "analyst": null,
  "rating_raw": "매수",
  "rating": "BUY",
  "target": 200000,
  "prev_target": 180000,
  "target_change": "up",
  "pdf": "https://stock.pstatic.net/.../20260907_company_169484000.pdf",
  "url": "https://finance.naver.com/research/company_read.naver?nid=96032",
  "summary": "…",
  "views": 4031,
  "price": 152000,
  "price_date": "2026-09-07",
  "gap": 31.58
}
```

- **`rating`** — 원문(`rating_raw`)을 `BUY`/`HOLD`/`SELL`/`NR` 넷으로 정규화한 값.
  매수·Buy·비중확대·Outperform 등은 `BUY`, 중립·Hold·시장수익률은 `HOLD`,
  매도·Sell·비중축소는 `SELL`, 없음·Not Rated는 `NR`이다.
  표에 없는 값이 오면 `NR`로 두되 원문은 `rating_raw`에 그대로 남긴다.
- **`gap`** — 괴리율 `(목표가 − 현재가) / 현재가 × 100`, 소수 2자리. 둘 중 하나라도
  없으면 `null`.
- **`target_change`** — 같은 `code` + 같은 `broker`의 **직전(더 오래된 날짜)** 리포트
  목표가와 비교한 결과. `up`/`down`/`same`, 직전 리포트가 없으면 `new`,
  둘 중 하나라도 목표가가 없으면 `null`. 매 실행마다 전체 이력을 놓고 다시 계산한다.
- 중복 판정 키는 `id`다. 이미 저장된 리포트의 본문은 건드리지 않고,
  `price`·`gap`·`prev_target`·`target_change`만 실행할 때마다 새로 채운다.
- 작성일이 180일보다 오래된 건은 저장할 때 걸러낸다.

저장은 임시파일에 쓴 뒤 이름을 바꾸는 방식이라, 도중에 죽어도 반쪽짜리 JSON이 남지 않는다.

## 화면 기능

- **기간** 오늘 / 3일 / 1주 / 1개월 / 전체.
  휴장일에 빈 화면이 되지 않도록 오늘이 아니라 **데이터의 최신 날짜**를 기준으로 센다.
- **필터** 증권사 다중 선택, 레이팅(BUY·HOLD·SELL·NR), 목표가 변동(상향·하향·신규),
  검색(종목명·코드·제목·증권사·애널리스트, 200ms 디바운스).
- **정렬** 표 머리를 눌러 날짜·종목명·증권사·의견·목표주가·현재가·괴리율 기준으로 오름/내림.
  값이 빈 행은 방향과 상관없이 항상 아래로 내린다.
- **종목별 보기** 같은 종목의 리포트를 묶어 리포트 수, 의견 분포, 평균·최고·최저 목표가,
  현재가, 평균 목표가 기준 괴리율을 보여준다.
- 제목을 누르면 PDF(없으면 상세 페이지)가 새 탭에서 열리고, 옆의 `▾`로 요약을 펼친다.
- 필터·정렬 상태는 `localStorage`에 저장한다(저장소를 막아둔 브라우저에서도 그냥 돈다).
- 다크/라이트는 `prefers-color-scheme`을 따라간다. 외부 CDN이나 웹폰트를 쓰지 않는다.

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

## 알아 둘 것

- **네이버 리서치 목록은 과거를 오래 보관하지 않는다.** 넓은 날짜 범위를 한 번에 요청하면
  최근 것부터 페이지를 채워 준다. `--days`를 크게 줘도 아주 오래된 리포트까지
  거슬러 올라가지는 못한다.
- 목록 페이지에서 파싱되는 행 수는 요청한 페이지 크기보다 적을 수 있다(종목코드가 없는
  행 등). 그래서 "행이 적으면 마지막 페이지"라고 판단하지 않고, 페이지네이션이 알려주는
  마지막 페이지 번호를 따라간다.
- 현재가는 조회 시점 값이라 장중에 돌리면 실시간가, 장 마감 후에는 종가가 들어온다.
  `price_date`는 조회한 날짜다.
- 이 페이지는 리포트를 모아 보여줄 뿐 투자 권유가 아니다. 판단과 책임은 투자자 본인에게 있다.
