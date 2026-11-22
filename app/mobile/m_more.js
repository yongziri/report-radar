/* =========================================================================
   더보기 화면 — app/mobile/m_more.js (+ m_more.css, 뿌리 #m-more)
   파라미터: { sub:"scr"|"alr", from:"menu" } — sub 가 없으면 메뉴. 하위 화면은 앱 바에 뒤로 버튼.
   - 메뉴: 도구(스크리너·알림) · 화면(테마·등락 색·자동 갱신·갱신 주기) · 데이터(백업·복원·잔고 CSV·고급 설정)
           · 앱(PC 버전·앱 설치·정보). PC 설정 모달(#mask) 대신 같은 상태(S.theme, S.settings.*)를 바로 바꾸고 save().
   - 스크리너(#tab-scr): 프리셋 칩 · 조건 시트(PC #fgrid 등 실제 노드를 옮겨 쓴다) · 정렬 시트 · 지표 선택 시트
           · 결과는 2줄 행(조금씩 이어 그린다). 전역 renderScreen 을 앱 렌더러로 바꾸고 renderScrSum/renderScreens 를 감싼다.
   - 알림(#tab-alr): 세그먼트 [가격 알림 | 리포트 알림 | 기록]. 규칙 카드 · 추가 시트 · 리포트 알림 스위치 · 기록 행.
           renderAlerts / renderAlertLog / syncNotiState / mrSyncCfgUI 를 감싸 PC 렌더 뒤에 앱 화면을 다시 그린다.
   시트에 넣는 PC 노드는 시트가 닫혀도 문서 안(#mMoreHold, 숨김)에 남겨 둔다 — 공유 코드가 id 로 찾기 때문.
   ========================================================================= */
var MM = {
  menu:null, hold:null, sub:"", pos:{ menu:0, scr:0, alr:0 },
  scr:{ sig:"", n:0, list:[], keepN:0, condEl:null, condSheet:null, io:null },
  alr:{ seg:"price", pick:null, cond:"ge", formEl:null, wired:false },
  install:null, build:""
};
var MM_SCR_CHUNK = 40;
var MM_LS_MET = "gongdo-m-scrmet";        // 스크리너 행 보조줄 지표 (최대 3개)
var MM_LS_ALBEEP = "gongdo-m-albeep";     // 가격 알림 소리 (앱 전용, 기본 켬)
var MM_IV = [[20, "20초"], [30, "30초"], [60, "1분"], [180, "3분"], [300, "5분"]];

var MM_ICON = (function(){
  function s(d){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  return {
    chev: '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
    scr: s('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>'),
    bell: s('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    moon: s('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    cc: s('<path d="M7 19V6M3.5 9.5L7 6l3.5 3.5"/><path d="M17 5v13M13.5 14.5L17 18l3.5-3.5"/>'),
    sync: s('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
    clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    down: s('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>'),
    up: s('<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>'),
    csv: s('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
    gear: s('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
    pc: s('<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/>'),
    inst: s('<rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M12 7.5v7M9 11.5l3 3 3-3"/>'),
    info: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>'),
    sort: s('<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M14 6h7M14 11h5M14 16h3"/>'),
    cols: s('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15M15 4.5v15"/>'),
    trash: s('<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    srcs: s('<path d="M4 6h16M4 12h16M4 18h10"/>')
  };
})();

/* 설치 버튼: beforeinstallprompt 는 스크립트 평가 직후에 올 수 있어 맨 위에서 받는다 */
window.addEventListener("beforeinstallprompt", function(e){
  e.preventDefault();
  MM.install = e;
  if(MM.menu) mmMenuSync();
});
window.addEventListener("appinstalled", function(){ MM.install = null; if(MM.menu) mmMenuSync(); });

function mmSw(attrs){ return '<input type="checkbox" class="mm-sw" role="switch" ' + (attrs || "") + '>'; }
function mmIco(name, tone){ return '<span class="mm-ic' + (tone ? " " + tone : "") + '">' + MM_ICON[name] + '</span>'; }

/* =================== 메뉴 =================== */
function mmBuildMenu(){
  var C = MM_ICON.chev;
  var menu = document.createElement("div");
  menu.className = "m-more-menu";
  menu.innerHTML =
    '<div class="m-h">도구</div><div class="m-list">' +
      '<button class="m-row" data-go="scr">' + mmIco("scr", "t-blue") +
        '<span class="m-row-t">스크리너<span class="m-row-s">조건으로 종목 찾기</span></span>' +
        '<span class="m-row-v" id="mmScrV"></span>' + C + '</button>' +
      '<button class="m-row" data-go="alr">' + mmIco("bell", "t-amber") +
        '<span class="m-row-t">알림<span class="m-row-s">가격 · 등락률 · 내 종목 리포트</span></span>' +
        '<span class="m-row-v" id="mmAlrV"></span>' + C + '</button>' +
    '</div>' +
    '<div class="m-h">화면</div><div class="m-list">' +
      '<label class="m-row">' + mmIco("moon", "t-violet") + '<span class="m-row-t">다크 모드</span>' +
        mmSw('id="mmTheme" aria-label="다크 모드"') + '</label>' +
      '<div class="m-row mm-ccrow">' + mmIco("cc", "t-red") + '<span class="m-row-t">등락 색<span class="m-row-s" id="mmCcS"></span></span>' +
        '<div class="mm-seg" id="mmCc" role="radiogroup" aria-label="등락 색">' +
          '<button data-cc="kr" role="radio">빨강<span class="mm-ar">▲</span></button>' +
          '<button data-cc="global" role="radio">초록<span class="mm-ar">▲</span></button></div></div>' +
      '<label class="m-row">' + mmIco("sync", "t-green") + '<span class="m-row-t">자동 갱신<span class="m-row-s">주기마다 시세를 다시 받는다</span></span>' +
        mmSw('id="mmAuto" aria-label="자동 갱신"') + '</label>' +
      '<button class="m-row" data-act="iv" id="mmIvRow">' + mmIco("clock", "t-green") + '<span class="m-row-t">갱신 주기</span>' +
        '<span class="m-row-v m-num" id="mmIvV"></span>' + C + '</button>' +
    '</div>' +
    '<div class="m-h">데이터</div><div class="m-list">' +
      '<button class="m-row" data-act="export">' + mmIco("down", "t-blue") + '<span class="m-row-t">설정 값 백업<span class="m-row-s">관심종목 · 계좌 · 알림 · 설정을 JSON 파일로</span></span>' + C + '</button>' +
      '<button class="m-row" data-act="import">' + mmIco("up", "t-blue") + '<span class="m-row-t">백업 복원<span class="m-row-s">JSON 파일 — 지금 데이터를 바꾼다</span></span>' + C + '</button>' +
      '<button class="m-row" data-act="csv">' + mmIco("csv", "t-blue") + '<span class="m-row-t">잔고 CSV 가져오기<span class="m-row-s">증권사 CSV · 화면 복사 텍스트</span></span>' + C + '</button>' +
      '<button class="m-row" data-act="adv">' + mmIco("gear", "t-gray") + '<span class="m-row-t">고급 설정<span class="m-row-s">프록시 주소 · 전체 초기화</span></span>' + C + '</button>' +
    '</div>' +
    '<div class="m-h">앱</div><div class="m-list">' +
      '<a class="m-row" href="../">' + mmIco("pc", "t-gray") + '<span class="m-row-t">PC 버전 열기<span class="m-row-s">넓은 화면용 전체 기능</span></span>' + C + '</a>' +
      '<button class="m-row" data-act="install" id="mmInstRow">' + mmIco("inst", "t-gray") + '<span class="m-row-t" id="mmInstT">홈 화면에 설치</span>' +
        '<span class="m-row-v" id="mmInstV"></span>' + C + '</button>' +
    '</div>' +
    '<div class="m-h">정보</div><div class="m-list mm-info">' +
      '<div class="m-row"><span class="m-row-t">시세</span><span class="m-row-v m-num" id="mUpdSlot"></span></div>' +
      '<div class="m-row"><span class="m-row-t">리포트 데이터</span><span class="m-row-v m-num" id="mmRpAt">-</span></div>' +
      '<div class="m-row"><span class="m-row-t">리포트</span><span class="m-row-v m-num" id="mmRpN">-</span></div>' +
      '<button class="m-row" data-act="src"><span class="m-row-t">소스 상태</span><span class="m-row-v" id="mmSrcV">-</span>' + C + '</button>' +
      '<div class="m-row"><span class="m-row-t">앱 빌드</span><span class="m-row-v m-num" id="mmBuild">-</span></div>' +
    '</div>' +
    '<p class="mm-foot">시세: 네이버 금융 · 공시: DART · 리포트: 증권사 공개 자료. 시세는 지연·오류가 있을 수 있고 투자 판단과 책임은 이용자에게 있습니다.</p>';
  return menu;
}

function mmMenuSync(){
  var m = MM.menu; if(!m) return;
  $("#mmTheme", m).checked = S.theme === "dark";
  var cc = S.settings.cc || "global";
  $$("#mmCc button", m).forEach(function(b){
    var on = b.dataset.cc === cc;
    b.classList.toggle("act", on); b.setAttribute("aria-checked", on ? "true" : "false");
  });
  $("#mmCcS", m).textContent = cc === "kr" ? "한국식 · 상승 빨강" : "글로벌 · 상승 초록";
  $("#mmAuto", m).checked = !!S.auto;
  $("#mmIvV", m).textContent = mmIvLabel(S.settings.iv);
  $("#mmIvRow", m).classList.toggle("mm-dim", !S.auto);
  var on = S.alerts.filter(function(a){ return a.on; }).length;
  $("#mmAlrV", m).textContent = (on ? "감시 " + on : (S.alerts.length ? "중지 " + S.alerts.length : "")) +
    (MR_CFG.on ? (on || S.alerts.length ? " · " : "") + "리포트 ON" : "");
  mmScrMenuV();
  /* 설치 */
  var standalone = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
  $("#mmInstT", m).textContent = MM.install ? "앱 설치" : "홈 화면에 설치";
  $("#mmInstV", m).textContent = standalone ? "설치됨" : (MM.install ? "바로 설치" : "방법 보기");
}
function mmScrMenuV(){
  var v = MM.menu && $("#mmScrV", MM.menu);
  if(!v) return;
  if(scanning){ var t = ($("#scanInd") || {}).textContent || "스캔 중"; v.textContent = t; v.classList.add("mm-live"); }
  else{ v.textContent = SCREEN.length ? fmt(SCREEN.length) + "종목" : ""; v.classList.remove("mm-live"); }
}
function mmIvLabel(iv){
  iv = Math.max(20, Number(iv) || 60);
  var hit = MM_IV.filter(function(x){ return x[0] === iv; })[0];
  return hit ? hit[1] : (iv % 60 === 0 ? (iv / 60) + "분" : iv + "초");
}

function mmInfoSync(){
  var m = MM.menu; if(!m) return;
  var at = RMETA && RMETA.updated_at ? String(RMETA.updated_at).replace("T", " ").slice(0, 16) : "";
  $("#mmRpAt", m).textContent = at ? at + " 기준" : (RP_READY ? "-" : "불러오는 중…");
  var nb = RMETA && Array.isArray(RMETA.brokers) ? RMETA.brokers.length : RP_BROKERS.length;
  $("#mmRpN", m).textContent = RP_READY || RMETA ? fmt(rpTotalCount()) + "건 · 증권사 " + fmt(nb) + "곳" : "-";
  var src = mmSources();
  var bad = src.filter(function(s){ return s.err || s.stale; }).length;
  var v = $("#mmSrcV", m);
  v.textContent = !src.length ? "-" : (bad ? src.length + "곳 중 " + bad + "곳 확인 필요" : src.length + "곳 정상");
  v.classList.toggle("down", !!bad);
  $("#mmBuild", m).textContent = MM.build || "-";
}
/* RMETA.source_status → [{label, date, total, err, stale}] (09 의 rpSourceStatusHtml 과 같은 기준) */
function mmSources(){
  var st = RMETA && RMETA.source_status;
  if(!st || typeof st !== "object") return [];
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Object.keys(st).sort(function(a, b){
    var ia = RP_SRC_ORDER.indexOf(a), ib = RP_SRC_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  }).map(function(k){
    var s = st[k] || {};
    var ld = String(s.last_date || s.fetched_last_date || "");
    var mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(ld);
    return { label:RP_SRC_LABEL[k] || k, date:mt ? mt[0] : "", total:s.total || 0, err:s.error ? String(s.error) : "",
             stale:mt ? rpBizDaysSince(new Date(+mt[1], +mt[2] - 1, +mt[3]), today) >= RP_SRC_STALE_BD : false };
  });
}
function mmOpenSources(){
  var src = mmSources();
  var html = !src.length ? '<div class="m-empty">리포트 메타데이터를 아직 받지 못했습니다.</div>' :
    '<div class="m-list">' + src.map(function(s){
      return '<div class="m-row"><span class="m-row-t">' + esc(s.label) +
        '<span class="m-row-s">보관 ' + fmt(s.total) + '건' + (s.err ? ' · <span class="down">최근 수집 실패: ' + esc(s.err) + '</span>' : "") + '</span></span>' +
        '<span class="m-row-v m-num' + (s.stale ? " down" : "") + '">' + esc(s.date || "미수집") + '</span></div>';
    }).join("") + '</div>' +
    '<p class="mm-note">날짜는 소스별 최신 리포트 날짜. 영업일 ' + RP_SRC_STALE_BD + '일 이상 밀리면 빨간색. ' +
    (RMETA && RMETA.updated_at ? "수집 " + esc(String(RMETA.updated_at).replace("T", " ").slice(0, 16)) : "") + '</p>';
  mSheet({ id:"mm-src", title:"리포트 소스 상태", content:html, cls:"mm-sheet" });
}

function mmOpenIv(){
  var cur = Math.max(20, Number(S.settings.iv) || 60);
  var list = MM_IV.slice();
  if(!list.some(function(x){ return x[0] === cur; })) list.push([cur, mmIvLabel(cur) + " (지금 값)"]);
  var html = '<div class="m-list mm-pick">' + list.map(function(x){
    return '<button class="m-row" data-iv="' + x[0] + '" role="radio" aria-checked="' + (x[0] === cur) + '">' +
      '<span class="m-row-t">' + esc(x[1]) + '</span><span class="mm-chk' + (x[0] === cur ? " on" : "") + '"></span></button>';
  }).join("") + '</div><p class="mm-note">최소 20초. 자동 갱신이 켜져 있을 때 이 주기로 시세를 받고 가격 알림을 확인합니다.' +
    (S.auto ? "" : " 지금은 자동 갱신이 꺼져 있습니다.") + '</p>';
  var sh = mSheet({ id:"mm-iv", title:"갱신 주기", content:html, cls:"mm-sheet" });
  sh.body.addEventListener("click", function(e){
    var b = e.target.closest("[data-iv]"); if(!b) return;
    S.settings.iv = Math.max(20, Number(b.dataset.iv) || 60);
    save();
    if(S.auto) startTimer();
    mmMenuSync();
    sh.close();
    toast("갱신 주기: " + mmIvLabel(S.settings.iv), "ok");
  });
}

function mmOpenAdv(){
  var box = document.createElement("div");
  box.innerHTML =
    '<label class="mm-lb" for="mmProxy">커스텀 프록시 URL <span class="mm-opt">(선택)</span></label>' +
    '<input type="text" id="mmProxy" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://stock-proxy.내계정.workers.dev">' +
    '<p class="mm-note">비워 두면 rss2json 방식. Cloudflare Worker 주소를 넣으면 뉴스·공시를 원본에서 직접 받아 공시가 10건에서 50건으로 늘어난다. 현재 모드: <b id="mmProxyMode"></b></p>' +
    '<button class="mm-btn pri" id="mmProxySave">저장</button>' +
    '<div class="mm-lb mm-gap">위험 구역</div>' +
    '<button class="mm-btn danger" id="mmReset">전체 초기화</button>' +
    '<p class="mm-note">관심종목 · 계좌 · 알림 · 설정 · 저장한 스크린을 모두 지운다. 먼저 백업하세요.</p>';
  $("#mmProxy", box).value = S.settings.proxy || "";
  $("#mmProxyMode", box).textContent = RSS.mode() === "proxy" ? "커스텀 프록시" : "rss2json (기본)";
  var sh = mSheet({ id:"mm-adv", title:"고급 설정", content:box, cls:"mm-sheet" });
  $("#mmProxySave", box).onclick = function(){
    var old = S.settings.proxy || "";
    S.settings.proxy = $("#mmProxy", box).value.trim().replace(/\/+$/, "");
    save();
    if(S.settings.proxy !== old){        /* 07 설정 저장과 같은 처리: 뉴스·공시 캐시 무효화 */
      Object.keys(RSS.cache).forEach(function(k){ delete RSS.cache[k]; });
      renderMarketNews(true); renderDisclosures(true);
      if(AN.sel && !isIdx(AN.sel)) renderNews(true);
      toast(S.settings.proxy ? "커스텀 프록시로 전환했습니다." : "rss2json 기본 모드로 되돌렸습니다.", "ok");
    }else toast("바뀐 내용이 없습니다.");
    sh.close();
  };
  $("#mmReset", box).onclick = function(){ $("#sRst").click(); };
}

function mmOpenInstall(){
  if(MM.install){
    var ev = MM.install, pr;
    try{ pr = ev.prompt(); }catch(err){ pr = null; }
    if(pr && pr.catch) pr.catch(function(){});
    Promise.resolve(ev.userChoice).then(function(c){
      if(c && c.outcome === "accepted"){ MM.install = null; toast("설치를 시작했습니다.", "ok"); }
      mmMenuSync();
    }).catch(function(){});
    return;
  }
  var standalone = window.matchMedia && matchMedia("(display-mode: standalone)").matches;
  mSheet({ id:"mm-inst", title:"홈 화면에 설치", cls:"mm-sheet", content:
    (standalone ? '<p class="mm-note mm-big">이미 설치된 앱으로 열려 있습니다.</p>' : "") +
    '<div class="m-list"><div class="m-row"><span class="m-row-t">안드로이드 · 크롬' +
      '<span class="m-row-s">오른쪽 위 ⋮ 메뉴 → "앱 설치" 또는 "홈 화면에 추가"</span></span></div>' +
    '<div class="m-row"><span class="m-row-t">아이폰 · 사파리' +
      '<span class="m-row-s">아래 공유 버튼 → "홈 화면에 추가"</span></span></div>' +
    '<div class="m-row"><span class="m-row-t">삼성 인터넷' +
      '<span class="m-row-s">아래 ≡ 메뉴 → "현재 페이지 추가" → "홈 화면"</span></span></div></div>' +
    '<p class="mm-note">설치하면 주소창 없이 전체 화면으로 열리고, 인터넷이 끊겨도 마지막으로 받은 데이터를 볼 수 있습니다.</p>' });
}

/* 등락 색: 07 설정 저장과 같은 갱신 묶음 (CSS 토큰은 data-cc 로 바로 바뀌고, 캔버스·히트맵은 다시 그린다) */
function mmSetCc(cc){
  if((S.settings.cc || "global") === cc) return;
  S.settings.cc = cc; save(); applyTheme();
  renderMarket(); renderPortfolio(); renderAccounts(); renderSignals(); renderGauge(); renderSectorPerf(); applyFilter();
  mmMenuSync();
}

/* =================== 스크리너 =================== */
var MM_SORTS = ["pct", "price", "amt", "vol", "capE", "per", "fper", "pbr", "divy", "turn", "gap", "range", "pos", "ulNear",
  "rep1m", "repGap", "chg", "eps", "bps", "rsi", "pos52", "pw", "pm", "pytd", "nearHi", "nearLo", "volx", "vol20", "atrp",
  "sep20", "sep60", "sep120", "name"];
var MM_MET_SHORT = { capE:"시총", amt:"거래대금", vol:"거래량", per:"PER", fper:"선행PER", pbr:"PBR", divy:"배당", pos52:"52주위치",
  rep1m:"리포트1M", repGap:"괴리율", turn:"회전율", range:"변동폭", pos:"고저위치", ulNear:"상한근접", chg:"전일비", gap:"갭" };

function mmMetrics(){
  try{
    var a = JSON.parse(localStorage.getItem(MM_LS_MET) || "null");
    if(Array.isArray(a)){ a = a.filter(function(k){ return COL_BY_K[k]; }).slice(0, 3); if(a.length) return a; }
  }catch(e){}
  return ["capE", "per", "amt"];
}
function mmMetricHtml(q, k){
  var c = COL_BY_K[k]; if(!c) return "";
  var v;
  if(k === "capE") v = typeof q.capE === "number" ? fmtBig(q.capE * 1e8) : "-";
  else if(k === "amt" || k === "vol") v = fmtBig(q[k]);
  else{
    v = cellVal(q, c);
    if(v !== "-" && /%/.test(c.t) && c.f !== "pct") v += "%";
    if(k === "rep1m" && v !== "-") v += "건";
  }
  var lab = MM_MET_SHORT[k] || c.t.replace(/%|\(억\)/g, "");
  var cls = cellCls(q, c);
  return '<span class="mscr-m">' + esc(lab) + ' <b class="m-num' + (cls ? " " + cls : "") + '">' + v + '</b></span>';
}
function mmScrRowHtml(q){
  var sub = esc(q.code) + (q.industry || q.sector ? " · " + esc(q.industry || q.sector) : "");
  var mets = mmMetrics().map(function(k){ return mmMetricHtml(q, k); }).join("");
  return '<button class="mscr-row" data-cd="' + esc(q.code) + '">' +
    '<span class="mscr-l"><span class="mscr-nm">' + esc(q.name || q.code) + '</span><span class="mscr-sub">' + sub + '</span></span>' +
    '<span class="mscr-r"><span class="mscr-px m-num">' + (q.price ? fmt(Math.round(q.price)) : "-") + '</span>' +
      '<span class="mscr-pct m-num ' + dirCls(q.pct) + '">' + fmtPct(q.pct) + '</span></span>' +
    '<span class="mscr-mt">' + mets + '</span></button>';
}

/* 전역 renderScreen 대신 (applyFilter 가 스크리너 화면일 때 부른다) */
function mmScrRender(list){
  var st = MM.scr, box = $("#mScrList");
  if(!box) return;
  var sig = JSON.stringify([FS, scrSort]);
  var keep = sig === st.sig ? st.n : 0;
  st.sig = sig; st.list = list;
  var n = Math.min(list.length, Math.max(MM_SCR_CHUNK, keep, st.keepN || 0));
  st.keepN = 0;
  if(!list.length){
    st.n = 0;
    box.innerHTML = '<div class="m-empty">' + (SCREEN.length
      ? '조건에 맞는 종목이 없습니다.<br><button class="mm-btn" data-scr="reset">조건 초기화</button>'
      : (scanning ? "스캔 중입니다… 결과가 들어오는 대로 보입니다." : '스캔 결과가 없습니다.<br><button class="mm-btn pri" data-scr="scan">지금 스캔</button>')) + '</div>';
  }else{
    box.innerHTML = list.slice(0, n).map(mmScrRowHtml).join("");
    st.n = n;
  }
  mmScrMore();
}
function mmScrAppend(){
  var st = MM.scr, box = $("#mScrList");
  if(!box || st.n >= st.list.length) return;
  var n2 = Math.min(st.list.length, st.n + MM_SCR_CHUNK);
  box.insertAdjacentHTML("beforeend", st.list.slice(st.n, n2).map(mmScrRowHtml).join(""));
  st.n = n2;
  mmScrMore();
}
function mmScrMore(){
  var st = MM.scr, more = $("#mScrMore");
  if(!more) return;
  var left = st.list.length - st.n;
  more.classList.toggle("m-off", left <= 0);
  more.textContent = "더 보기 · " + fmt(st.n) + " / " + fmt(st.list.length);
}

function mmFsCount(){ return Object.keys(FS).filter(function(k){ return FS[k] !== undefined && FS[k] !== ""; }).length; }
function mmSameFs(a, b){
  var ka = Object.keys(a || {}).filter(function(k){ return a[k] !== ""; }).sort();
  var kb = Object.keys(b || {}).filter(function(k){ return b[k] !== ""; }).sort();
  return ka.length === kb.length && ka.every(function(k, i){ return k === kb[i] && String(a[k]) === String(b[k]); });
}
function mmScrPresets(){
  var box = $("#mScrPre"); if(!box) return;
  var items = [["", "전체"]].concat(BUILTIN.map(function(b, i){ return ["b" + i, b.name]; }),
    S.screens.map(function(s, i){ return ["u" + i, s.name]; }));
  box.innerHTML = items.map(function(it){
    return '<button data-pre="' + esc(it[0]) + '"' + (it[0][0] === "u" ? ' class="mine"' : "") + '>' + esc(it[1]) + '</button>';
  }).join("");
  mmScrPresetAct();
}
function mmScrPresetAct(){
  var act = "";
  if(!mmFsCount()) act = "";
  else{
    act = null;
    BUILTIN.forEach(function(b, i){ if(act === null && mmSameFs(b.fs, FS)) act = "b" + i; });
    S.screens.forEach(function(s, i){ if(act === null && mmSameFs(s.fs, FS)) act = "u" + i; });
  }
  $$("#mScrPre button").forEach(function(b){ b.classList.toggle("act", act !== null && b.dataset.pre === act); });
}
function mmScrSum(list){
  var el = $("#mScrSum"); if(!el) return;
  var pool = SCREEN.filter(statFilter).length;
  el.innerHTML = SCREEN.length
    ? '<b class="m-num">' + fmt(list.length) + '</b>종목 <span class="mm-dim2">/ 대상 ' + fmt(pool) + '</span>' +
      (SCAN_AT ? '<span class="mm-dim2"> · ' + esc(mmShortAt(SCAN_AT_MS) || SCAN_AT) + ' 스캔</span>' : "")
    : '<span class="mm-dim2">스캔 전</span>';
  var n = mmFsCount(), bd = $("#mScrBadge");
  bd.textContent = n; bd.classList.toggle("m-off", !n);
  var c = COL_BY_K[scrSort.key];
  $("#mScrSortL").textContent = (c ? (c.k === "name" ? "이름" : c.t.replace(/\(억\)/, "")) : "정렬") + (scrSort.dir < 0 ? " ↓" : " ↑");
  mmScrBusy();
  var done = $("#mScrDone");
  if(done) done.textContent = "결과 " + fmt(list.length) + "종목 보기";
  mmScrPresetAct();
  mmScrMenuV();
}
/* 진행 표시(#scrBar·#scrMsg)는 스캔·심층 분석 중에만 보인다 */
function mmScrBusy(){
  var p = $("#mScrProg"); if(!p) return;
  p.classList.toggle("m-off", !(scanning || deepRunning));
}
function mmShortAt(ms){
  if(!ms) return "";
  var d = new Date(ms), now = new Date();
  var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  return d.toDateString() === now.toDateString() ? "오늘 " + hm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
}

function mmScrMount(){
  var tab = $("#tab-scr"), panel = $(".panel", tab);
  var top = document.createElement("div");
  top.id = "mScrTop";
  top.innerHTML =
    '<div class="m-chips" id="mScrPre" aria-label="프리셋"></div>' +
    '<div class="mscr-bar">' +
      '<button class="mscr-btn" data-scr="cond">' + MM_ICON.scr + '조건<span class="mscr-badge m-num m-off" id="mScrBadge"></span></button>' +
      '<button class="mscr-btn" data-scr="sort">' + MM_ICON.sort + '<span id="mScrSortL">정렬</span></button>' +
      '<button class="mscr-btn" data-scr="met">' + MM_ICON.cols + '지표</button>' +
      '<span class="mscr-scan" id="mScrScanSlot"></span>' +
    '</div>' +
    '<div class="mscr-stat"><div class="mscr-sum" id="mScrSum"></div><div class="mscr-prog" id="mScrProg"></div></div>';
  panel.insertBefore(top, panel.firstChild);
  $("#mScrScanSlot", top).appendChild($("#scrScan"));
  $("#mScrProg", top).appendChild($("#scrBar").parentNode);
  $("#mScrProg", top).appendChild($("#scrMsg"));

  var list = document.createElement("div");
  list.id = "mScrList"; list.className = "m-list mscr-list";
  panel.appendChild(list);
  var more = document.createElement("button");
  more.id = "mScrMore"; more.className = "mm-btn mscr-more m-off";
  panel.appendChild(more);
  more.onclick = mmScrAppend;
  if("IntersectionObserver" in window){
    MM.scr.io = new IntersectionObserver(function(es){
      if(es.some(function(e){ return e.isIntersecting; }) && M.cur === "more" && MM.sub === "scr") mmScrAppend();
    }, { root:mRoot("more"), rootMargin:"0px 0px 600px 0px" });
    MM.scr.io.observe(more);
  }

  /* 조건 시트 내용 — PC 노드를 옮겨 온다 (닫혀 있을 때는 #mMoreHold 에 남는다) */
  var cond = document.createElement("div");
  cond.id = "mScrCond";
  cond.innerHTML =
    '<div class="mm-lb">스캔 범위</div><div id="mScSlotScope"></div>' +
    '<div class="m-list mm-tight">' +
      '<label class="m-row"><span class="m-row-t">자동 스캔<span class="m-row-s">앱 시작 때, 장중에는 5분마다</span></span><span id="mScSlotAuto"></span></label>' +
      '<label class="m-row"><span class="m-row-t">ETF·ETN 포함</span><span id="mScSlotEtf"></span></label>' +
    '</div>' +
    '<div class="mm-lb mm-lbrow">필터<span id="mScSlotReset"></span></div>' +
    '<div id="mScSlotGrid"></div>' +
    '<div class="mm-lb">심층 분석</div>' +
    '<p class="mm-note">RSI · 이격도 · 52주 위치 등 (심층) 지표는 지금 결과의 상위 50종목만 일봉을 받아 계산한다.</p>' +
    '<div class="mm-row2" id="mScSlotDeep"></div>' +
    '<div class="mm-lb">내 스크린</div>' +
    '<div id="mScSlotSaved"></div><div class="mm-row2" id="mScSlotSave"></div>' +
    '<div class="mm-row2" id="mScSlotCsv"></div>' +
    '<div class="mscr-done-wrap"><button class="mm-btn pri mscr-done" id="mScrDone">결과 보기</button></div>';
  MM.hold.appendChild(cond);                   // 먼저 문서에 붙인다 — 옮긴 노드를 id 로 다시 찾을 수 있게
  $("#mScSlotScope", cond).appendChild($("#segScope"));
  [["#autoScan", "#mScSlotAuto"], ["#inclEtf", "#mScSlotEtf"]].forEach(function(p){
    var inp = $(p[0]); inp.classList.add("mm-sw"); inp.setAttribute("role", "switch"); inp.removeAttribute("style");
    $(p[1], cond).appendChild(inp);
  });
  $("#mScSlotReset", cond).appendChild($("#scrReset"));
  $("#scrReset").textContent = "초기화";
  $("#mScSlotGrid", cond).appendChild($("#fgrid"));
  $("#mScSlotDeep", cond).appendChild($("#scrDeep"));
  $("#mScSlotSaved", cond).appendChild($("#savedScreens"));
  $("#mScSlotSave", cond).appendChild($("#scrSave"));
  $("#mScSlotSave", cond).appendChild($("#scrDel"));
  $("#scrDel").textContent = "선택한 내 스크린 삭제";
  $("#mScSlotCsv", cond).appendChild($("#scrCsv"));
  $("#mScrDone", cond).onclick = function(){ if(MM.scr.condSheet) MM.scr.condSheet.close(); };
  MM.scr.condEl = cond;

  top.addEventListener("click", function(e){
    var p = e.target.closest("[data-pre]");
    if(p){
      var v = p.dataset.pre;
      if(!v){ FS = {}; scrSort = { key:"pct", dir:-1 }; syncFilterUI(); applyFilter(); }
      else loadScreen(v);
      mRoot("more").scrollTop = 0;
      return;
    }
    var b = e.target.closest("[data-scr]"); if(!b) return;
    if(b.dataset.scr === "cond") mmOpenCond();
    else if(b.dataset.scr === "sort") mmOpenSort();
    else if(b.dataset.scr === "met") mmOpenMetrics();
  });
  list.addEventListener("click", function(e){
    var a = e.target.closest("[data-scr]");
    if(a){
      if(a.dataset.scr === "reset"){ FS = {}; scrSort = { key:"pct", dir:-1 }; syncFilterUI(); applyFilter(); }
      else if(a.dataset.scr === "scan") runScan();
      return;
    }
    var r = e.target.closest(".mscr-row"); if(!r) return;
    var cd = r.dataset.cd, q = QUOTES["KR:" + cd] || UNI_BY_KEY["KR:" + cd] || {};
    mOpenStock({ code:cd, mk:"KR", name:q.name || cd });
  });

  /* 전역 렌더 연결 (기존 감싸기 사슬 유지) */
  renderScreen = function(list){ mmScrRender(list); };
  renderScrHead = function(){};
  var sumNow = renderScrSum;
  renderScrSum = function(list){ var r = sumNow.apply(this, arguments); mmScrSum(list); return r; };
  var screensNow = renderScreens;
  renderScreens = function(){ var r = screensNow.apply(this, arguments); mmScrPresets(); return r; };
  var indNow = setScanIndicator;
  setScanIndicator = function(){ var r = indNow.apply(this, arguments); mmScrMenuV(); mmScrBusy(); return r; };
  var deepNow = runDeep;
  runDeep = function(){
    var r = deepNow.apply(this, arguments);
    mmScrBusy();
    var t = setInterval(function(){ if(!deepRunning){ clearInterval(t); mmScrBusy(); } }, 500);
    return r;
  };
}

/* 시트에 PC 노드를 잠깐 빌려 준다: 닫히면 #mMoreHold 로 되돌린다 (문서 밖으로 나가지 않게) */
function mmLendSheet(node, opts){
  var ph = document.createElement("div");
  opts.content = ph;
  var userClose = opts.onClose;
  opts.onClose = function(){
    setTimeout(function(){ if(node.parentNode === ph) MM.hold.appendChild(node); }, 200);
    if(userClose) userClose();
  };
  ph.appendChild(node);
  return mSheet(opts);
}
function mmOpenCond(){
  syncFilterUI();
  MM.scr.condSheet = mmLendSheet(MM.scr.condEl, { id:"mm-cond", title:"스크리너 조건", cls:"mm-sheet mm-cond",
    onClose:function(){ MM.scr.condSheet = null; } });
  mmScrSum(lastList);
}
function mmOpenSort(){
  var html = '<div class="m-seg" id="mmSortDir"><button data-d="-1">높은 순 ↓</button><button data-d="1">낮은 순 ↑</button></div>' +
    '<div class="m-list mm-pick">' + MM_SORTS.filter(function(k){ return COL_BY_K[k]; }).map(function(k){
      var c = COL_BY_K[k], on = scrSort.key === k;
      return '<button class="m-row" data-k="' + k + '" role="radio" aria-checked="' + on + '"><span class="m-row-t">' +
        esc(k === "name" ? "종목명 (가나다)" : c.t) + (c.deep ? ' <span class="mm-deep">심층</span>' : "") + '</span>' +
        '<span class="mm-chk' + (on ? " on" : "") + '"></span></button>';
    }).join("") + '</div>';
  var sh = mSheet({ id:"mm-sort", title:"정렬", content:html, cls:"mm-sheet" });
  var seg = $("#mmSortDir", sh.body);
  function syncDir(){ $$("button", seg).forEach(function(b){ b.classList.toggle("act", +b.dataset.d === scrSort.dir); }); }
  syncDir();
  sh.body.addEventListener("click", function(e){
    var d = e.target.closest("[data-d]");
    if(d){ scrSort.dir = +d.dataset.d; syncDir(); applyFilter(); return; }
    var r = e.target.closest("[data-k]"); if(!r) return;
    var k = r.dataset.k;
    if(scrSort.key !== k) scrSort = { key:k, dir:(COL_BY_K[k].type === "s" ? 1 : scrSort.dir) };
    applyFilter();
    mRoot("more").scrollTop = 0;
    sh.close();
  });
}
function mmOpenMetrics(){
  var cur = mmMetrics();
  var keys = MM_SORTS.filter(function(k){ return COL_BY_K[k] && k !== "name" && k !== "price" && k !== "pct"; });
  var box = document.createElement("div");
  function draw(){
    box.innerHTML = '<p class="mm-note">행 아래 줄에 보일 지표를 3개까지 고른다. <b class="m-num">' + cur.length + '/3</b></p>' +
      '<div class="mm-chipgrid">' + keys.map(function(k){
        var c = COL_BY_K[k], i = cur.indexOf(k);
        return '<button data-k="' + k + '" class="' + (i >= 0 ? "act" : "") + '" aria-pressed="' + (i >= 0) + '">' +
          (i >= 0 ? '<span class="mm-ord m-num">' + (i + 1) + '</span>' : "") + esc(c.t) + (c.deep ? '<span class="mm-deep">심층</span>' : "") + '</button>';
      }).join("") + '</div>';
  }
  draw();
  mSheet({ id:"mm-met", title:"표시 지표", content:box, cls:"mm-sheet" });
  box.addEventListener("click", function(e){
    var b = e.target.closest("[data-k]"); if(!b) return;
    var k = b.dataset.k, i = cur.indexOf(k);
    if(i >= 0){
      if(cur.length === 1){ toast("지표를 하나는 남겨 두세요.", "err"); return; }
      cur.splice(i, 1);
    }else{
      if(cur.length >= 3){ toast("최대 3개까지 고를 수 있습니다.", "err"); return; }
      cur.push(k);
      if(COL_BY_K[k].deep && !Object.keys(DEEP).length) toast("(심층) 지표는 조건 시트의 '심층 분석'을 실행해야 채워집니다.");
    }
    try{ localStorage.setItem(MM_LS_MET, JSON.stringify(cur)); }catch(err){}
    draw();
    mmScrRender(lastList);
  });
}

/* =================== 알림 =================== */
function mmAlBeepOn(){ try{ return localStorage.getItem(MM_LS_ALBEEP) !== "0"; }catch(e){ return true; } }
function mmCondText(a){
  var isRate = a.cond === "rge" || a.cond === "rle";
  var v = isRate ? fmtPct(a.val) : fmtPrice(a.val, a.mk) + "원";
  return (isRate ? "등락률 " : "") + v + (a.cond === "ge" || a.cond === "rge" ? " 이상" : " 이하");
}
function mmAlMount(){
  var tab = $("#tab-alr");
  var wrap = document.createElement("div");
  wrap.id = "mAlr";
  var seg = mSegBar([["price", "가격 알림"], ["rep", "리포트 알림"], ["log", "기록"]], function(v){ mmAlSeg(v); });
  seg.id = "mAlSeg";
  wrap.appendChild(seg);
  var body = document.createElement("div");
  body.innerHTML =
    '<div class="mal-pane" data-pane="price">' +
      '<p class="mm-note mm-notice">' + MM_ICON.info + '<span>알림은 <b>앱이 열려 있는 동안</b>에만 시세 갱신 때마다 확인한다. 발동한 규칙은 반복을 막으려고 자동으로 꺼진다.</span></p>' +
      '<div class="m-list" id="mAlRules"></div>' +
      '<button class="mm-btn pri mal-add" id="mAlAddBtn">' + MM_ICON.plus + '알림 추가</button>' +
      '<div class="m-h">알림 방식</div><div class="m-list">' +
        '<div class="m-row"><span class="m-row-t">휴대폰 알림<span class="m-row-s" id="mAlPerm"></span></span><button class="mm-btn sm" id="mAlPermBtn">권한 요청</button></div>' +
        '<label class="m-row"><span class="m-row-t">소리<span class="m-row-s">가격 알림이 울릴 때 짧은 신호음</span></span>' + mmSw('id="mAlBeep" aria-label="가격 알림 소리"') + '</label>' +
        '<button class="m-row" id="mAlBeepTest"><span class="m-row-t">소리 테스트</span>' + MM_ICON.chev + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="mal-pane" data-pane="rep">' +
      '<div class="m-list">' +
        '<label class="m-row"><span class="m-row-t"><b>리포트 알림 사용</b><span class="m-row-s" id="mMrSub"></span></span>' + mmSw('id="mMrOn" aria-label="리포트 알림 사용"') + '</label>' +
      '</div>' +
      '<div class="m-h">알릴 내용</div><div class="m-list" id="mMrTypes">' +
        MR_TYPES.map(function(t){
          return '<label class="m-row"><span class="m-row-t">' + esc(t[1]) + '</span>' + mmSw('data-mmrt="' + t[0] + '" aria-label="' + esc(t[1]) + '"') + '</label>';
        }).join("") +
        '<label class="m-row"><span class="m-row-t">소리</span>' + mmSw('id="mMrBeep" aria-label="리포트 알림 소리"') + '</label>' +
      '</div>' +
      '<p class="mm-note">관심종목(모든 그룹)과 보유 종목(모든 계좌)에 증권사 리포트가 새로 올라오면 알린다. 5분마다 확인하며 앱이 열려 있는 동안에만 동작한다. 처음 켰을 때와 종목을 새로 추가했을 때는 그때까지의 리포트를 기준으로만 기록한다.</p>' +
    '</div>' +
    '<div class="mal-pane" data-pane="log">' +
      '<div class="mal-loghd"><span id="mAlLogN" class="m-num"></span><button class="mm-btn sm" id="mAlLogClr">기록 지우기</button></div>' +
      '<div class="m-list" id="mAlLog"></div>' +
    '</div>';
  while(body.firstChild) wrap.appendChild(body.firstChild);
  tab.insertBefore(wrap, tab.firstChild);

  /* 추가 시트 내용 (닫혀 있을 때는 #mMoreHold) */
  var form = document.createElement("div");
  form.id = "mAlForm";
  form.innerHTML =
    '<div class="mm-lb">종목</div>' +
    '<div class="srch m-srch" id="mAlSrch"><input type="text" placeholder="종목명 · 코드 (예: 삼성전자)" autocomplete="off" enterkeyhint="search" aria-label="알림 종목 검색"><div class="sug"></div></div>' +
    '<div class="mal-pick" id="mAlPick"></div>' +
    '<div class="mm-lb">조건</div>' +
    '<div class="mal-conds" role="radiogroup">' +
      '<button data-c="ge" role="radio">현재가 이상</button><button data-c="le" role="radio">현재가 이하</button>' +
      '<button data-c="rge" role="radio">등락률 이상</button><button data-c="rle" role="radio">등락률 이하</button></div>' +
    '<div class="mm-lb" id="mAlValL">기준 가격</div>' +
    '<div class="mal-val"><button class="mal-sign m-off" id="mAlSign" aria-label="부호 바꾸기">+/−</button>' +
      '<input type="text" id="mAlVal" inputmode="decimal" autocomplete="off" placeholder="70000"><span class="mal-unit" id="mAlUnit">원</span></div>' +
    '<div class="mm-lb">메모 <span class="mm-opt">(선택)</span></div>' +
    '<input type="text" id="mAlMemo" maxlength="40" placeholder="예: 1차 매수가" autocomplete="off">' +
    '<div class="mal-err" id="mAlErr" role="alert"></div>' +
    '<button class="mm-btn pri mal-save" id="mAlSave">알림 추가</button>';
  MM.hold.appendChild(form);
  MM.alr.formEl = form;

  wrap.addEventListener("click", function(e){
    var t = e.target;
    if(t.closest("#mAlAddBtn")){ mmAlOpenAdd(); return; }
    if(t.closest("#mAlPermBtn")){ $("#btnNoti").click(); return; }
    if(t.closest("#mAlBeepTest")){ beep(); return; }
    if(t.closest("#mAlLogClr")){
      if(!S.alertLog.length) return;
      if(!confirm("알림 기록 " + S.alertLog.length + "건을 지울까요?")) return;
      S.alertLog = []; save(); renderAlertLog(); return;
    }
    var del = t.closest("[data-del]");
    if(del){
      var a = S.alerts[+del.dataset.del]; if(!a) return;
      if(!confirm(a.name + " · " + mmCondText(a) + " 규칙을 삭제할까요?")) return;
      S.alerts.splice(+del.dataset.del, 1); save(); renderAlerts();
      toast("규칙을 삭제했습니다.", "ok");
      return;
    }
    var op = t.closest("[data-open]");
    if(op){ var r = S.alerts[+op.dataset.open]; if(r) mOpenStock({ code:r.code, mk:r.mk || "KR", name:r.name }); }
  });
  wrap.addEventListener("change", function(e){
    var t = e.target;
    if(t.dataset.tg !== undefined){
      var a = S.alerts[+t.dataset.tg]; if(!a) return;
      a.on = t.checked; save(); renderAlerts();
      if(a.on) refreshAll();
    }else if(t.id === "mAlBeep"){
      try{ localStorage.setItem(MM_LS_ALBEEP, t.checked ? "1" : "0"); }catch(err){}
    }else if(t.id === "mMrOn"){ MR_CFG.on = t.checked; mrSaveCfg(); mrSyncCfgUI(); }
    else if(t.id === "mMrBeep"){ MR_CFG.beep = t.checked; mrSaveCfg(); mrSyncCfgUI(); }
    else if(t.dataset.mmrt){ MR_CFG.types[t.dataset.mmrt] = t.checked; mrSaveCfg(); mrSyncCfgUI(); }
  });

  form.addEventListener("click", function(e){
    var c = e.target.closest("[data-c]");
    if(c){ MM.alr.cond = c.dataset.c; mmAlFormSync(); $("#mAlVal").focus(); return; }
    if(e.target.closest("#mAlSign")){
      var inp = $("#mAlVal"), v = inp.value.trim();
      inp.value = v[0] === "-" ? v.slice(1) : "-" + v;
      return;
    }
    if(e.target.closest("#mAlSave")) mmAlSave();
  });
  $("#mAlVal", form).addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); mmAlSave(); } });

  /* 전역 렌더 연결 */
  var alNow = renderAlerts;
  renderAlerts = function(){ var r = alNow.apply(this, arguments); mmAlRules(); mmMenuSync(); return r; };
  var logNow = renderAlertLog;
  renderAlertLog = function(){ var r = logNow.apply(this, arguments); mmAlLog(); return r; };
  var notiNow = syncNotiState;
  syncNotiState = function(){ var r = notiNow.apply(this, arguments); mmAlPerm(); return r; };
  var mrNow = mrSyncCfgUI;
  mrSyncCfgUI = function(){ var r = mrNow.apply(this, arguments); mmMrSync(); return r; };
  /* 가격 알림 소리 끄기: evalAlerts 가 부르는 beep 만 막는다 */
  var evalNow = evalAlerts, beepNow = beep, mute = false;
  beep = function(){ if(mute) return; return beepNow.apply(this, arguments); };
  evalAlerts = function(){
    mute = !mmAlBeepOn();
    try{ return evalNow.apply(this, arguments); } finally{ mute = false; }
  };
}
function mmAlSeg(v){
  MM.alr.seg = v;
  $("#mAlSeg").mSet(v);
  $$("#mAlr .mal-pane").forEach(function(p){ p.classList.toggle("m-off", p.dataset.pane !== v); });
  if(v === "price") mmAlRules();
  else if(v === "log") mmAlLog();
  else mmMrSync();
}
function mmAlRules(){
  var box = $("#mAlRules"); if(!box) return;
  if(!S.alerts.length){
    box.innerHTML = '<div class="m-empty">등록된 가격 알림이 없습니다.<br>아래 "알림 추가"로 목표가나 등락률을 정해 두세요.</div>';
    return;
  }
  box.innerHTML = S.alerts.map(function(a, i){
    var q = QUOTES[keyOf(a.mk, a.code)];
    var isRate = a.cond === "rge" || a.cond === "rle";
    var cur = q && q.ok !== false ? (isRate ? q.pct : q.price) : null;
    var curTxt = cur !== null && cur !== undefined ? (isRate ? fmtPct(cur) : fmtPrice(cur, a.mk) + "원") : "-";
    return '<div class="mal-rule' + (a.on ? "" : " off") + '">' +
      '<button class="mal-main" data-open="' + i + '">' +
        '<span class="mal-nm">' + esc(a.name) + '<span class="mal-st">' + (a.on ? "감시 중" : "꺼짐") + '</span></span>' +
        '<span class="mal-cond m-num">' + esc(mmCondText(a)) + '</span>' +
        '<span class="mal-cur m-num">현재 <span class="' + (q ? dirCls(q.pct) : "") + '">' + curTxt + '</span>' +
          (a.memo ? ' · ' + esc(a.memo) : "") + '</span>' +
      '</button>' +
      mmSw('data-tg="' + i + '"' + (a.on ? " checked" : "") + ' aria-label="' + esc(a.name) + ' 알림 켜기"') +
      '<button class="mal-del" data-del="' + i + '" aria-label="' + esc(a.name) + ' 규칙 삭제">' + MM_ICON.trash + '</button>' +
    '</div>';
  }).join("");
}
function mmAlLog(){
  var box = $("#mAlLog"); if(!box) return;
  $("#mAlLogN").textContent = S.alertLog.length ? "최근 " + fmt(Math.min(S.alertLog.length, 200)) + "건" : "";
  $("#mAlLogClr").disabled = !S.alertLog.length;
  if(!S.alertLog.length){ box.innerHTML = '<div class="m-empty">발동 기록이 없습니다.</div>'; return; }
  box.innerHTML = S.alertLog.slice(0, 200).map(function(l){
    return '<div class="m-row mal-log"><span class="m-row-t">' + esc(l.msg) + '<span class="m-row-s m-num">' + esc(l.at) + '</span></span></div>';
  }).join("");
}
function mmAlPerm(){
  var el = $("#mAlPerm"), btn = $("#mAlPermBtn"); if(!el) return;
  var p = typeof Notification === "undefined" ? "none" : Notification.permission;
  el.textContent = p === "granted" ? "허용됨 — 앱 밖 알림도 뜬다" : (p === "denied" ? "거부됨 — 앱 안 알림과 소리만 (브라우저 설정에서 바꿀 수 있다)"
    : (p === "none" ? "이 브라우저는 알림을 지원하지 않는다" : "아직 정하지 않음"));
  btn.classList.toggle("m-off", p !== "default");
  var b = $("#mAlBeep"); if(b) b.checked = mmAlBeepOn();
}
function mmMrSync(){
  var on = $("#mMrOn"); if(!on) return;
  on.checked = MR_CFG.on;
  $$("#mMrTypes [data-mmrt]").forEach(function(el){ el.checked = !!MR_CFG.types[el.dataset.mmrt]; el.disabled = !MR_CFG.on; });
  $("#mMrBeep").checked = MR_CFG.beep; $("#mMrBeep").disabled = !MR_CFG.on;
  $("#mMrTypes").classList.toggle("mm-dim", !MR_CFG.on);
  $("#mMrSub").textContent = "대상: 관심·보유 " + Object.keys(mrCodes()).length + "종목" + (MR_CFG.on ? "" : " · 꺼짐");
  mmMenuSync();
}

function mmAlOpenAdd(){
  var A = MM.alr;
  A.pick = null; A.cond = "ge";
  $("#mAlVal").value = ""; $("#mAlMemo").value = ""; $("#mAlErr").textContent = "";
  $("#mAlSrch input").value = "";
  mmAlFormSync();
  A.sheet = mmLendSheet(A.formEl, { id:"mm-aladd", title:"가격 알림 추가", cls:"mm-sheet",
    onClose:function(){ A.sheet = null; } });
  if(!A.wired){
    setupSearch("#mAlSrch", function(it){ A.pick = it; $("#mAlErr").textContent = ""; mmAlFormSync(); });
    A.wired = true;
  }
}
function mmAlFormSync(){
  var A = MM.alr, isRate = A.cond === "rge" || A.cond === "rle";
  $$("#mAlForm [data-c]").forEach(function(b){
    var on = b.dataset.c === A.cond; b.classList.toggle("act", on); b.setAttribute("aria-checked", on ? "true" : "false");
  });
  $("#mAlValL").textContent = isRate ? "기준 등락률 (전일 대비)" : "기준 가격";
  $("#mAlUnit").textContent = isRate ? "%" : "원";
  $("#mAlSign").classList.toggle("m-off", !isRate);
  var q = A.pick ? QUOTES[keyOf(A.pick.mk, A.pick.code)] : null;
  $("#mAlVal").placeholder = isRate ? (A.cond === "rge" ? "5" : "-3") : (q && q.price ? String(Math.round(q.price)) : "70000");
  var pk = $("#mAlPick");
  pk.innerHTML = A.pick
    ? '<b>' + esc(A.pick.name) + '</b> <span class="m-num mm-dim2">' + esc(A.pick.code) + '</span>' +
      (q && q.price ? '<span class="m-num mal-pq">' + fmtPrice(q.price, "KR") + '원 <span class="' + dirCls(q.pct) + '">' + fmtPct(q.pct) + '</span></span>' : "")
    : '<span class="mm-dim2">위에서 종목을 검색해 고르세요.</span>';
  pk.classList.toggle("on", !!A.pick);
}
function mmAlSave(){
  var A = MM.alr, err = $("#mAlErr");
  var raw = $("#mAlVal").value.trim().replace(/,/g, "").replace(/[−–]/g, "-").replace(/[%원]$/, "");
  var isRate = A.cond === "rge" || A.cond === "rle";
  var v = Number(raw);
  var msg = "";
  if(!A.pick) msg = "종목을 먼저 고르세요.";
  else if(!raw || !isFinite(v)) msg = isRate ? "기준 등락률을 숫자로 입력하세요 (예: 5, -3)." : "기준 가격을 숫자로 입력하세요 (예: 70000).";
  else if(!isRate && v <= 0) msg = "가격은 0보다 커야 합니다.";
  else if(isRate && (v < -30 || v > 30)) msg = "등락률은 -30 ~ +30% 사이로 입력하세요.";
  err.textContent = msg;
  if(msg){
    (A.pick ? $("#mAlVal") : $("#mAlSrch input")).focus();
    return;
  }
  /* 07 의 #alAdd 와 같은 처리 */
  S.alerts.push({ mk:A.pick.mk || "KR", code:A.pick.code, name:A.pick.name, cond:A.cond, val:v,
                  memo:$("#mAlMemo").value.trim(), on:true });
  save(); renderAlerts(); refreshAll();
  if(A.sheet) A.sheet.close();
  toast("알림 규칙을 추가했습니다.", "ok");
}

/* =================== 화면 등록 =================== */
mScreen("more", {
  title: function(p){ return p.sub === "scr" ? "스크리너" : (p.sub === "alr" ? "알림" : "더보기"); },
  mount: function(root){
    var hold = document.createElement("div");
    hold.id = "mMoreHold"; hold.className = "m-off";
    root.appendChild(hold);
    MM.hold = hold;
    hold.appendChild($("#btnTheme"));           // 공유 코드가 글자를 바꾸므로 문서에는 남겨 둔다
    hold.appendChild($("#btnAuto"));
    hold.appendChild($("#scanInd"));

    var menu = mmBuildMenu();
    root.appendChild(menu);
    MM.menu = menu;
    $("#mUpdSlot", menu).appendChild($("#upd"));
    menu.addEventListener("click", function(e){
      var g = e.target.closest("[data-go]");
      if(g){ mGo("more", { sub:g.dataset.go, from:"menu" }, { push:true }); return; }
      var cc = e.target.closest("#mmCc [data-cc]");   // <html> 에도 data-cc 가 있다
      if(cc){ mmSetCc(cc.dataset.cc); return; }
      var a = e.target.closest("[data-act]"); if(!a) return;
      var act = a.dataset.act;
      if(act === "iv") mmOpenIv();
      else if(act === "export") exportJson();
      else if(act === "import") $("#sFile").click();
      else if(act === "csv") openImport();
      else if(act === "adv") mmOpenAdv();
      else if(act === "install") mmOpenInstall();
      else if(act === "src") mmOpenSources();
    });
    menu.addEventListener("change", function(e){
      var t = e.target;
      if(t.id === "mmTheme"){ S.theme = t.checked ? "dark" : "light"; save(); applyTheme(); }
      else if(t.id === "mmAuto"){
        S.auto = t.checked; save(); syncAutoBtn();           /* 07 #btnAuto 와 같은 처리 */
        if(S.auto){ failStreak = 0; startTimer(); refreshAll(); } else stopTimer();
      }
      mmMenuSync();
    });

    var sub = document.createElement("div");
    sub.className = "m-more-sub";
    sub.appendChild($("#tab-scr"));
    sub.appendChild($("#tab-alr"));
    root.appendChild(sub);
    mmScrMount();
    mmAlMount();
    mmAlSeg("price");

    var updNow = rpUpdated;
    rpUpdated = function(){ var r = updNow.apply(this, arguments); if(M.cur === "more" && !MM.sub) mmInfoSync(); return r; };
    /* 앱 빌드 식별자: m/sw.js 의 BUILD_ID */
    if(location.protocol !== "file:" && window.fetch){
      fetch("sw.js", { cache:"no-store" }).then(function(r){ return r.ok ? r.text() : ""; }).then(function(t){
        var m = /BUILD_ID\s*=\s*"([0-9a-f]+)"/.exec(t || "");
        if(m){ MM.build = m[1]; mmInfoSync(); }
      }).catch(function(){});
    }
  },
  show: function(p, prev){
    var root = mRoot("more");
    var sub = p.sub === "scr" || p.sub === "alr" ? p.sub : "";
    var old = MM.sub;
    if(prev === "more" && old !== sub) MM.pos[old || "menu"] = root.scrollTop;
    if(prev === "more" && old === "" && sub) MM.pos[sub] = 0;  // 메뉴에서 새로 들어가면 맨 위
    MM.sub = sub;
    MM.menu.classList.toggle("m-off", !!sub);
    $("#tab-scr").classList.toggle("m-off", sub !== "scr");
    $("#tab-alr").classList.toggle("m-off", sub !== "alr");
    mSetBack(!!sub);
    if(sub === "scr"){
      if(MM.scr.n) MM.scr.keepN = MM.scr.n;
      mDesk("scr");
      if(!scrDirty) mmScrRender(lastList);
      mmScrSum(lastList);
      mmScrPresets();
    }else if(sub === "alr"){
      mDesk("alr");
      mmAlPerm();
      mmAlSeg(MM.alr.seg);
    }else{
      mDesk("more");
      mmMenuSync();
      mmInfoSync();
      /* 리포트 메타를 아직 못 받았으면 받을 때까지 가볍게 다시 본다 */
      if(!RMETA && !MM.infoT) MM.infoT = setInterval(function(){
        if(!RMETA) return;
        clearInterval(MM.infoT); MM.infoT = null; mmInfoSync();
      }, 1000);
    }
    var y = MM.pos[sub || "menu"] || 0;
    root.scrollTop = y;
    if(sub === "scr" && y) setTimeout(function(){ if(MM.sub === "scr") root.scrollTop = y; }, 60);
  },
  hide: function(){
    MM.pos[MM.sub || "menu"] = mRoot("more").scrollTop;
    if(MM.sub === "scr") MM.scr.keepN = MM.scr.n;
  },
  /* 탭 바의 더보기를 다시 누르면 메뉴로 */
  reselect: function(){
    if(!M.params.sub) return false;
    if(M.params.from === "menu") history.back();
    else mGo("more", {}, { replace:true });
    return true;
  }
});
