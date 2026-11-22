# 앱 버전(모바일) 설계 — 공도 투자 연구소

2026-11-22. PC 버전(`index.html`)은 그대로 두고, 폰 전용 화면을 가진 앱 버전을 따로 만든다.
앱 버전은 `https://yongziri.github.io/report-radar/m/` 에 배포하고 PWABuilder로 안드로이드 APK(TWA)를 만든다.

## 1. 원칙

- **엔진은 하나, 화면은 둘.** 시세·리포트 로더·계산·저장(localStorage) 코드는 `app/parts/03~11_*.js` 를 그대로 쓴다.
  앱 버전은 그 위에 폰 전용 골격·스타일·렌더러를 얹는다.
- **PC 버전의 동작은 바뀌지 않는다.** 공유 파트(`app/parts/*`)는 고치지 않는 것이 기본이고, 꼭 필요하면
  전역 플래그로 감싼 최소 변경만 한다. PC 빌드 결과가 달라지면 이유를 보고한다.
- 같은 출처라 PC 버전과 앱 버전은 같은 기기·브라우저에서 관심종목·계좌·설정을 공유한다(같은 localStorage 키).
- 데이터(`data/`)·폰트(`fonts.css`)·아이콘(`icons/`)은 저장소 루트의 것을 같이 쓴다. 복사본을 만들지 않는다.

## 2. 빌드와 파일

`python app/build.py` 한 번에 두 산출물이 나온다.

| 산출물 | 내용 |
|---|---|
| `index.html`, `sw.js` | PC 버전 (기존) |
| `m/index.html`, `m/sw.js`, `m/manifest.webmanifest` | 앱 버전 |

앱 전용 소스는 `app/mobile/` 에 둔다. 화면별로 파일을 나눠 여러 사람이 동시에 고쳐도 겹치지 않게 한다.

| 파일 | 담당 |
|---|---|
| `m_head.html` | 메타 태그, 공통 모바일 CSS(토큰·골격·공용 컴포넌트) |
| `m_shell.html` | 앱 바, 하단 탭 바, 시트·토스트 컨테이너, 화면 틀 |
| `m_core.js` | 화면 전환, 히스토리(뒤로가기), 바텀 시트, 당겨서 새로고침, 공용 헬퍼 |
| `m_home.js` / `m_home.css` | 홈 |
| `m_reports.js` / `m_reports.css` | 리포트 |
| `m_stock.js` / `m_stock.css` | 종목 |
| `m_assets.js` / `m_assets.css` | 내 자산 |
| `m_more.js` / `m_more.css` | 더보기(스크리너·알림·설정) |
| `m_manifest.json`, (서비스 워커는 `app/sw.src.js` 재사용) | PWA |

- 앱 빌드는 PC의 CSS(`01_head.html`의 스타일)와 본문(`02_body.html`)을 포함한 뒤 모바일 계층을 얹는다.
  공유 JS가 찾는 요소 id가 모두 있어야 하기 때문이다. 필요 없는 PC 전용 요소는 CSS로 숨기거나 초기화 때 옮긴다.
- 전역 상수 `IS_APP`(앱 빌드에서 `true`)과 `APP_BASE`(루트 자원 경로 접두어, PC `""`, 앱 `"../"`)를 빌드가 넣는다.
  공유 코드에서 `data/…`·`icons/…` 같은 상대 경로를 만드는 곳은 `APP_BASE`를 붙인다(동작 불변의 최소 변경).
- 앱의 서비스 워커는 범위가 `/report-radar/m/` 이다. 루트 워커와 캐시 이름이 겹치지 않게 한다.

## 3. 화면 구성

하단 탭 5개. 탭 바는 항상 보이고(높이 56px + 안전 영역), 위에는 앱 바(마크·화면 제목·검색·새로고침)가 있다.

| 탭 | 담는 것 (PC 버전의 어느 부분인지) |
|---|---|
| 홈 | 지수 카드(KOSPI·KOSDAQ), 장 상태, 시장 폭, 내 종목 리포트, 오늘의 리포트, 상승·하락·거래대금 상위(세그먼트 전환, 5개 + 더 보기), 업종 등락, 뉴스, 공시. 시가총액 지도와 경제 캘린더는 접어 둔다 |
| 리포트 | 하위 뷰는 가로로 미는 칩(리포트·목표가 변경·종목별·업종별·히트맵·성적표·산업·시황). 기간 칩 한 줄, 나머지 필터는 "필터" 버튼 → 바텀 시트. 목록은 카드 |
| 종목 | 검색(최근 본 종목), 종목 머리(이름·현재가·등락), 차트(기간 칩, 터치로 값 읽기, 목표가 켜기/끄기), 지표 2열, 리포트 컨센서스와 목록, 뉴스·공시. 기업분석(외부 페이지)은 세그먼트로 두고 "새 창에서 열기"를 앞에 둔다 |
| 내 자산 | 세그먼트 [관심종목 \| 계좌]. 관심종목은 한 줄 2단 행(이름·현재가·등락), 계좌는 요약 카드 + 보유 카드. 추가·수정은 바텀 시트 |
| 더보기 | 스크리너, 알림(가격·리포트), 설정(테마·색·갱신 주기), 백업·복원·가져오기, PC 버전 열기, 정보(데이터 기준 시각·소스 상태) |

전역 규칙:
- 뒤로가기(안드로이드 버튼·제스처): 시트가 열려 있으면 시트를 닫고, 아니면 이전 화면으로, 홈에서는 앱을 나간다. `history` 기반.
- 앱 바의 검색은 어디서든 종목 탭의 종목으로 이동시킨다.
- 다른 화면의 종목 이름을 누르면 종목 탭이 그 종목으로 열린다.

## 4. 폰 화면 규칙

- 기준 폭 360~430px, 세로 방향. 가로 스크롤이 생기는 페이지가 없어야 한다(`scrollWidth === innerWidth`).
  넓은 표는 카드/2줄 행으로 바꾸거나, 불가피하면 그 표만 안에서 민다(첫 열 고정).
- 누르는 대상은 44px 이상. 본문 15px, 보조 13px, 최소 12px. 숫자는 `tabular-nums`.
- 마우스 올림(hover)에 의존하는 정보는 누름(tap)으로도 볼 수 있어야 한다.
- `viewport-fit=cover`, 안전 영역(`env(safe-area-inset-*)`), `100dvh`, `overscroll-behavior-y: contain`.
- 다크가 기본, 라이트 지원. 색 토큰은 PC 버전 것을 쓴다. 등락 색 설정(한국식/글로벌)도 그대로 따른다.
- 불러오는 중·비어 있음·실패 상태를 각 화면에 둔다.
- 홈과 내 자산은 당겨서 새로고침.

## 5. PWA / APK 요건

- `m/manifest.webmanifest`: name "공도 투자 연구소", short_name "공투연", `start_url`·`scope` 는 `./`,
  `display: standalone`, `orientation: portrait`, 아이콘은 루트 `icons/` 의 192·512·maskable, 바로가기(리포트, 내 자산).
- 설치 가능 조건(HTTPS, 서비스 워커, 아이콘)을 만족하고 오프라인에서 마지막 데이터로 열린다.
- APK는 PWABuilder(TWA). 패키지 서명 지문은 `yongziri.github.io` 저장소의 `.well-known/assetlinks.json` 에 추가한다.

## 6. 검증 기준

- 헤드리스 크롬으로 360×800, 390×844, 412×915 에서 5개 탭과 주요 하위 화면의 스크린샷을 남긴다.
- 콘솔 오류 0, 가로 넘침 0. 뒤로가기 동작 확인.
- PC 빌드 회귀: `node app/test_parsers.mjs` 통과, PC 화면 7개 탭이 이전과 같이 열린다.

## 7. 화면 개발 안내

M1(기초) 구현 기준. 화면 다듬기(폴리시)는 화면 하나에 한 사람(에이전트)씩 나눠 맡는다.

### 7.1 파일과 규칙

- **화면 하나 = `app/mobile/m_<화면>.js` + `m_<화면>.css` 한 쌍.** 맡은 쌍만 고친다.
  화면 이름: `home`, `reports`, `stock`, `assets`, `more` (뿌리 요소 `#m-home` … `#m-more`).
- `m_core.js` · `m_shell.html` · `m_head.html` 은 공용이다. 고쳐야 하면 무엇을 왜 고쳤는지 보고에 적는다.
  공유 파트(`app/parts/*`)는 원칙 1 그대로 — 최소 변경, 보고 필수.
- 화면 CSS 규칙은 모두 자기 뿌리 선택자(`#m-home …`) 아래로 한정한다. 다른 화면에 새지 않게.
- 각 `m_<화면>.js` 머리 주석의 `TODO(폴리시 단계)` 가 그 화면의 할 일 목록이다.
- 빌드 순서: 공유 JS(03~11, 07) → `m_core.js` → `m_home` `m_reports` `m_stock` `m_assets` `m_more` → `mBoot()`.
  모두 한 `<script>` 안이라 공유 전역(`S`, `AN`, `CMP`, `QUOTES`, `RPT`, `curTab`, `$`, `$$`, `esc`, `toast` …)을 그대로 쓴다.
- 빌드 상수: `IS_APP`(앱 `true`), `APP_BASE`(앱 `"../"`). 공유 코드에서 루트 자원을 읽는 곳은 `rpFetchJson()` 하나뿐이다.

### 7.2 화면 등록 (`m_core.js`)

```js
mScreen("home", {
  title: "홈",                      // 또는 function(params){ return "…"; }
  mount: function(root){ … },       // 부팅 때 한 번 — 07 init() 보다 먼저. PC 패널을 root 로 옮긴다
  show: function(params, prev){ … },// 화면이 보일 때·파라미터가 바뀔 때마다
  hide: function(){ … },            // (선택) 다른 화면으로 떠날 때
  refresh: function(){ return promise; }, // (선택) 앱 바 새로고침·당겨서 새로고침 때 시세 갱신과 함께
  reselect: function(){ return true; }    // (선택) 탭 바에서 지금 탭을 다시 눌렀을 때. true 면 기본 동작(맨 위로) 생략
});
```

- `mount` 는 init 전에 돌기 때문에 **공유 렌더 함수를 부르지 말고 DOM 배치만** 한다. 렌더는 `show` 에서.
- 공유 렌더 함수를 감싸 폰 화면을 다시 그릴 때는 **그 화면이 보일 때만** 그린다(`M.cur === "<화면>"`, 아니면 표시만 해 두고
  `show` 에서 그린다). 시세 갱신(`refreshAll`)은 1분마다 `renderWatchlist`·`renderPortfolio`·`renderAccounts`·`renderMarket`·
  `renderAnalysisHead` 를 부르므로, 숨은 화면이 캔버스·큰 DOM 을 다시 그리면 그 비용이 매번 든다.
- 여러 모듈이 같은 전역을 감싼다. 각 감싸기는 mount 때의 값을 잡아 두고 한 번만 부르므로 순서와 관계없이 사슬이 이어진다
  (아래 바깥 → 안):

  | 전역 | 사슬 |
  |---|---|
  | `renderWatchlist` | 11 `mrInit`(→ `mrRender`) → 내 자산 → 종목 → 04 원본 |
  | `rpRenderAnal` | 05 목표가 오버레이 → 종목 → 09 원본 |
  | `rpRender` | 07 `rpLazyHook`(리포트 탭이 아니면 보류) → 리포트 → 09 원본 |
  | `applyTheme` | 코어(상태 줄 색) → 홈 → 07 원본 |
  | `renderIndex` | 코어(마지막 지수 저장) → 홈 → 04 원본 |
  | `refreshAll` | 코어(성공 시 마지막 시세 저장) → 04 원본 |
  | `mrRender` | 홈(같은 틱 호출을 하나로 묶음) → 11 원본 — `renderWatchlist`·`renderPortfolio` 가 한 갱신에 한 번씩 부른다 |
  | `showTab`, `selectStock` | 코어 → 07 / 05 원본 |
  | 그 밖(`renderMarket`·`renderGauge`·`renderSignals`·`rpRenderToday`·`renderAccounts`·`renderAlerts`·`evalAlerts` …) | 감싸는 모듈 하나 |
- `show` 안에서 반드시 `mDesk(id)` 로 PC 탭 상태를 맞춘다. 공유 코드는 `curTab` 으로 지연 렌더·갱신 범위를 정한다
  (`"rep"` 이면 리포트 표를 그리고, `"scr"` 이면 스크리너 표를, `"dash"` 면 트리맵 갱신·내 종목 리포트 읽음 처리).
  PC 에 없는 이름(`"wl"`, `"more"`)을 주면 `curTab` 만 바뀐다.

### 7.3 이동 · 히스토리

| 함수 | 하는 일 |
|---|---|
| `mGo(screen, params, opts)` | 화면 이동. 다른 화면은 push, 같은 화면은 replace. `opts.push` 로 강제 push, `opts.replace` 로 강제 replace. 홈으로 갈 때는 뿌리 항목까지 되감는다(홈에서 뒤로 = 앱 나가기). 시트가 열려 있으면 닫고 그 항목을 새 화면으로 바꾼다 |
| `mBack()` | `history.back()` |
| `mOpenStock(it, seg)` | 종목 화면을 그 종목으로 (`it = {code, mk, name}`) — 화면 어디서든 종목 이름을 누를 때 |
| `M.cur`, `M.params`, `M.last[screen]` | 지금 화면·파라미터, 화면별 마지막 파라미터(탭 바로 돌아올 때 복원) |
| `mSetTitle(text)`, `mSetBack(bool)` | 앱 바 제목, 앱 바 뒤로 버튼(하위 화면에서) |
| `mRefresh()` | 시세 갱신(`refreshAll`) + 지금 화면 `refresh()`. 앱 바 새로고침 버튼과 같다 |

- 히스토리 항목: `{m:1, screen, params, depth, sheet?}`, 주소 해시 `#<screen>`. `./#reports` 처럼 열면 홈 위에 그 화면이 쌓인다(매니페스트 바로가기).
- 공유 코드의 `showTab(id)` 는 앱에서 감싸져 있다: `dash→home`, `rep→reports`, `acct→assets{seg:"acct"}`,
  `anal→stock{seg:"anal", code…}`, `cmp→stock{seg:"cmp"}`, `scr→more{sub:"scr"}`, `alr→more{sub:"alr"}`.
  그래서 PC 코드의 `selectStock(it); showTab("anal")`(관심종목·시그널·스크리너·리포트 행 클릭)이 그대로 종목 화면을 연다.
  PC 원본은 `mDeskShowTab` 에 있고 `mDesk(id)` 로 부른다.
- `selectStock` 도 감싸져 있어 고른 종목이 "최근 본 종목"(`mRecent()`, localStorage `gongdo-m-recent`)에 쌓인다.
- 탭 바로 더보기에 돌아갈 때 마지막 하위 화면(스크리너·알림)이면 메뉴 항목을 밑에 깔고 하위 화면을 쌓는다 → 뒤로 = 메뉴.
- 탭 바에서 지금 탭을 다시 누르면 `mScrollTop(root)` 로 맨 위로 간다(관성 스크롤을 끊고, 먼 거리는 한 화면 위치로 옮긴 뒤 부드럽게,
  끝나고도 남으면 0). 화면의 `reselect` 도 이 함수를 쓴다.
- 숨긴 화면(`display:none`)은 스크롤 위치를 잃는다. 다른 화면에서 돌아올 때 위치를 되살리는 것은 각 화면의 `hide`/`show` 몫이다
  (홈·리포트·내 자산·더보기가 한다).

### 7.4 공용 부품

| API | 설명 |
|---|---|
| `mSheet({id, title, content, cls, onClose})` → `{el, body, close()}` | 바텀 시트. `content` 는 노드 또는 HTML 문자열. 열면 히스토리 항목이 쌓여 뒤로가기가 시트를 닫는다. 노드를 넘기면 닫힐 때 떼어 두므로 다시 쓸 수 있다 |
| PC 모달(`#mask` 설정, `#impMask` 잔고 가져오기) | CSS 로 시트 모양. `mWatchMasks()` 가 열림을 감지해 같은 뒤로가기 규칙을 건다 — 화면 코드는 `openSettings()`·`openImport()` 를 그냥 부르면 된다 |
| `mOpenSearch()` | 앱 바 검색 시트 (PC `setupSearch` 재사용 + 최근 본 종목) |
| `toast(msg, kind)` | PC 토스트. 앱에서는 탭 바 위 가운데에 뜬다. `kind`: `"ok"`, `"err"` |
| `mPullToRefresh(scrollEl, fn)` | 당겨서 새로고침. `fn` 은 Promise 를 돌려준다(생략하면 `mRefresh`). 홈·내 자산에 걸려 있다 |
| `mSegBar([[값, 라벨], …], onPick)` → 요소 | 꽉 찬 세그먼트(`.m-seg`). `el.mSet(값)` 으로 선택 표시 |
| `mPanelOf(selector, up)` | 그 요소를 품은 `.panel`(또는 `up` 선택자) — PC 패널을 옮길 때 |
| `mRoot(screen)` | 화면 뿌리 요소 (`.mscr` — 이 요소가 스크롤 컨테이너다) |
| `mScrollTop(el)` | 화면 맨 위로 (탭 바 다시 누름) |
| 화상 키보드 | 코어 `mKeyboard()` 가 모든 시트·PC 모달에 적용한다. viewport 의 `interactive-widget=resizes-content` + `visualViewport` 로 가려진 높이를 `--m-kb`·`--m-vvh` 에 넣어 시트를 키보드 위로 올리고, 시트 안 입력에 초점이 가면 그 칸을 보이게 스크롤한다. 저장·취소 줄은 `.m-actbar`(sticky) |
| 오프라인 | 시세 갱신이 성공할 때마다 추적 종목 시세·지수를 localStorage `gongdo-m-quotes` 에 저장한다. 오프라인으로 열리면 그 값을 "갱신 실패"(`ok:false`)로 되살리고 앱 바에 "오프라인"(`#mOffline`)을 켠다. 리포트 데이터는 서비스 워커 캐시에서 열린다 |
| 상태 줄 색 | `<meta name="theme-color">` 는 앱 바 색(다크 `#353945`, 라이트 `#FFFFFF`). 머리의 작은 스크립트가 첫 그리기 전에 저장된 테마를 적용하고, `applyTheme` 감싸기가 바꿀 때마다 맞춘다 |

### 7.5 CSS 토큰과 공용 클래스 (`m_head.html`)

- 색: PC 토큰 그대로(`--bg --panel --panel2 --line --line2 --tx --tx2 --tx3 --link --up --down --up-bg --down-bg`). 테마·등락 색 설정을 자동으로 따른다.
- 앱 토큰: `--m-bar`(52px) `--m-tab`(56px) `--m-sat/--m-sab/--m-sal/--m-sar`(안전 영역) `--m-gut`(12px 좌우 여백)
  `--m-r`(10px 모서리) `--m-fs/--m-fs2/--m-fs3`(15/13/12px) `--m-tap`(44px).
- 클래스: `.m-off`(숨김) `.m-seg` `.m-chips`(가로로 미는 칩 줄) `.m-card` `.m-h`(소제목) `.m-list` + `.m-row`
  (`.m-row-t` 제목, `.m-row-s` 보조줄, `.m-row-v` 오른쪽 값, `.m-chev` 화살표) `.m-empty` `.m-num`(고정폭 숫자).
- 공용 부품 클래스(M3 통합 때 화면별 중복을 모았다 — 새 화면 코드는 이것을 쓴다):
  - `input.m-sw` 스위치(`<input type=checkbox class="m-sw" role="switch">`, 누르는 영역은 감싼 label 행)
  - `.m-btn` 버튼 (`.pri` 주 동작, `.danger` 삭제 — 등락 색과 무관한 빨강, `.sm` 줄 안 40px, `.m-wide` 꽉 찬 폭). 높이 44px
  - `.m-actbar` 시트 아래에 붙는 동작 줄(sticky, 안의 `.m-btn` 48px, `.pri` 가 2배 폭)
  - `.m-morebtn` 목록 끝 "더 보기"·"전체 보기"
  - `.m-pill` 목록 오른쪽 등락률 칩(채움) · `.m-updn` 글 안 등락 칩(옅은 배경). 둘 다 `dirCls()` 의 `up/down/flat` — 등락 색 설정을 따른다
  - 투자의견 `.rbadge` 는 모든 화면 같은 크기(11px, 높이 18px, 최소 폭 40px)
  - `.m-chips` 칩과 `.m-seg` 세그먼트 버튼은 높이 40px. 선택은 `--link` 채움 + 흰 글자
- 글자 크기: 본문 15px(`--m-fs`) · 보조 13px(`--m-fs2`) · 최소 12px(`--m-fs3`). 화면 소제목은 17px 700(홈 `.mh-hd`), 목록 머리는 `.m-h`(12px 700).
- PC CSS 가 모바일 요소에 새는 곳이 있다: 예) `.chk input{width:auto}` 가 스위치 폭을 없앴다 → 공용 규칙은 `input.m-sw` 처럼 요소까지 적어 이긴다.
- 골격: `.mbar`(앱 바) `#mScreens` > `.mscr.act`(지금 화면, 세로 스크롤) `.mtabs`(탭 바) `.msheet`(시트) `.mptr`(당김 표시).
  화면 스크롤은 문서가 아니라 `.mscr` 가 한다(화면마다 스크롤 위치 유지).
- PC 요소 보정: `body.mapp …` 규칙으로 글자 크기(본문 13~15px, 입력 16px)·버튼 높이를 키웠다.
  넓은 표는 PC 의 `.tbw`(가로 스크롤 상자) 안에서 민다. 리포트 목록은 ≤768px 에서 PC 의 카드 레이아웃(`#rpCards`)이 나온다.

### 7.6 PC 패널 → 앱 화면 배치 (M1)

| PC 요소 (id 유지) | 앱 화면 |
|---|---|
| 시장 개요(`#ovKospi` 패널, PC 머리의 `#mkKr` 를 제목으로) | 홈 |
| `#myRepPanel`, 오늘의 리포트(`#rpToday`), `#sigPanels`, 업종(`#secPerf`), 뉴스·공시(`#mktNews`·`#dcBody` 의 `.grid2`) | 홈 |
| 시가총액 지도(`#tmap` 패널, 접힘)·경제 캘린더(`#calWrap`, 접힘) | 홈 |
| `#tab-rep` 전체 | 리포트 |
| `#tab-anal`, `#tab-cmp` (세그먼트 종목분석 / 기업분석) | 종목 — 컨센서스는 `#mStCons` 카드 하나(증권사별 최신 목표가 90일 평균, 차트 계단선과 같은 정의). PC 의 `#anRepCons`(3개월 단순 평균)와 `#anTgtSum` 숫자 줄은 숨김, 차트 아래에는 점 범례만 |
| 관심종목(`#wlBody` 패널) | 내 자산 › 관심종목 (`#mAsWl`) |
| `#tab-acct` + 보유 종목(`#pfBody` 패널) | 내 자산 › 계좌 (`#mAsAcct`) |
| `#tab-scr`, `#tab-alr` | 더보기 › 스크리너 / 알림 (하위 화면) |
| `#btnTheme`, `#btnAuto`, `#upd`, `#scanInd`, `footer` | 더보기 메뉴 (설정·정보) |
| `#qStat`(시세 지연 표시) | 앱 바 |
| PC 머리(`header`: 로고·지수·탭·`#btnRefresh`·`#btnSet`), `main`·빈 `#tab-dash` | 숨김 (기능은 앱 바·더보기가 대신 부른다) |
| `#mask`(설정), `#impMask`(잔고 가져오기), `#toasts`, `#ttip`, `#mpop` | 그대로 (CSS 로 시트·위치 보정) |

### 7.7 실행 · 확인

```
python app/build.py                     # index.html·sw.js + m/index.html·m/sw.js·m/manifest.webmanifest
node app/test_parsers.mjs
python -m http.server 8765              # 저장소 루트에서
# 앱: http://localhost:8765/m/   PC: http://localhost:8765/
```

- 크롬 개발자 도구의 기기 모드(360×800, 390×844, 412×915)로 보거나, 헤드리스 크롬을 CDP 로 몰아서
  `Emulation.setDeviceMetricsOverride {width, height, deviceScaleFactor:3, mobile:true}` +
  `Emulation.setTouchEmulationEnabled` 뒤 `Page.captureScreenshot` 으로 찍는다.
- 확인 항목: `document.documentElement.scrollWidth === innerWidth` 와 지금 화면 `.mscr` 의 `scrollWidth <= clientWidth`
  (화면 스크롤이 `.mscr` 라 둘 다 봐야 한다), 콘솔 오류 0, 뒤로가기(시트 → 이전 화면 → 홈에서 나가기).
- 서비스 워커: 앱 페이지는 `m/sw.js`(범위 `/m/`, 캐시 접두어 `gongdo-app-`)가 제어해야 한다 — `navigator.serviceWorker.controller.scriptURL`.
  소스가 바뀌어 다시 빌드하면 `m/sw.js` 의 빌드 ID 가 바뀌어 새 캐시로 갈아타고 이전 `gongdo-app-*` 캐시는 지운다.
- 오프라인: 한 번 연 뒤 CDP `Network.emulateNetworkConditions {offline:true}` 로 다시 열면 리포트 목록이 보이고, 시세는 마지막 값 +
  앱 바 "오프라인".
- 누름 대상: 화면·열린 시트의 `button, a[href], [role=button], input, select` 가운데 40px 미만을 나열해 본다. 남는 것은 글 안의
  링크(리포트 제목·뉴스 제목 — 카드나 행 전체도 눌린다)와 label 행 안의 스위치(행 높이 44px 이상)다.
- 스토어 스크린샷: `m/shots/*.png`(540×1170, 390×844 화면을 배율 3으로 찍어 줄인 것) — 매니페스트 `screenshots`.
