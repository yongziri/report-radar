/* =========================================================================
   종목 화면 — app/mobile/m_stock.js (+ m_stock.css, 뿌리 #m-stock)
   M1(기초): 세그먼트 [종목분석 | 기업분석] 아래에 PC #tab-anal · #tab-cmp 를 옮겨 담았다.
   파라미터: { seg:"anal"|"cmp", code, mk, name } — code 가 지금 종목(AN.sel)과 다르면 그 종목을 고른다.
   다른 화면에서 종목을 누르면 공유 코드가 selectStock() + showTab("anal") → 이 화면이 열린다.
   TODO(폴리시 단계):
   - 종목 머리: 이름·현재가·등락을 큰 글씨로 (#anTitle/#anSub/#anStats 첫 칸에서 뽑거나 renderAnalysisHead 결과 재배치)
   - 검색 상자(#srchAn)를 "최근 본 종목"(mRecent()) 칩과 함께 화면 위로, 빈 상태(#anEmpty) 안내 정리
   - 차트(#chart): 기간 칩 한 줄(#segPeriod·#segTf 합치기), 터치로 값 읽기(지금은 탭 한 번 = 한 점), 목표가 켜기/끄기
   - 지표(#anStats statgrid)를 2열 카드로 — 지금은 PC 표가 ≤900px 규칙으로 4칸만 보인다
   - 리포트 컨센서스(#anRepCons)·목록(#anRepBody 표 → 카드), 뉴스·공시(#anFeeds)
   - 기업분석: "새 창에서 열기"(#cmpOpen)를 맨 앞 큰 버튼으로, 보고서 세그먼트(#segCmp) 가로 스크롤 칩,
     iframe(#cmpFrame) 높이·폭(외부 페이지가 폰 폭보다 넓다)
   ========================================================================= */
mScreen("stock", {
  title: function(p){ return (p && p.name) || "종목"; },
  mount: function(root){
    this.seg = mSegBar([["anal", "종목분석"], ["cmp", "기업분석"]], function(v){
      mGo("stock", Object.assign({}, M.params, { seg:v }), { replace:true });
    });
    root.appendChild(this.seg);
    root.appendChild($("#tab-anal"));
    root.appendChild($("#tab-cmp"));
    /* 기업분석: 외부 페이지 → "새 창에서 열기"를 앞에 */
    var op = $("#cmpOpen");
    if(op && op.parentNode) op.parentNode.insertBefore(op, op.parentNode.firstChild);
  },
  show: function(p){
    var seg = p.seg === "cmp" ? "cmp" : "anal";
    if(p.code && (!AN.sel || AN.sel.code !== p.code)){
      selectStock({ mk:p.mk || "KR", code:p.code, name:p.name || p.code });
    }
    var idx = AN.sel && AN.sel.mk === "IDX";
    this.seg.classList.toggle("m-off", !!idx);            // 지수는 기업분석이 없다
    if(idx) seg = "anal";
    this.seg.mSet(seg);
    $("#tab-anal").classList.toggle("m-off", seg !== "anal");
    $("#tab-cmp").classList.toggle("m-off", seg !== "cmp");
    if(seg === "cmp" && AN.sel && !idx && (!CMP.sel || CMP.sel.code !== AN.sel.code)) selectCompany(AN.sel);
    mDesk(seg);
    mSetTitle(AN.sel ? AN.sel.name : "종목");
  }
});
