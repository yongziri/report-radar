/* =========================================================================
   리포트 화면 — app/mobile/m_reports.js (+ m_reports.css, 뿌리 #m-reports)
   M1(기초): PC 리포트 탭(#tab-rep) 전체를 그대로 옮겼다. 표는 ≤768px 카드(#rpCards, 09_reports.js)로 나온다.
   리포트 표는 처음 열 때 그린다(07 rpLazyHook + showTab("rep") → mDesk("rep")).
   TODO(폴리시 단계):
   - 하위 뷰(#rpViewSeg 등 .rpvseg: 리포트·목표가 변경·종목별·업종별·히트맵·성적표·산업·시황)를
     화면 위 가로로 미는 칩(.m-chips) 한 줄로 — 각 패널 제목의 중복 세그먼트는 숨김
   - 기간 칩(#rpPeriod) 한 줄만 남기고 나머지 필터(#rpFilters: 레이팅·목표가·업종·증권사·검색…)는
     "필터" 버튼 → mSheet 로 (요소는 옮겨 담되 id 유지)
   - 개요(#rpStats) 압축, 종목별·업종별·성적표·산업 표(지금은 패널 안 가로 스크롤)를 카드로
   - 히트맵(#rpTmap) 타일 탭 → 툴팁 대신 시트
   - 종목 이름 탭 → mOpenStock (지금도 rpGotoAnal → showTab("anal") 로 종목 화면이 열린다)
   ========================================================================= */
mScreen("reports", {
  title: "리포트",
  mount: function(root){
    root.appendChild($("#tab-rep"));
  },
  show: function(){
    mDesk("rep");
  },
  refresh: function(){
    if(typeof rpCheckUpdate === "function") return rpCheckUpdate();
  }
});
