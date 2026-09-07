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
│  ├─ brokers.py                 # 증권사 직접 수집 (KB·NH·한투 네트워크 호출)
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
| [KB증권 리서치](https://rc.kbsec.com/) | KB증권 리포트 (`source: "kb"`) | 목록 JSON에 의견·목표가·요약이 다 들어 있다. **JSON 바디로 POST** 해야 한다(form이면 500) |
| [NH투자증권 리서치](https://www.nhsec.com/research/boardList.action?rsh_ppr_dit_cd=01) | NH투자증권 리포트 (`source: "nh"`) | 목록엔 의견·목표가가 없어 요약문에서 캔다. 응답 인코딩이 **EUC-KR**인데 본문은 JSON이다 |
| [한국투자증권 리서치](https://securities.koreainvestment.com/main/research/research/Strategy.jsp?jkGubun=10) | 한국투자증권 리포트 (`source: "kis"`) | **브라우저 UA 필수**. 의견·목표가는 상세 본문에서 캔다. PDF는 로그인이 필요해 `pdf`가 `null`이다 |

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
```

요청 사이에 0.4초를 쉬고, 실패하면 2회까지 다시 시도한다. 상세 페이지를 못 읽어도
목록에서 얻은 정보만으로 저장한다(목표가·투자의견은 `null`).
종료 코드는 네이버 목록을 한 건도 받지 못했을 때만 `1`, 그 밖에는 `0`이다.

### 테스트

```bash
python scraper/test_parsers.py
```

네트워크 없이 픽스처 문자열만으로 돈다. 목록·상세·한경·KB·NH·한투 파서,
본문에서 의견·목표가를 캐는 추출기, 투자의견 정규화, 괴리율, 목표가 변동 판정을 검증한다.

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
- **`source`** — `naver`·`kb`·`nh`·`kis`·`hankyung`. `id`는 `소스:원본키` 꼴이다
  (`naver:96032`, `kb:20260904133704237K`, `nh:000000000000147095`, `kis:159058`).
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
