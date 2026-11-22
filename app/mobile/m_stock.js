/* =========================================================================
   종목 화면 — app/mobile/m_stock.js (+ m_stock.css, 뿌리 #m-stock)
   세그먼트 [종목분석 | 기업분석] 아래에 PC #tab-anal · #tab-cmp 를 옮겨 담고, 폰 화면용으로 다시 배치했다.
   파라미터: { seg:"anal"|"cmp", code, mk, name } — code 가 지금 종목(AN.sel)과 다르면 그 종목을 고른다.
   다른 화면에서 종목을 누르면 공유 코드가 selectStock() + showTab("anal") → 이 화면이 열린다.

   구성 (위에서 아래로)
   - 시작 상태 #mStStart: 종목을 아직 고르지 않았을 때. 검색(mOpenSearch) · 최근 본 종목 · 관심종목
   - 종목 머리 #mStHead: 이름 · 코드·시장·업종 · 현재가 · 등락 칩 · 관심 별 · 검색 (PC 제목 줄·검색 상자는 숨김)
   - 차트: 기간·봉 한 줄(#segPeriod·#segTf), MA·목표가 칩(#maLeg), 값 읽기 줄 #mStRead, 캔버스(#chart, 화면 폭 꽉),
           목표가 요약(#anTgtSum) 카드.  터치: 길게 누르거나 옆으로 밀면 십자선 + 값 읽기 줄, 세로로 밀면 화면 스크롤.
           탭하면 그 봉(또는 목표가 점)을 읽기 줄에 고정. 목표가 점 상세는 읽기 줄을 누르면 시트로.
   - 지표 #mStStats: PC #anStats 표(renderAnalysisHead 결과)를 2열 칸으로 옮겨 그린다 (현재가·등락은 머리에)
   - 리포트: #anRepPanel 의 컨센서스(#anRepCons)는 카드로 재배치, 목록은 #mStRep 카드 5건 + 더 보기(→ 리포트 화면 이 종목 필터)
   - 뉴스·공시(#anFeeds): 5건 + 더 보기
   - 기업분석: 다섯 보고서의 "새 창에서 열기" 목록이 먼저, 그 아래 삽입 페이지(폰 폭 맞춤 / 원래 크기 전환)
   다시 그리는 때: renderAnalysisHead(종목 선택·시세 갱신·차트 이력 도착)와 rpRenderAnal(리포트 데이터)을 감싼다.
   ========================================================================= */
const MST = { root:null, seg:null, read:null, readPin:null, drag:null, cmpFit:true, lastW:0 };

function mStQuote(){
  var it = AN.sel; if(!it) return null;
  return QUOTES[keyOf(it.mk, it.code)] || null;
}
function mStInWl(){
  var it = AN.sel; if(!it || isIdx(it)) return false;
  var k = keyOf(it.mk, it.code);
  return WL().some(function(w){ return keyOf(w.mk, w.code) === k; });
}
function mStToggleWl(){
  var it = AN.sel; if(!it || isIdx(it)) return;
  var k = keyOf(it.mk, it.code), wl = WL();
  for(var i=0;i<wl.length;i++){
    if(keyOf(wl[i].mk, wl[i].code) === k){
      wl.splice(i, 1); save(); renderWatchlist();
      toast(it.name + " 관심종목에서 뺌");
      mStRenderHead(); return;
    }
  }
  addWatch({ mk:it.mk, code:it.code, name:it.name });
  mStRenderHead();
}

/* ---------- 시작 상태 ---------- */
function mStRenderStart(){
  var box = $("#mStStart"); if(!box) return;
  var rc = mRecent(), wl = WL();
  var html = '<button class="mst-sbox" data-act="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
    '<span>종목명 · 코드 검색</span></button>';
  if(rc.length){
    html += '<div class="m-h">최근 본 종목</div><div class="m-chips mst-recent">' + rc.map(function(x){
      return '<button data-code="' + esc(x.code) + '" data-mk="' + esc(x.mk || "KR") + '" data-name="' + esc(x.name) + '">' +
             esc(x.name) + '</button>';
    }).join("") + '</div>';
  }
  html += '<div class="m-h">관심종목' + (S.wlGroups && S.wlGroups.length > 1 ? " · " + esc(S.wlGroups[S.wlActive].name) : "") + '</div>';
  if(wl.length){
    html += '<div class="m-list">' + wl.map(function(w){
      var q = QUOTES[keyOf(w.mk, w.code)];
      var ok = q && q.price > 0;
      return '<button class="m-row" data-code="' + esc(w.code) + '" data-mk="' + esc(w.mk || "KR") + '" data-name="' + esc(w.name) + '">' +
        '<span class="m-row-t">' + esc(w.name) + '<span class="m-row-s m-num">' + esc(w.code) + '</span></span>' +
        '<span class="m-row-v m-num"><b>' + (ok ? fmtPrice(q.price, w.mk) : "-") + '</b>' +
        '<span class="mst-chg ' + (ok ? dirCls(q.pct) : "flat") + '">' + (ok ? fmtPct(q.pct) : "") + '</span></span></button>';
    }).join("") + '</div>';
  }else{
    html += '<div class="m-empty">관심종목이 없습니다. 종목을 연 뒤 ☆ 를 눌러 추가하세요.</div>';
  }
  box.innerHTML = html;
}

/* ---------- 종목 머리 ---------- */
function mStRenderHead(){
  var el = $("#mStHead"), it = AN.sel; if(!el || !it) return;
  var idx = isIdx(it), q = idx ? null : mStQuote(), bars = AN.bars;
  var price = null, chg = null, pct = null;
  if(q && q.price > 0){ price = q.price; chg = q.chg; pct = q.pct; }
  else if(bars.length){
    price = bars[bars.length-1].c;
    if(bars.length > 1 && AN.tf === "day"){ chg = price - bars[bars.length-2].c; pct = chg / bars[bars.length-2].c * 100; }
  }
  var u = UNI_BY_KEY[keyOf(it.mk, it.code)];
  var sub = idx ? "지수" : [it.code, u && u.market, u && u.industry].filter(Boolean).join(" · ");
  var on = mStInWl(), dc = dirCls(chg);
  el.innerHTML =
    '<div class="mst-h1"><div class="mst-nm"><div class="mst-name">' + esc(it.name) + '</div>' +
      '<div class="mst-sub m-num">' + esc(sub) + '</div></div>' +
      '<button class="mst-ib" data-act="search" aria-label="다른 종목 검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>' +
      (idx ? "" : '<button class="mst-ib mst-star' + (on ? " on" : "") + '" data-act="star" aria-pressed="' + on + '" aria-label="' +
        (on ? "관심종목에서 빼기" : "관심종목에 추가") + '"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linejoin="round" fill="' + (on ? "currentColor" : "none") + '"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 ' +
        '1.1-6.1L3.2 9.6l6.1-.8z"/></svg></button>') +
    '</div>' +
    '<div class="mst-h2 m-num"><span class="mst-px ' + dc + '">' + (price === null ? "-" : fmtPrice(price, it.mk)) + '</span>' +
      (chg === null ? "" : '<span class="mst-chip ' + dc + '">' + (chg > 0 ? "▲" : (chg < 0 ? "▼" : "")) + " " +
        (idx ? Math.abs(chg).toFixed(2) : fmt(Math.abs(Math.round(chg)))) + " · " + fmtPct(pct) + '</span>') +
    '</div>';
}

/* ---------- 지표 2열 (PC #anStats 표를 옮겨 그린다) ---------- */
const MST_SKIP = { "현재가":1, "등락률":1, "전일대비":1, "현재 지수":1 };
function mStRenderStats(){
  var box = $("#mStStats"); if(!box) return;
  var out = [];
  $$("#anStats td.k").forEach(function(k){
    var v = k.nextElementSibling, key = k.textContent.trim();
    if(!v || MST_SKIP[key]) return;
    var cls = (v.className || "").replace(/\bv\b/, "").trim();
    out.push('<div class="mst-st"><span class="k">' + esc(key) + '</span><span class="v m-num ' + esc(cls) + '">' + v.innerHTML + '</span></div>');
  });
  if(out.length % 2) out.push('<div class="mst-st fill"></div>');
  box.innerHTML = out.join("");
}

/* ---------- 리포트 카드 ---------- */
function mStRenderReports(){
  var box = $("#mStRep"); if(!box) return;
  var it = AN.sel;
  if(!it || isIdx(it) || typeof RP_READY === "undefined" || !RP_READY){ box.innerHTML = ""; return; }
  var list = rpByCode[it.code] || [];
  if(!list.length){ box.innerHTML = ""; return; }
  var html = list.slice(0, 5).map(function(r){
    var g = rpGapOf(r), hasSum = rpHasSum(r), open = hasSum && rpOpenSum[r.id];
    return '<div class="rcard mst-rc' + (hasSum ? " hs" : "") + (open ? " open" : "") + '"' + (hasSum ? ' data-csum="' + esc(r.id) + '"' : "") + '>' +
      '<div class="l1"><span class="nm">' + rpBadgeOf(r) + rpSuspectTag(r) + rpHitTag(r) + '</span>' +
        '<span class="v m-num">' + (typeof r.target === "number" ? rpTargetCell(r) : '<span class="flat">목표가 없음</span>') +
        (g === null ? "" : ' <span class="' + dirCls(g) + '">' + fmtPct(g) + '</span>') + '</span></div>' +
      '<div class="l2">' + rpTitleLink(r) + '</div>' +
      '<div class="l3">' + esc(r.broker || "") + (r.analyst ? " · " + esc(r.analyst) : "") + " · " + esc((r.date || "").slice(2)) +
        (hasSum ? '<span class="tg">' + (open ? "요약 접기 ▴" : "요약 ▾") + '</span>' : "") + '</div>' +
      (open ? '<div class="sum">' + rpSumHtml(r) + '</div>' : "") + '</div>';
  }).join("");
  html += '<button class="mst-more" data-act="repmore">리포트 ' + fmt(list.length) + '건 모두 보기</button>';
  box.innerHTML = html;
}
/* 요약을 받는 중이면 다 받을 때까지 다시 그린다 (09 는 받은 뒤 rpRender 만 부른다) */
function mStWaitSum(n){
  if(!$(".mst-rc .sum .flat", $("#mStRep")) || n > 40) return;
  setTimeout(function(){
    if(typeof rpSumState === "object" && Object.keys(rpSumState).some(function(k){ return rpSumState[k] === "loading"; }))
      return mStWaitSum(n + 1);
    mStRenderReports();
  }, 300);
}
function mStRepMore(){
  var it = AN.sel; if(!it) return;
  RP.codes = [it.code]; RP.view = "reports"; RP.period = "all";
  RP.sortKey = "date"; RP.sortDir = "desc";
  mGo("reports", {}, { push:true });
  try{ rpRender(); }catch(e){ console.warn(e); }
}

/* ---------- 차트 값 읽기 ---------- */
function mStBarIdx(clientX){
  var cv = $("#chart"), n = AN.bars.length; if(!n) return -1;
  var r = cv.getBoundingClientRect(), plotW = cv.clientWidth - 6 - 58;
  var i = Math.floor((clientX - r.left - 6) / (plotW / n));
  return Math.max(0, Math.min(n - 1, i));
}
function mStReadBar(i){
  var el = MST.read, b = AN.bars[i]; if(!el || !b) return;
  var mk = AN.sel ? AN.sel.mk : "KR", prev = i > 0 ? AN.bars[i-1].c : b.o;
  var ch = b.c - prev, pc = prev ? ch / prev * 100 : 0, dc = dirCls(ch);
  el.className = "mst-read m-num on";
  el.innerHTML = '<div class="r1"><b>' + fmtDate(b.d) + '</b><span class="c">종가 <b class="' + dc + '">' + fmtPrice(b.c, mk) + '</b></span>' +
    '<span class="' + dc + '">' + fmtSigned(Math.round(ch * 100) / 100) + " (" + fmtPct(pc) + ')</span></div>' +
    '<div class="r2"><span>시 ' + fmtPrice(b.o, mk) + '</span><span>고 <i class="up">' + fmtPrice(b.h, mk) + '</i></span>' +
    '<span>저 <i class="down">' + fmtPrice(b.l, mk) + '</i></span><span>량 ' + fmtBig(b.v) + '</span></div>';
}
function mStReadDot(dot){
  var el = MST.read, rp = dot.r, tc = rp.target_change; if(!el) return;
  var chTxt = tc === "up" ? '<span class="up">상향 ▲</span>' : (tc === "down" ? '<span class="down">하향 ▼</span>' :
              (tc === "new" ? "신규" : (tc === "same" ? "유지" : "")));
  el.className = "mst-read m-num on dot";
  el.innerHTML = '<div class="r1"><b>' + esc((rp.date || "").slice(2)) + '</b><span class="br">' + esc(rp.broker || "") + '</span>' +
    rpBadgeOf(rp) + '<span class="c">목표 <b>' + fmt(rp.target) + '</b> ' + chTxt + '</span></div>' +
    '<div class="r2"><span class="tt">' + esc(rp.title || "") + '</span><span class="more">상세 ›</span></div>';
}
function mStReadIdle(){
  var el = MST.read; if(!el) return;
  MST.readPin = null;
  el.className = "mst-read idle";
  el.innerHTML = AN.bars.length ? '<div class="hint">차트를 길게 누르거나 옆으로 밀면 그날 값이 여기에 나옵니다.<br>목표가 점을 누르면 그 리포트가 나옵니다.</div>' : "";
}
function mStClearRead(){
  if(AN.hover !== -1){ AN.hover = -1; drawChart(); }
  mStReadIdle();
}
function mStDotSheet(rp){
  /* 시트는 #m-stock 밖(#mSheetHost)에 뜨므로 화면 CSS 대신 인라인 스타일 */
  var row = function(k, v){
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;' +
      'border-bottom:1px solid var(--line);font-size:15px"><span style="color:var(--tx3)">' + k + '</span>' +
      '<span class="m-num" style="text-align:right">' + v + '</span></div>';
  };
  var tc = rp.target_change;
  var html = '<div>' +
    '<div style="font-size:16px;font-weight:600;line-height:1.45;margin:0 0 6px">' + rpTitleLink(rp) + '</div>' +
    row("날짜", esc(rp.date || "-")) + row("증권사", esc(rp.broker || "-")) +
    (rp.analyst ? row("애널리스트", esc(rp.analyst)) : "") +
    row("의견", rpBadgeOf(rp)) + row("목표가", "<b>" + fmt(rp.target) + "</b>") +
    row("이전 목표가", typeof rp.prev_target === "number" ? fmt(rp.prev_target) : "-") +
    row("변경", tc === "up" ? '<span class="up">상향</span>' : (tc === "down" ? '<span class="down">하향</span>' :
        (tc === "new" ? "신규" : (tc === "same" ? "유지" : "-")))) +
    row("현재가 대비", (function(g){ return g === null ? "-" : '<span class="' + dirCls(g) + '">' + fmtPct(g) + "</span>"; })(rpGapOf(rp))) +
    '</div>';
  mSheet({ id:"tgtdot", title:"목표주가 리포트", content:html });
}
function mStInitTouch(){
  var cv = $("#chart"), LONG = 260, SLOP = 8;
  function pointAt(x){
    var i = mStBarIdx(x); if(i < 0) return;
    if(i !== AN.hover){ AN.hover = i; drawChart(); }
    mStReadBar(i);
  }
  cv.addEventListener("touchstart", function(e){
    if(e.touches.length !== 1){ MST.drag = null; return; }
    var t = e.touches[0];
    var d = MST.drag = { x0:t.clientX, y0:t.clientY, mode:"wait", timer:0 };
    d.timer = setTimeout(function(){
      if(MST.drag === d && d.mode === "wait"){ d.mode = "read"; pointAt(d.x0); }
    }, LONG);
  }, { passive:true });
  cv.addEventListener("touchmove", function(e){
    var d = MST.drag; if(!d) return;
    var t = e.touches[0], dx = t.clientX - d.x0, dy = t.clientY - d.y0;
    if(d.mode === "wait"){
      if(Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      clearTimeout(d.timer);
      if(Math.abs(dx) > Math.abs(dy)) d.mode = "read";
      else { d.mode = "scroll"; return; }               // 세로: 화면 스크롤에 맡긴다
    }
    if(d.mode !== "read") return;
    if(e.cancelable) e.preventDefault();
    pointAt(t.clientX);
  }, { passive:false });
  function end(e){
    var d = MST.drag; MST.drag = null; if(!d) return;
    clearTimeout(d.timer);
    if(d.mode === "wait" && e.type === "touchend"){       // 짧은 탭: 목표가 점 → 리포트, 아니면 그 봉
      var r = cv.getBoundingClientRect();
      var dot = tgtHit(d.x0 - r.left, d.y0 - r.top, 16);
      if(dot){ MST.readPin = dot; mStReadDot(dot); var i = mStBarIdx(d.x0); if(i !== AN.hover){ AN.hover = i; drawChart(); } }
      else { MST.readPin = null; pointAt(d.x0); }
      if(e.cancelable) e.preventDefault();               // 호환 click(PC 툴팁)은 막는다
    }
  }
  cv.addEventListener("touchend", end, { passive:false });
  cv.addEventListener("touchcancel", end, { passive:true });
  /* 차트·읽기 줄 밖을 누르면 읽기 해제 */
  document.addEventListener("touchstart", function(e){
    if(!MST.read || M.cur !== "stock") return;
    if(e.target === cv || MST.read.contains(e.target)) return;
    if(AN.hover !== -1 || MST.read.classList.contains("on")) mStClearRead();
  }, { passive:true });
  MST.read.addEventListener("click", function(){
    if(MST.readPin && MST.readPin.r) mStDotSheet(MST.readPin.r);
  });
  /* 폭이 바뀌거나 화면이 보이게 될 때 캔버스를 그 크기로 다시 그린다 */
  if(window.ResizeObserver){
    new ResizeObserver(function(){
      var w = cv.clientWidth;
      if(w > 0 && w !== MST.lastW){ MST.lastW = w; if(AN.sel) drawChart(); }
    }).observe(cv);
  }
}

/* ---------- 뉴스·공시: 5건 + 더 보기 ---------- */
function mStFeedMore(box){
  var btn = document.createElement("button");
  btn.className = "mst-more m-off"; btn.type = "button";
  box.parentNode.insertBefore(btn, box.nextSibling);
  function upd(){
    var n = $$("li", box).length, open = box.classList.contains("mst-open");
    btn.classList.toggle("m-off", n <= 5);
    btn.textContent = open ? "접기" : "더 보기 (" + (n - 5) + "건)";
  }
  btn.onclick = function(){ box.classList.toggle("mst-open"); upd(); };
  new MutationObserver(function(){ box.classList.remove("mst-open"); upd(); }).observe(box, { childList:true });
  upd();
}

/* ---------- 기업분석 ---------- */
function mStRenderCmpList(){
  var box = $("#mStCmpList"), it = AN.sel; if(!box) return;
  if(!it || isIdx(it)){ box.innerHTML = ""; return; }
  box.innerHTML = '<div class="m-h">와이즈리포트 보고서 · 새 창에서 열기</div><div class="m-list">' + CMP_REPORTS.map(function(x){
    return '<a class="m-row" href="' + esc(cmpUrl(it.code, x.r)) + '" target="_blank" rel="noopener">' +
      '<span class="m-row-t">' + esc(x.t) + '</span><span class="m-row-v">새 창</span>' +
      '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>';
  }).join("") + '</div>';
}
function mStCmpFit(){
  var wrap = $("#m-stock .cmpwrap"), fr = $("#cmpFrame"); if(!wrap || !fr) return;
  var FW = 980, FH = 2600;
  wrap.classList.toggle("mst-fit", MST.cmpFit);
  $$("#mStCmpMode button").forEach(function(b){ b.classList.toggle("act", (b.dataset.v === "fit") === MST.cmpFit); });
  if(MST.cmpFit){
    var w = wrap.clientWidth || (window.innerWidth - 24), s = w / FW;
    fr.style.setProperty("width", FW + "px", "important");
    fr.style.setProperty("transform", "scale(" + s + ")");
    wrap.style.height = Math.round(FH * s) + "px";
  }else{
    fr.style.setProperty("width", FW + "px", "important");
    fr.style.removeProperty("transform");
    wrap.style.height = "";
  }
}

/* ---------- 전체 다시 그리기 ---------- */
function mStSync(){
  var has = !!AN.sel;
  var root = MST.root; if(!root) return;
  $("#mStStart").classList.toggle("m-off", has);
  $("#mStHead").classList.toggle("m-off", !has);
  MST.seg.classList.toggle("m-off", !has || isIdx(AN.sel));
  if(!has){ mStRenderStart(); return; }
  mStRenderHead(); mStRenderStats();
  if(!MST.readPin && !(MST.drag && MST.drag.mode === "read") && AN.hover < 0) mStReadIdle();
}

mScreen("stock", {
  title: function(p){ return (p && p.name) || "종목"; },
  mount: function(root){
    MST.root = root;
    this.seg = MST.seg = mSegBar([["anal", "종목분석"], ["cmp", "기업분석"]], function(v){
      mGo("stock", Object.assign({}, M.params, { seg:v }), { replace:true });
    });
    var start = document.createElement("div");
    start.id = "mStStart";
    root.appendChild(start);
    var head = document.createElement("div"); head.id = "mStHead"; head.className = "mst-head m-off";
    root.appendChild(head);                                 // 머리는 두 세그먼트가 같이 쓴다
    root.appendChild(this.seg);
    root.appendChild($("#tab-anal"));
    root.appendChild($("#tab-cmp"));

    /* 종목분석: 머리 · 차트 · 지표 재배치 (공유 코드가 쓰는 요소 id 는 그대로) */
    var body = $("#anBody"), ctrl = $("#segPeriod").parentNode, chw = $("#chart").parentNode;
    var chart = document.createElement("div"); chart.className = "mst-chart";
    body.insertBefore(chart, body.firstChild);
    var row = document.createElement("div"); row.className = "mst-ctrl";
    row.appendChild($("#segPeriod")); row.appendChild($("#segTf"));
    var leg = $("#maLeg"); leg.classList.add("mst-leg");
    var read = MST.read = document.createElement("div"); read.className = "mst-read idle"; read.setAttribute("aria-live", "polite");
    chart.appendChild(row); chart.appendChild(leg); chart.appendChild(read); chart.appendChild(chw);
    chart.appendChild($("#anTgtSum"));
    ctrl.remove();
    var sh = document.createElement("div"); sh.className = "m-h"; sh.textContent = "주요 지표";
    var stats = document.createElement("div"); stats.id = "mStStats"; stats.className = "mst-stats";
    body.appendChild(sh); body.appendChild(stats);
    body.appendChild($("#anStats").closest(".tbw"));       // PC 표는 숨겨 두고 내용만 읽는다

    /* 리포트: 컨센서스 + 카드 목록 */
    var rep = document.createElement("div"); rep.id = "mStRep"; rep.className = "mst-rep";
    $("#anRepPanel").appendChild(rep);
    rep.addEventListener("click", function(e){
      if(e.target.closest("[data-act=repmore]")){ mStRepMore(); return; }
      var rb = e.target.closest("button[data-sumretry]");
      if(rb){ delete rpSumState[rb.dataset.sumretry]; rpLoadSummary(rb.dataset.sumretry); mStRenderReports(); mStWaitSum(0); return; }
      if(e.target.closest("a")) return;
      var c = e.target.closest("[data-csum]");
      if(!c || e.target.closest(".sum")) return;
      var id = c.dataset.csum;
      if(rpOpenSum[id]) delete rpOpenSum[id]; else rpOpenSum[id] = true;
      mStRenderReports(); mStWaitSum(0);
    });

    /* 뉴스·공시 */
    mStFeedMore($("#anNews")); mStFeedMore($("#anDc"));

    /* 머리·시작 상태 버튼 */
    root.addEventListener("click", function(e){
      var a = e.target.closest("[data-act]");
      if(a && a.dataset.act === "search"){ mOpenSearch(); return; }
      if(a && a.dataset.act === "star"){ mStToggleWl(); return; }
      var s = e.target.closest("#mStStart [data-code]");
      if(s) mOpenStock({ code:s.dataset.code, mk:s.dataset.mk, name:s.dataset.name });
    });

    /* 기업분석: 새 창 목록 → 보고서 칩 → 삽입 페이지 */
    var cbody = $("#cmpBody"), list = document.createElement("div"); list.id = "mStCmpList";
    cbody.insertBefore(list, cbody.firstChild);
    var h2 = document.createElement("div"); h2.className = "m-h"; h2.textContent = "앱 안에서 보기";
    cbody.insertBefore(h2, list.nextSibling);
    var segC = $("#segCmp"); segC.classList.add("m-chips", "mst-cseg");
    cbody.insertBefore(segC, h2.nextSibling);
    var mode = mSegBar([["fit", "폰 폭에 맞춤"], ["full", "원래 크기 (옆으로 밀기)"]], function(v){
      MST.cmpFit = v === "fit"; mStCmpFit();
    });
    mode.id = "mStCmpMode";
    cbody.insertBefore(mode, segC.nextSibling);
    window.addEventListener("resize", function(){ if(M.cur === "stock") mStCmpFit(); });

    /* 공유 렌더 감싸기 — 07 init 보다 먼저라 05 의 rpRenderAnal 감싸기(목표가 오버레이)가 이 바깥에 얹힌다 */
    var headNow = renderAnalysisHead;
    renderAnalysisHead = function(){
      var r = headNow.apply(this, arguments);
      try{ mStSync(); }catch(e){ console.error("[m] stock head", e); }
      return r;
    };
    var repNow = rpRenderAnal;
    rpRenderAnal = function(){
      var r = repNow.apply(this, arguments);
      try{ mStRenderReports(); }catch(e){ console.error("[m] stock rep", e); }
      return r;
    };
    var wlNow = renderWatchlist;
    renderWatchlist = function(){
      var r = wlNow.apply(this, arguments);
      if(M.cur === "stock"){ try{ if(AN.sel) mStRenderHead(); else mStRenderStart(); }catch(e){} }
      return r;
    };
  },
  show: function(p){
    if(!MST.touch){ MST.touch = true; mStInitTouch(); }
    var seg = p.seg === "cmp" ? "cmp" : "anal";
    if(p.code && (!AN.sel || AN.sel.code !== p.code)){
      MST.readPin = null; AN.hover = -1;
      selectStock({ mk:p.mk || "KR", code:p.code, name:p.name || p.code });
    }
    var idx = AN.sel && AN.sel.mk === "IDX";
    if(idx) seg = "anal";
    this.seg.mSet(seg);
    $("#tab-anal").classList.toggle("m-off", seg !== "anal" || !AN.sel);
    $("#tab-cmp").classList.toggle("m-off", seg !== "cmp" || !AN.sel);
    if(seg === "cmp" && AN.sel && !idx && (!CMP.sel || CMP.sel.code !== AN.sel.code)) selectCompany(AN.sel);
    mDesk(seg);
    mSetTitle(AN.sel ? AN.sel.name : "종목");
    mStSync();
    if(seg === "cmp"){ mStRenderCmpList(); requestAnimationFrame(mStCmpFit); }
    else if(AN.sel) requestAnimationFrame(function(){ MST.lastW = $("#chart").clientWidth; drawChart(); });
  },
  hide: function(){ MST.drag = null; },
  refresh: function(){
    if(AN.sel){ loadBars(); if(!isIdx(AN.sel)) renderNews(true); }
    else mStRenderStart();
    return Promise.resolve();
  }
});
