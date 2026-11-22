/* =========================================================================
   내 자산 화면 — app/mobile/m_assets.js (+ m_assets.css, 뿌리 #m-assets)
   M1(기초): 세그먼트 [관심종목 | 계좌].
     관심종목 = PC 대시보드의 관심종목 패널(#wlBody 패널)
     계좌     = PC 계좌 탭(#tab-acct) + PC 대시보드의 "보유 종목"(#pfBody, 전 계좌 합산) 패널
   파라미터: { seg:"wl"|"acct" }. 당겨서 새로고침.
   TODO(폴리시 단계):
   - 관심종목: 9열 표(지금은 패널 안 가로 스크롤) → 한 줄 2단 행(이름·코드 / 현재가·등락), 탭 → 종목 화면,
     삭제는 길게 누르기나 편집 모드, 그룹 칩(#wlTabs) 가로 스크롤, 그룹 추가·이름변경·삭제는 시트로
   - 종목 추가(#srchWl)를 "+ 추가" 버튼 → 검색 시트로
   - 계좌: 요약 카드(#acTot·#acSum) + 보유 카드(#acBody 12열 표 → 카드), 수량·평단·메모 수정은 시트로
   - 계좌 칩(#acTabs)·계좌 추가/이름변경/삭제/순서 버튼 정리, CSV·JSON 가져오기/내보내기는 더보기와 중복 정리
   - "보유 종목"(#pfBody) 패널의 "계좌 탭 열기" 버튼 숨김(이미 같은 화면)
   ========================================================================= */
mScreen("assets", {
  title: "내 자산",
  mount: function(root){
    this.seg = mSegBar([["wl", "관심종목"], ["acct", "계좌"]], function(v){
      mGo("assets", { seg:v }, { replace:true });
    });
    root.appendChild(this.seg);
    var wl = document.createElement("div"); wl.className = "m-pane"; wl.id = "mAsWl";
    var ac = document.createElement("div"); ac.className = "m-pane"; ac.id = "mAsAcct";
    var wlp = mPanelOf("#wlBody"), pfp = mPanelOf("#pfBody");
    if(wlp) wl.appendChild(wlp);
    ac.appendChild($("#tab-acct"));
    if(pfp) ac.appendChild(pfp);
    root.appendChild(wl); root.appendChild(ac);
    mPullToRefresh(root);
  },
  show: function(p){
    var seg = p.seg === "acct" ? "acct" : "wl";
    this.seg.mSet(seg);
    $("#mAsWl").classList.toggle("m-off", seg !== "wl");
    $("#mAsAcct").classList.toggle("m-off", seg !== "acct");
    if(seg === "acct") mDesk("acct");
    else{
      mDesk("wl");
      renderWatchlist(); loadSparklines();
    }
  }
});
