/* =========================================================================
   홈 화면 — app/mobile/m_home.js (+ m_home.css, 뿌리 #m-home)
   M1(기초): PC 대시보드 패널을 스펙 순서로 옮겨 담기만 했다. 렌더는 04_dash·09·11 그대로.
   TODO(폴리시 단계):
   - 지수 카드(KOSPI·KOSDAQ)를 2열 카드로, 장 상태(#mkKr)·시장 폭 게이지를 카드 안에 정리
   - 상승·하락·거래대금 상위(#sigPanels 3개 표)를 세그먼트 전환 + 5개 + "더 보기"로
   - 업종 등락(#secPerf) 행 높이 44px, 탭하면 스크리너(더보기 › 스크리너)로 가는 것 확인
   - 오늘의 리포트(#rpToday)·내 종목 리포트(#myRep) 표를 카드/2줄 행으로 (지금은 패널 안 가로 스크롤)
   - 뉴스·공시: 행 높이, 공시 유형 칩 가로 스크롤, "내 종목만" 토글 크기
   - 시가총액 지도(#tmap)는 접힘 기본 — 펼쳤을 때 높이·타일 탭(호버 툴팁 대신) 정리
   - 불러오는 중·비어 있음·실패 상태 문구 점검
   ========================================================================= */
mScreen("home", {
  title: "홈",
  mount: function(root){
    var ov = mPanelOf("#ovKospi"),
        myRep = $("#myRepPanel"),
        today = mPanelOf("#rpToday"),
        sig = $("#sigPanels"),
        sec = mPanelOf("#secPerf"),
        feeds = mPanelOf("#mktNews", ".grid2"),
        tmap = mPanelOf("#tmap"),
        cal = mPanelOf("#calWrap");
    [ov, myRep, today, sig, sec, feeds, tmap, cal].forEach(function(el){ if(el) root.appendChild(el); });
    /* 장 상태 표시(PC 머리의 #mkKr)를 시장 개요 제목으로 */
    var mk = $("#mkKr");
    if(mk && ov) $(".ptitle", ov).appendChild(mk);
    if(ov) $(".ptitle", ov).firstChild.textContent = "시장 개요 ";
    /* 시가총액 지도: 접어 둔다. 펼칠 때 다시 그린다 (접힌 동안은 폭이 0 이라 그려지지 않는다) */
    if(tmap){
      tmap.classList.add("m-fold");
      var fb = document.createElement("button");
      fb.className = "btn xs m-foldbtn"; fb.textContent = "펼치기";
      fb.onclick = function(){
        var folded = tmap.classList.toggle("m-fold");
        fb.textContent = folded ? "펼치기" : "접기";
        if(!folded) setTimeout(function(){ if(TMAP_LOADED) renderTreemap(); else loadTreemap(); }, 30);
      };
      var sp = $(".ptitle .sp", tmap);
      if(sp) sp.insertBefore(fb, sp.firstChild);
    }
    /* 경제 캘린더: 접어 둔다 (07 initCalendar 의 #calToggle 이 그대로 펼친다) */
    if($("#calWrap")){ $("#calWrap").classList.add("hide"); $("#calToggle").textContent = "펼치기"; }
    mPullToRefresh(root, function(){
      renderMarketNews(true); renderDisclosures(true);
      return mRefresh();
    });
  },
  show: function(){
    mDesk("dash");                 // 트리맵·관심종목·뉴스·공시 갱신, 내 종목 리포트 읽음 처리 기준
  }
});
