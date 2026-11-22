/* =========================================================================
   더보기 화면 — app/mobile/m_more.js (+ m_more.css, 뿌리 #m-more)
   M1(기초): 메뉴 목록 + 하위 화면 2개(스크리너 = PC #tab-scr, 알림 = PC #tab-alr).
   파라미터: { sub:"scr"|"alr", from:"menu" } — sub 가 없으면 메뉴. 하위 화면은 앱 바에 뒤로 버튼.
   설정은 PC 설정 모달(#mask, 시트 모양)을 그대로 연다. 테마(#btnTheme)·자동갱신(#btnAuto) 버튼과
   갱신 시각(#upd)·스캔 표시(#scanInd)·출처(footer)는 PC 머리에서 옮겨 왔다(id 유지).
   TODO(폴리시 단계):
   - 스크리너: 필터 격자(#fgrid)·프리셋을 시트로, 결과 표(#scrBody, 지금은 가로 스크롤) → 카드/2줄 행,
     상단 버튼 묶음(저장·삭제·범위·스캔·CSV·컬럼…) 정리, 트리맵·차트 보기 폭
   - 알림: 규칙 추가 폼(#srchAl·#alCond·#alVal·#alMemo)을 시트로, 규칙 표(#alBody) → 카드, 리포트 알림 스위치 정리
   - 설정: 모달 대신 화면 안 목록(테마·등락 색·갱신 주기·프록시)로 — 저장 버튼 없이 바로 반영할지 결정
   - 정보: 데이터 기준 시각·소스 상태를 RMETA 등에서 직접 읽어 표로 (지금은 PC 문구 복사)
   ========================================================================= */
mScreen("more", {
  title: function(p){ return p.sub === "scr" ? "스크리너" : (p.sub === "alr" ? "알림" : "더보기"); },
  mount: function(root){
    var chev = '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>';
    var menu = document.createElement("div");
    menu.className = "m-more-menu";
    menu.innerHTML =
      '<div class="m-h">도구</div><div class="m-list">' +
        '<button class="m-row" data-go="scr"><span class="m-row-t">스크리너<span class="m-row-s">조건으로 종목 찾기 · 코스피·코스닥</span></span>' + chev + '</button>' +
        '<button class="m-row" data-go="alr"><span class="m-row-t">알림<span class="m-row-s">가격 · 등락률 · 내 종목 리포트</span></span>' + chev + '</button>' +
      '</div>' +
      '<div class="m-h">설정</div><div class="m-list">' +
        '<div class="m-row"><span class="m-row-t">테마<span class="m-row-s">어두운 / 밝은 화면</span></span><span id="mThemeSlot"></span></div>' +
        '<div class="m-row"><span class="m-row-t">자동 갱신<span class="m-row-s">설정한 주기마다 시세를 다시 받는다</span></span><span id="mAutoSlot"></span></div>' +
        '<button class="m-row" data-act="settings"><span class="m-row-t">등락 색 · 갱신 주기 · 프록시</span>' + chev + '</button>' +
      '</div>' +
      '<div class="m-h">데이터</div><div class="m-list">' +
        '<button class="m-row" data-act="export"><span class="m-row-t">전체 백업 내보내기<span class="m-row-s">관심종목 · 계좌 · 알림 · 설정 (JSON)</span></span>' + chev + '</button>' +
        '<button class="m-row" data-act="import"><span class="m-row-t">백업 가져오기<span class="m-row-s">JSON 파일 — 지금 데이터를 바꾼다</span></span>' + chev + '</button>' +
        '<button class="m-row" data-act="csv"><span class="m-row-t">계좌 잔고 가져오기<span class="m-row-s">증권사 CSV · 화면 복사 텍스트</span></span>' + chev + '</button>' +
      '</div>' +
      '<div class="m-list">' +
        '<a class="m-row" href="../"><span class="m-row-t">PC 버전 열기<span class="m-row-s">넓은 화면용 전체 기능</span></span>' + chev + '</a>' +
      '</div>' +
      '<div class="m-h">정보</div><div class="m-list m-info">' +
        '<div class="m-row"><span class="m-row-t">시세</span><span class="m-row-v" id="mUpdSlot"></span></div>' +
        '<div class="m-row"><span class="m-row-t">리포트 데이터</span><span class="m-row-v" id="mRpInfo">-</span></div>' +
        '<div class="m-row m-off" id="mScanRow"><span class="m-row-t">스캔</span><span class="m-row-v" id="mScanSlot"></span></div>' +
      '</div>' +
      '<div class="m-foot" id="mFootSlot"></div>';
    root.appendChild(menu);
    $("#mThemeSlot", menu).appendChild($("#btnTheme"));
    $("#mAutoSlot", menu).appendChild($("#btnAuto"));
    $("#mUpdSlot", menu).appendChild($("#upd"));
    $("#mScanSlot", menu).appendChild($("#scanInd"));
    var foot = $("body > footer");
    if(foot) $("#mFootSlot", menu).appendChild(foot);
    menu.addEventListener("click", function(e){
      var g = e.target.closest("[data-go]");
      if(g){ mGo("more", { sub:g.dataset.go, from:"menu" }, { push:true }); return; }
      var a = e.target.closest("[data-act]"); if(!a) return;
      var act = a.dataset.act;
      if(act === "settings") openSettings();
      else if(act === "export") exportJson();
      else if(act === "import") $("#sFile").click();
      else if(act === "csv") openImport();
    });
    var sub = document.createElement("div");
    sub.className = "m-more-sub";
    sub.appendChild($("#tab-scr"));
    sub.appendChild($("#tab-alr"));
    root.appendChild(sub);
    this.menu = menu;
  },
  show: function(p){
    var sub = p.sub === "scr" || p.sub === "alr" ? p.sub : "";
    this.menu.classList.toggle("m-off", !!sub);
    $("#tab-scr").classList.toggle("m-off", sub !== "scr");
    $("#tab-alr").classList.toggle("m-off", sub !== "alr");
    mSetBack(!!sub);
    if(sub) mDesk(sub);
    else{
      mDesk("more");
      var rp = ($("#rpUpd") || {}).textContent || "";
      $("#mRpInfo").textContent = rp.trim() || (RP_READY ? "-" : "불러오는 중…");
      $("#mScanRow").classList.toggle("m-off", $("#scanInd").classList.contains("hide"));
    }
  },
  /* 탭 바의 더보기를 다시 누르면 메뉴로 */
  reselect: function(){
    if(!M.params.sub) return false;
    if(M.params.from === "menu") history.back();
    else mGo("more", {}, { replace:true });
    return true;
  }
});
