/* =========================================================================
   리포트 화면 — app/mobile/m_reports.js (+ m_reports.css, 뿌리 #m-reports)
   PC 리포트 탭(#tab-rep)을 옮겨 담고, 폰 화면에 맞게 다시 배치한다. 렌더·상태는 09_reports.js · 11_repx.js 그대로.
   구조
   - 위 고정(.mrp-top): 하위 뷰 칩(#rpViewSeg 를 옮김) · 둘째 줄(기간 #rpPeriod / 산업 기간 #indPeriod /
     성적표 단위 #scMode — 뷰마다 하나) + "필터" 버튼(배지) · 걸린 필터 칩 · 부분 적재 안내(#rpLoadNote)
   - 필터 시트: PC 필터 요소(#rpFilters, 산업·시황 필터, 성적표 조건)를 시트 안으로 옮겨 쓴다.
     시트가 닫혀 있을 때는 숨은 보관함(.mrp-hold)에 둔다 — 공유 코드가 $("#id") 로 찾으므로 문서 밖으로 빼지 않는다.
   - 개요(#rpStats 패널): 한 줄 요약 버튼 → 누르면 전체 통계·기준 시각·소스 상태
   - 리포트·목표가 변경: 카드(rpCardHtml 을 이 화면이 그릴 때만 폰용 마크업으로 바꿈 — 클래스·data 속성은 같아
     09 의 카드 클릭 처리(요약 펼침·종목 이동·더 보기)를 그대로 쓴다). 산업·시황 카드는 CSS 로만 다듬는다.
   - 종목별·업종별·성적표: PC 표 대신 폰 행/카드를 그린다(rpRenderStocks·rpRenderSectors 대체, rpRenderScore 뒤에 덧그림).
   - 히트맵: 타일 탭 → 상세 시트(호버 툴팁·클릭 이동은 막는다)
   - "더 보기"는 목록 끝에 가까워지면 저절로 누른다(IntersectionObserver)
   감싸는 전역: rpRender(뒤에 화면 동기화) · rpRenderStats · rpRenderLoadNote · rpRenderScore · rpCardHtml ·
   rpRenderStocks · rpRenderSectors. 07 의 rpLazyHook 은 init 때 이 감싼 rpRender 를 다시 감싼다(순서 무관하게 동작).
   ========================================================================= */
const MRP = {
  root: null, hold: null,
  fNode: null, indNode: null, scNode: null,   // 시트에 담는 노드 (리포트 필터 · 산업·시황 필터 · 성적표 조건)
  sheet: null,
  rendering: false,                           // rpRender 안에서만 폰용 카드·행을 그린다
  lastView: null,
  rows: 0,                                    // 지금 필터에 걸린 리포트 수 (시트 "결과 보기")
  ovOpen: false,
  stSort: "n", stLim: 150,                    // 종목별 정렬 · 그리는 행 수
  secOpen: {},                                // 업종별 펼친 대분류
  scOpen: {},                                 // 성적표 펼친 카드
  io: null, ioBusy: false,
  restoreY: null
};
const MRP_LS = "gongdo-m-rp";
const MRP_VIEW_ORDER = ["reports", "changes", "stocks", "sectors", "heat", "score", "industry"];
const MRP_ST_PAGE = 150;
const MRP_CHG_LABEL = { up:"목표가 상향", down:"목표가 하향", "new":"신규 목표가" };
const MRP_ICON_FILTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const MRP_CHEV = '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

function mrpLoadPrefs(){
  try{
    var o = JSON.parse(localStorage.getItem(MRP_LS) || "null");
    if(o && ["n", "gap", "buy", "name"].indexOf(o.stSort) >= 0) MRP.stSort = o.stSort;
  }catch(e){}
}
function mrpSavePrefs(){ try{ localStorage.setItem(MRP_LS, JSON.stringify({ stSort:MRP.stSort })); }catch(e){} }
function mrpIsList(v){ return v !== "score" && v !== "industry"; }

/* ---------- 걸린 필터 (칩 · 배지) ---------- */
function mrpChips(){
  var out = [];
  if(RP.view === "industry"){
    RX.ind.kinds.forEach(function(k){ out.push([IND_KIND[k] || k, "ikind", k]); });
    if(RX.ind.cat) out.push([RX.ind.cat, "icat", ""]);
    if(RX.ind.broker) out.push([RX.ind.broker, "ibroker", ""]);
    if(RX.ind.q) out.push(["‘" + RX.ind.q + "’", "iq", ""]);
    return out;
  }
  if(RP.view === "score") return out;
  RP.codes.forEach(function(c){ var s = rpStockByCode[c]; out.push([s ? s.name : c, "code", c]); });
  if(RP.q) out.push(["‘" + RP.q + "’", "q", ""]);
  RP.ratings.forEach(function(r){ out.push([r, "rating", r]); });
  RP.changes.forEach(function(c){ out.push([MRP_CHG_LABEL[c] || c, "change", c]); });
  if(RP.suspect) out.push([RP.suspect === "hide" ? "확인 필요 숨김" : "확인 필요만", "sus", ""]);
  RP.sectors.forEach(function(s){ out.push([s, "sector", s]); });
  if(RP.industry) out.push([RP.industry, "industry", ""]);
  if(RP.brokers.length > 2) out.push(["증권사 " + RP.brokers.length + "곳", "brokers", ""]);
  else RP.brokers.forEach(function(b){ out.push([b, "broker", b]); });
  if(RP.view === "reports" && RP.sortKey === "views" && RP.sortDir === "desc") out.push(["많이 본 순", "sort", ""]);
  return out;
}
function mrpUnchip(k, v){
  var ind = k.charAt(0) === "i" && k !== "industry";
  if(ind){
    if(k === "ikind") rpToggle(RX.ind.kinds, v);
    else if(k === "icat") RX.ind.cat = "";
    else if(k === "ibroker") RX.ind.broker = "";
    else if(k === "iq") RX.ind.q = "";
    indLimit = RP_PAGE; rxSave(); rpRender(true);
    return;
  }
  if(k === "code"){ var i = RP.codes.indexOf(v); if(i >= 0) RP.codes.splice(i, 1); }
  else if(k === "q") RP.q = "";
  else if(k === "rating") rpToggle(RP.ratings, v);
  else if(k === "change") rpToggle(RP.changes, v);
  else if(k === "sus") RP.suspect = "";
  else if(k === "sector") rpToggle(RP.sectors, v);
  else if(k === "industry") RP.industry = "";
  else if(k === "brokers") RP.brokers = [];
  else if(k === "broker") rpToggle(RP.brokers, v);
  else if(k === "sort"){ RP.sortKey = "date"; RP.sortDir = "desc"; }
  if(k === "brokers" || k === "broker") rpRenderBrokerList();
  rpRender();
}
/* 시트·칩의 "초기화": 지금 뷰의 필터만 지운다 (기간은 위 줄에 있으므로 그대로 둔다) */
function mrpReset(){
  if(RP.view === "industry"){
    RX.ind.kinds = []; RX.ind.cat = ""; RX.ind.broker = ""; RX.ind.q = "";
    indLimit = RP_PAGE; rxSave(); rpRender(true);
    return;
  }
  if(RP.view === "score"){
    RX.sc.age = 30; RX.sc.minB = 10; RX.sc.minA = 5;
    rxSave(); rpRender(true);
    return;
  }
  RP.ratings = []; RP.changes = []; RP.brokers = []; RP.sectors = [];
  RP.industry = ""; RP.codes = []; RP.q = ""; RP.suspect = "";
  if(RP.sortKey === "views"){ RP.sortKey = "date"; RP.sortDir = "desc"; }
  $("#rpQ").value = ""; rpSetAc(false);
  rpRenderBrokerList(); rpRender();
}

/* ---------- 필터 시트 ---------- */
function mrpOpenSheet(){
  if(MRP.sheet) return;
  var v = RP.view, node, title;
  if(v === "score"){ node = MRP.scNode; title = "성적표 조건"; }
  else if(v === "industry"){ node = MRP.indNode; title = "산업·시황 필터"; }
  else { node = MRP.fNode; title = "리포트 필터"; }
  var sh = mSheet({ id:"rpfilter", title:title, cls:"mrp-sheet", onClose:function(){
    MRP.sheet = null;
    var dd = $("#rpBrokerDd"); if(dd) dd.open = false;
    rpSetAc(false);
    /* 시트 DOM 은 240ms 뒤 버려진다 — 그 전에 보관함으로 되돌린다 (문서 밖으로 나가면 공유 코드가 요소를 못 찾는다) */
    setTimeout(function(){ MRP.hold.appendChild(node); }, 160);
  }});
  sh.body.appendChild(node);
  MRP.sheet = sh;
  mrpTopSync();
}
function mrpSheetClick(e){
  var b = e.target.closest("[data-mrp]");
  if(!b) return;
  if(b.dataset.mrp === "reset") mrpReset();
  else if(b.dataset.mrp === "apply" && MRP.sheet) MRP.sheet.close();
}
function mrpFooter(){
  var f = document.createElement("div");
  f.className = "m-actbar";
  f.innerHTML = '<button type="button" class="m-btn" data-mrp="reset">초기화</button>' +
                '<button type="button" class="m-btn pri" data-mrp="apply"><span class="mrp-res">결과 보기</span></button>';
  return f;
}

/* ---------- 위 고정 영역 동기화 ---------- */
function mrpTopSync(){
  var v = RP.view, chips = mrpChips();
  var badge = $("#mrpBadge"), btn = $("#mrpFBtn"), act = $("#mrpAct");
  var score = v === "score";
  btn.classList.toggle("m-off", score && !rpPerfAvail());
  $(".mrp-fbl", btn).textContent = score ? (RX.sc.age + "일 · " + (RX.sc.mode === "analyst" ? RX.sc.minA : RX.sc.minB) + "건") : "필터";
  btn.setAttribute("aria-label", score ? "성적표 조건" : "필터" + (chips.length ? " " + chips.length + "개 적용됨" : ""));
  badge.textContent = chips.length;
  badge.classList.toggle("m-off", !chips.length);
  btn.classList.toggle("on", chips.length > 0);
  act.innerHTML = chips.map(function(c){
    return '<button type="button" class="mrp-chip" data-unk="' + esc(c[1]) + '" data-unv="' + esc(c[2]) + '" aria-label="' +
           esc(c[0]) + ' 필터 해제"><span>' + esc(c[0]) + '</span><i aria-hidden="true">×</i></button>';
  }).join("") + (chips.length > 1 ? '<button type="button" class="mrp-chip mrp-clr" data-unk="*">모두 지우기</button>' : "");
  act.classList.toggle("m-off", !chips.length);
  /* 시트 "결과 보기 N건" */
  var res = "결과 보기";
  if(v === "industry") res = $("#indCount").textContent + " 보기";
  else if(score) res = "닫기";
  else if(RP_READY) res = fmt(MRP.rows) + "건 보기";
  $$(".mrp-res").forEach(function(el){ el.textContent = res; });
}
/* 지금 뷰 칩을 칩 줄 가운데로 */
function mrpChipIntoView(smooth){
  var box = $("#mrpViews"), b = box && box.querySelector("button.act");
  if(!b) return;
  var x = b.offsetLeft - (box.clientWidth - b.offsetWidth) / 2;
  box.scrollTo({ left:Math.max(0, x), behavior:smooth ? "smooth" : "auto" });
}

/* ---------- rpRender 뒤 ---------- */
function mrpAfter(keep){
  var v = RP.view, root = MRP.root;
  root.setAttribute("data-v", v);
  if(v !== MRP.lastView){
    MRP.lastView = v;
    root.scrollTop = 0;
    requestAnimationFrame(function(){ mrpChipIntoView(true); });
  }else if(!keep && MRP.restoreY === null){
    root.scrollTop = 0;                       // 필터·기간이 바뀌면 목록 처음으로
  }
  if(MRP.restoreY !== null){ root.scrollTop = MRP.restoreY; MRP.restoreY = null; }
  if(!keep) MRP.stLim = MRP_ST_PAGE;
  mrpTopSync();
  mrpWatchMore();
  if(v === "heat") requestAnimationFrame(mrpHeatFit);
}
/* 히트맵: 이름이 들어가지 않는 작은 타일은 글자를 숨긴다 (타일을 누르면 시트가 이름을 보여 준다) */
function mrpHeatFit(){
  $$("#rpTmap .tile").forEach(function(t){
    var w = t.offsetWidth, h = t.offsetHeight, tn = $(".tn", t);
    var fits = tn && tn.scrollWidth <= w - 2;
    t.classList.toggle("mrp-t0", w < 34 || h < 22 || (tn && !fits));
    t.classList.toggle("mrp-t1", h < 36);
  });
}

/* ---------- "더 보기" 자동 ---------- */
function mrpWatchMore(){
  if(!window.IntersectionObserver) return;
  if(!MRP.io){
    MRP.io = new IntersectionObserver(function(ents){
      ents.forEach(function(en){
        if(!en.isIntersecting || MRP.ioBusy || M.cur !== "reports" || M.sheets.length) return;
        var b = en.target;
        if(!b.isConnected || b.offsetParent === null) return;
        MRP.ioBusy = true;
        MRP.io.unobserve(b);
        setTimeout(function(){ MRP.ioBusy = false; if(b.isConnected) b.click(); }, 60);
      });
    }, { root:MRP.root, rootMargin:"0px 0px 900px 0px" });
  }
  MRP.io.disconnect();
  ["#rpMore", "#indMore", "#mrpStMore"].forEach(function(s){ var b = $(s); if(b) MRP.io.observe(b); });
}

/* ---------- 개요 한 줄 ---------- */
function mrpOverview(rows){
  var a = rpAgg(rows), n = a.n || 1;
  MRP.rows = rows.length;
  $("#mrpOvLine").innerHTML =
    '<span class="mrp-ovs"><b>' + fmt(rows.length) + "</b>건</span>" +
    '<span class="mrp-ovs">BUY <b class="up">' + Math.round(a.BUY / n * 100) + "%</b></span>" +
    '<span class="mrp-ovs">상향 <b class="up">' + fmt(a.up) + '</b> / 하향 <b class="down">' + fmt(a.down) + "</b></span>" +
    '<span class="mrp-ovs">괴리율 중앙값 <b class="' + dirCls(a.medGap) + '">' +
      (a.medGap === null ? "-" : fmtPct(a.medGap)) + "</b></span>";
}

/* ---------- 부분 적재 안내: 한 줄로 ---------- */
function mrpLoadNote(){
  var el = $("#rpLoadNote");
  if(!el || el.classList.contains("hide")) return;
  var cnt = fmt(RPT.length) + " / " + fmt(rpTotalCount()) + "건";
  var lf = rpLoadedFloor(), from = (lf && lf !== "9999-12-31") ? lf.slice(2).replace(/-/g, ".") + " 이후 " : "";
  if(el.querySelector("#rpLoadAll")){
    var fails = Object.keys(rpMonthFail);
    el.innerHTML = '<span class="mrp-ln"><b>일부 데이터</b> · ' + from + cnt +
      (fails.length ? ' · <span class="down">' + fails.length + "개월 실패</span>" : "") + "</span>" +
      '<button class="btn xs" id="rpLoadAll">전체 불러오기</button>';
  }else if(rpLoadProg){
    el.innerHTML = '<span class="spin"></span><span class="mrp-ln">이전 리포트 불러오는 중 ' + rpLoadProg.done + "/" +
      rpLoadProg.total + "개월 · <b>일부 데이터</b> " + cnt + "</span>";
  }
}

/* ---------- 카드 (리포트 · 목표가 변경) ----------
   09 rpCardHtml 과 같은 클래스·data 속성(rcard hs open data-csum, data-go, .sum, .tg) — 클릭 처리는 09 그대로 */
function mrpCard(r, head){
  var hasSum = rpHasSum(r), open = hasSum && rpOpenSum[r.id];
  var link = r.pdf || r.url || "", hk = rpSrcHint(r);
  var tags = rpSuspectTag(r) + rpHitTag(r);
  var meta = [];
  if(r.broker) meta.push('<span class="br">' + esc(r.broker) + "</span>");
  if(r.analyst) meta.push("<span>" + esc(r.analyst) + "</span>");
  meta.push('<span class="m-num">' + esc((r.date || "").slice(5).replace("-", ".")) + "</span>");
  if(typeof r.views === "number") meta.push('<span class="m-num">조회 ' + fmt(r.views) + "</span>");
  var src = "";
  if(hk) src = '<span class="rsrc" title="' + esc(RP_SRC_HINT[hk]) + '">' + esc(RP_SRC_LABEL[hk] || hk) + "</span>";
  if(link) src += '<a class="mrp-pdf" href="' + esc(link) + '" target="_blank" rel="noopener">' + (r.pdf ? "PDF" : "원문") + "</a>";
  return '<div class="rcard mrc' + (hasSum ? " hs" : "") + (open ? " open" : "") + (r.suspect ? " sus" : "") + '"' +
         (hasSum ? ' data-csum="' + esc(r.id) + '"' : "") + ">" +
    '<div class="l1"><span class="nm">' +
      (r.code ? '<a class="tk rpgo" href="#" data-go="' + esc(r.code) + '">' + esc(rpName(r.code, r.name)) + "</a>"
              : '<span class="tk">' + esc(r.name || "") + "</span>") +
      rpBadgeOf(r) + '</span><span class="v m-num">' + head + "</span></div>" +
    '<div class="l2"><span class="rtitle">' + esc(r.title || "") + "</span></div>" +
    '<div class="l3">' + (tags ? '<span class="tags">' + tags + "</span>" : "") + meta.join('<i class="dot">·</i>') +
      '<span class="end">' + src +
      (hasSum ? '<span class="tg">' + (open ? "요약 접기" : "요약") + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.4" stroke-linecap="round"><path d="' + (open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6") + '"/></svg></span>' : "") +
      "</span></div>" +
    (open ? '<div class="sum">' + rpSumHtml(r) + "</div>" : "") +
    "</div>";
}

/* ---------- 종목별 ---------- */
function mrpGapHtml(g){
  if(g === null || g === undefined) return '<span class="flat">-</span>';
  return '<span class="' + dirCls(g) + '">' + fmtPct(g) + "</span>";
}
function mrpSortBar(items, cur, attr, extra){
  return '<div class="mrp-sort"><div class="mrp-sortl">' + items.map(function(it){
    return '<button type="button" ' + attr + '="' + it[0] + '" class="' + (it[0] === cur ? "act" : "") + '">' + esc(it[1]) + "</button>";
  }).join("") + "</div>" + (extra || "") + "</div>";
}
function mrpStocks(rows){
  var list = rpGroupByStock(rows), key = MRP.stSort;
  var get = { n:function(s){ return s.n; }, gap:function(s){ return s.gap; },
              buy:function(s){ return s.buyRatio; }, name:function(s){ return s.name; } }[key];
  list.sort(function(x, y){
    var a = get(x), b = get(y), an = a === null || a === undefined, bn = b === null || b === undefined;
    if(an !== bn) return an ? 1 : -1;
    if(!an){
      var c = key === "name" ? String(a).localeCompare(String(b), "ko") : b - a;
      if(c) return c;
    }
    return y.n - x.n;
  });
  var lim = Math.min(list.length, MRP.stLim), html = [];
  html.push(mrpSortBar([["n", "리포트 많은 순"], ["gap", "괴리율 높은 순"], ["buy", "BUY 비율"], ["name", "이름"]], key, "data-stsort"));
  if(list.length){
    html.push('<div class="mrp-list">');
    for(var i=0;i<lim;i++){
      var s = list[i];
      html.push('<div class="mrp-st" data-pick="' + esc(s.code) + '" role="button" tabindex="0">' +
        '<div class="mrp-st-l"><a class="tk" href="#" data-go="' + esc(s.code) + '">' + esc(s.name) + "</a>" +
          '<span class="mrp-sub">' + (s.industry ? esc(s.industry) + " · " : "") + "리포트 <b>" + fmt(s.n) + "</b>건 · BUY " +
          (s.buyRatio === null ? "-" : Math.round(s.buyRatio) + "%") + "</span></div>" +
        '<div class="mrp-st-r m-num"><span class="tv">' + (s.avg ? fmt(s.avg) : '<span class="flat">-</span>') + "</span>" +
          '<span class="gv">' + mrpGapHtml(s.gap) + "</span></div>" + MRP_CHEV + "</div>");
    }
    html.push("</div>");
    if(list.length > lim)
      html.push('<button type="button" class="m-morebtn mrp-more" id="mrpStMore">더 보기 · 남은 ' + fmt(list.length - lim) + "종목</button>");
    html.push('<p class="mrp-foot">오른쪽: 평균 목표가 · 현재가 대비 괴리율. 행을 누르면 그 종목 리포트, 이름을 누르면 종목 화면.</p>');
  }
  $("#mrpAlt").innerHTML = html.join("");
  return list.length;
}

/* ---------- 업종별 (대분류 아코디언) ---------- */
function mrpChgHtml(g){
  if(!g.up && !g.down) return "";
  return ' · <span class="up">▲' + fmt(g.up) + '</span> <span class="down">▼' + fmt(g.down) + "</span>";
}
function mrpSectors(rows){
  var groups = rpGroupBySector(rows).sort(function(a, b){ return b.n - a.n || a.name.localeCompare(b.name, "ko"); });
  var shown = 0, html = ['<div class="mrp-secs">'];
  groups.forEach(function(g){
    shown += g.children.length;
    var open = !!MRP.secOpen[g.name];
    html.push('<div class="mrp-sec' + (open ? " open" : "") + '">' +
      '<button type="button" class="mrp-sec-h" data-secx="' + esc(g.name) + '" aria-expanded="' + open + '">' +
        '<span class="mrp-st-l"><span class="nm">' + esc(g.name) + "</span>" +
          '<span class="mrp-sub">리포트 <b>' + fmt(g.n) + "</b> · 종목 " + fmt(g.stocks) +
          " · BUY " + (g.buyRatio === null ? "-" : Math.round(g.buyRatio) + "%") + mrpChgHtml(g) + "</span></span>" +
        '<span class="mrp-st-r m-num"><span class="gv">' + mrpGapHtml(g.gap) + '</span><span class="k">괴리율</span></span>' +
        '<svg class="m-chev mrp-acc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>');
    if(open){
      html.push('<div class="mrp-sec-b"><button type="button" class="mrp-sec-i all" data-sec="' + esc(g.sector) + '" data-ind="">' +
        '<span class="mrp-st-l"><span class="nm">' + esc(g.name) + " 리포트 전체 보기</span></span>" + MRP_CHEV + "</button>");
      g.children.sort(function(a, b){ return b.n - a.n || a.name.localeCompare(b.name, "ko"); }).forEach(function(k){
        html.push('<button type="button" class="mrp-sec-i" data-sec="' + esc(k.sector) + '" data-ind="' + esc(k.name) + '">' +
          '<span class="mrp-st-l"><span class="nm">' + esc(k.name) + "</span>" +
            '<span class="mrp-sub">리포트 ' + fmt(k.n) + " · 종목 " + fmt(k.stocks) +
            " · BUY " + (k.buyRatio === null ? "-" : Math.round(k.buyRatio) + "%") + mrpChgHtml(k) + "</span></span>" +
          '<span class="mrp-st-r m-num"><span class="gv">' + mrpGapHtml(k.gap) + "</span></span>" + MRP_CHEV + "</button>");
      });
      html.push("</div>");
    }
    html.push("</div>");
  });
  html.push("</div>");
  if(groups.length) html.push('<p class="mrp-foot">괴리율 = 리포트 목표가와 현재가의 평균 괴리율. 업종을 누르면 펼치고, 세부 업종을 누르면 그 리포트로 갑니다.</p>');
  $("#mrpAlt").innerHTML = groups.length ? html.join("") : "";
  return shown;
}

/* ---------- 성적표 카드 ---------- */
const MRP_SC_SORT = [["n", "리포트 수"], ["hitR", "도달률"], ["medRet", "수익률"], ["medGw", "괴리율"], ["medMx", "최대 상승"]];
function mrpScore(){
  var box = $("#mrpScore");
  if(!box) return;
  if(!rpPerfAvail() || !RP_PERF || $("#scTable").style.display !== "table"){ box.innerHTML = ""; return; }
  var res = scCompute(), rows = scSort(res.rows), analyst = RX.sc.mode === "analyst";
  var keys = MRP_SC_SORT.map(function(s){ return s[0]; });
  var cur = keys.indexOf(RX.sc.sortKey) >= 0 ? RX.sc.sortKey : "n";
  var arrow = RX.sc.sortDir === "asc" ? " ↑" : "";
  var html = [mrpSortBar(MRP_SC_SORT.map(function(s){ return [s[0], s[1] + (s[0] === cur ? arrow : "")]; }), cur, "data-scsort",
    '<button type="button" class="mrp-info" data-scinfo="1" aria-label="성적표 기준 보기">ⓘ</button>')];
  html.push('<div class="mrp-list">');
  rows.forEach(function(g){
    var id = g.broker + "\u0001" + g.analyst, open = !!MRP.scOpen[id];
    html.push('<div class="mrp-sc' + (open ? " open" : "") + '" data-sck="' + esc(id) + '">' +
      '<div class="mrp-sc-h"><span class="nm">' + esc(analyst ? g.analyst : g.broker) +
        (analyst ? '<span class="mrp-sub in">' + esc(g.broker) + "</span>" : "") + "</span>" +
        '<span class="mrp-sub m-num">리포트 <b>' + fmt(g.n) + "</b> · BUY " + g.buyR.toFixed(0) + "%</span>" +
        '<svg class="m-chev mrp-acc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></div>' +
      '<div class="mrp-sc-g m-num">' +
        '<div><span class="k">목표가 도달률</span><b>' + g.hitR.toFixed(1) + '%</b><span class="s">' + g.hit + " / " + g.n + "</span></div>" +
        '<div><span class="k">발간 후 수익률</span><b>' + scPct(g.medRet, true) + '</b><span class="s">중앙값</span></div>' +
        '<div><span class="k">발간 시 괴리율</span><b>' + scPct(g.medGw, true) + '</b><span class="s">중앙값</span></div>' +
      "</div>" +
      (open ? '<div class="mrp-sc-x m-num">' +
        '<div class="kv"><span>도달까지 (중앙값)</span><b>' + (g.medDays === null ? "-" : fmt(g.medDays) + "일") + "</b></div>" +
        '<div class="kv"><span>최대 상승 실현 (중앙값)</span><b>' + scPct(g.medMx, true) + "</b></div>" +
        '<div class="kv"><span>수익률 계산 표본</span><b>' + fmt(g.ret.length) + "건</b></div>" +
        '<button type="button" class="m-btn m-wide mrp-scgo" data-scgo="1">이 ' + (analyst ? "애널리스트" : "증권사") + " 리포트 보기</button></div>" : "") +
      "</div>");
  });
  html.push("</div>");
  box.innerHTML = html.join("");
}
function mrpScoreInfo(){
  var tips = SC_COLS.filter(function(c){ return c.tip; }).map(function(c){
    return "<li><b>" + esc(c.label) + "</b> — " + esc(c.tip) + "</li>";
  }).join("");
  mSheet({ id:"rpscinfo", title:"성적표 기준", cls:"mrp-sheet",
           content:'<div class="mrp-info-b"><p>' + $("#scCap").innerHTML + '</p><ul>' + tips + "</ul></div>" });
}

/* ---------- 히트맵 타일 → 시트 ---------- */
function mrpHeatSheet(code){
  var nd = rpHeatByCode[code];
  if(!nd) return;
  var gaps = [];
  rpFiltered().forEach(function(r){
    if(r.code !== code || !rpStatOk(r)) return;
    var g = rpGapOf(r);
    if(typeof g === "number") gaps.push(g);
  });
  var med = rpMedian(gaps);
  function kv(k, v){ return '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>"; }
  var html = '<div class="mrp-hs">' +
    '<div class="mrp-hs-h"><b>' + esc(nd.name || nd.code) + '</b><span class="mrp-sub">' + esc(nd.code) + " · " +
      esc((nd.sector || RP_UNCL) + (nd.industry ? " · " + nd.industry : "")) + "</span></div>" +
    '<div class="mrp-hs-g m-num">' +
      kv("리포트", fmt(nd.n) + "건") +
      kv("BUY 비율", (nd.buyRatio === null ? "-" : nd.buyRatio + "%") + ' <span class="mrp-sub in">' + nd.BUY + " / " + nd.HOLD + " / " + nd.SELL + "</span>") +
      kv("괴리율 중앙값", med === null ? "-" : mrpGapHtml(med)) +
      kv("평균 목표가", nd.avg ? fmt(nd.avg) + "원" : "-") +
      kv("현재가", nd.price ? fmt(nd.price) + "원" + (typeof nd.pct === "number" ? ' <span class="' + dirCls(nd.pct) + '">' + fmtPct(nd.pct) + "</span>" : "") : "-") +
      kv("평균 목표가 괴리율", mrpGapHtml(nd.gap)) +
    "</div>" +
    '<div class="m-actbar"><button type="button" class="m-btn" data-hgo="rep">리포트 보기</button>' +
      '<button type="button" class="m-btn pri" data-hgo="stock">종목 화면 열기</button></div></div>';
  var sh = mSheet({ id:"rpheat", title:"히트맵 종목", cls:"mrp-sheet", content:html });
  sh.body.addEventListener("click", function(e){
    var b = e.target.closest("[data-hgo]");
    if(!b) return;
    if(b.dataset.hgo === "stock"){ rpGotoAnal(code); return; }   // 시트가 열린 채 이동하면 mGo 가 시트 항목을 바꿔 쓴다
    sh.close();
    rpPickStock(code);
  });
}

/* ---------- 화면 등록 ---------- */
mScreen("reports", {
  title: "리포트",
  mount: function(root){
    MRP.root = root;
    mrpLoadPrefs();
    var tab = $("#tab-rep");

    /* 1) 위 고정 영역 */
    var top = document.createElement("div");
    top.className = "mrp-top"; top.id = "mrpTop";
    top.innerHTML =
      '<div class="mrp-views" id="mrpViews"></div>' +
      '<div class="mrp-r2"><div class="mrp-r2l" id="mrpR2"></div>' +
        '<button type="button" class="mrp-fbtn" id="mrpFBtn" aria-haspopup="dialog">' + MRP_ICON_FILTER +
        '<span class="mrp-fbl">필터</span><span class="mrp-badge m-off" id="mrpBadge"></span></button></div>' +
      '<div class="mrp-act m-off" id="mrpAct"></div>';
    root.appendChild(top);
    root.appendChild(tab);
    var hold = document.createElement("div");
    hold.className = "mrp-hold"; hold.hidden = true;
    root.appendChild(hold);
    MRP.hold = hold;

    /* 하위 뷰 칩: PC 세그먼트를 그대로 옮기고 순서만 바꾼다 (클릭·선택 표시는 09 rpBind·rpSyncControls) */
    var seg = $("#rpViewSeg");
    MRP_VIEW_ORDER.forEach(function(v){ var b = seg.querySelector('button[data-v="' + v + '"]'); if(b) seg.appendChild(b); });
    $("#mrpViews").appendChild(seg);
    /* 둘째 줄: 뷰마다 하나만 보인다 (CSS: #m-reports[data-v]) */
    var r2 = $("#mrpR2"), perRfl = $("#rpPeriod").closest(".rfl");
    r2.appendChild($("#rpPeriod"));
    r2.appendChild($("#indPeriod"));
    r2.appendChild($("#scMode"));
    perRfl.classList.add("m-off");
    top.appendChild($("#rpLoadNote"));

    /* 2) 개요: 한 줄 요약 버튼 + 펼침(통계 · 기준 시각 · 소스 상태) */
    var ov = mPanelOf("#rpStats");
    ov.classList.add("mrp-ov");
    var ovb = document.createElement("button");
    ovb.type = "button"; ovb.className = "mrp-ovb"; ovb.setAttribute("aria-expanded", "false");
    ovb.innerHTML = '<span class="mrp-ovl" id="mrpOvLine"><span class="mrp-ovs">리포트 불러오는 중…</span></span>' +
      '<svg class="m-chev mrp-acc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    ov.insertBefore(ovb, ov.firstChild);
    ov.appendChild($(".ptitle", ov));          // 기준 시각·소스 상태는 통계 아래로
    ovb.onclick = function(){
      MRP.ovOpen = !MRP.ovOpen;
      ov.classList.toggle("open", MRP.ovOpen);
      ovb.setAttribute("aria-expanded", MRP.ovOpen ? "true" : "false");
    };

    /* 3) 리포트 필터 시트 내용: PC 필터 본문을 그대로 옮긴다 (검색을 맨 위, 고른 종목 칩은 검색 아래) */
    var fn = document.createElement("div");
    fn.className = "mrp-fs";
    hold.appendChild(fn);                      // 먼저 문서(보관함)에 붙여 둔다 — 아래 $("#…") 가 찾을 수 있게
    var filters = $("#rpFilters");
    fn.appendChild(filters);
    var srchRfl = $("#rpSrch").closest(".rfl");
    filters.firstElementChild.insertBefore(srchRfl, filters.firstElementChild.firstChild);
    srchRfl.classList.add("mrp-wide");
    srchRfl.appendChild($("#rpSelbar"));
    $(".k", srchRfl).textContent = "종목 · 증권사 · 제목 검색";
    $("#rpQ").setAttribute("enterkeyhint", "search");
    var chgK = $("[data-rchange]").closest(".rfl");
    if(chgK) $(".k", chgK).textContent = "목표가 변경";
    fn.appendChild(mrpFooter());
    fn.addEventListener("click", mrpSheetClick);
    MRP.fNode = fn;

    /* 산업·시황 필터 시트 */
    var inode = document.createElement("div");
    inode.className = "mrp-fs";
    var irow = document.createElement("div");
    irow.className = "row";
    ["#indKinds", "#indCat", "#indBroker", "#indQ"].forEach(function(s){ irow.appendChild($(s).closest(".rfl")); });
    inode.appendChild(irow);
    inode.appendChild(mrpFooter());
    inode.addEventListener("click", mrpSheetClick);
    hold.appendChild(inode);
    MRP.indNode = inode;

    /* 성적표 조건 시트 (단위 전환은 위 둘째 줄) */
    var snode = document.createElement("div");
    snode.className = "mrp-fs";
    var srow = document.createElement("div");
    srow.className = "row";
    srow.appendChild($("#scAge").closest(".rfl"));
    srow.appendChild($("#scMin").closest(".rfl"));
    snode.appendChild(srow);
    snode.appendChild(mrpFooter());
    snode.addEventListener("click", mrpSheetClick);
    hold.appendChild(snode);
    MRP.scNode = snode;
    $("#scMin").setAttribute("inputmode", "numeric");

    /* 4) 종목별·업종별 / 성적표 카드를 담을 자리 */
    var alt = document.createElement("div");
    alt.id = "mrpAlt"; alt.className = "mrp-alt";
    $("#rpTablePanel").insertBefore(alt, $("#rpEmpty"));
    var scb = document.createElement("div");
    scb.id = "mrpScore"; scb.className = "mrp-alt";
    $("#rpScorePanel").appendChild(scb);

    /* 5) 이벤트 */
    $("#mrpFBtn").onclick = mrpOpenSheet;
    $("#mrpAct").onclick = function(e){
      var b = e.target.closest("[data-unk]"); if(!b) return;
      if(b.dataset.unk === "*") mrpReset(); else mrpUnchip(b.dataset.unk, b.dataset.unv);
    };
    alt.addEventListener("click", function(e){
      var go = e.target.closest("[data-go]");
      if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); return; }
      var ss = e.target.closest("[data-stsort]");
      if(ss){ MRP.stSort = ss.dataset.stsort; mrpSavePrefs(); MRP.stLim = MRP_ST_PAGE; rpRender(true); MRP.root.scrollTop = 0; return; }
      if(e.target.closest("#mrpStMore")){ MRP.stLim += MRP_ST_PAGE; rpRender(true); return; }
      var pk = e.target.closest("[data-pick]");
      if(pk){ rpPickStock(pk.dataset.pick); return; }
      var sx = e.target.closest("[data-secx]");
      if(sx){
        var k = sx.dataset.secx;
        if(MRP.secOpen[k]) delete MRP.secOpen[k]; else MRP.secOpen[k] = true;
        rpRender(true);
        return;
      }
      var si = e.target.closest("[data-sec]");
      if(si) rpGotoSector(si.dataset.sec, si.dataset.ind);
    });
    scb.addEventListener("click", function(e){
      var so = e.target.closest("[data-scsort]");
      if(so){
        var key = so.dataset.scsort;
        if(RX.sc.sortKey === key) RX.sc.sortDir = RX.sc.sortDir === "asc" ? "desc" : "asc";
        else { RX.sc.sortKey = key; RX.sc.sortDir = "desc"; }
        rxSave(); rpRender(true);
        return;
      }
      if(e.target.closest("[data-scinfo]")){ mrpScoreInfo(); return; }
      var card = e.target.closest("[data-sck]");
      if(!card) return;
      var parts = card.dataset.sck.split("\u0001");
      if(e.target.closest("[data-scgo]")){
        RP.brokers = [parts[0]]; RP.q = parts[1] || ""; RP.codes = [];
        RP.period = "all"; RP.view = "reports"; RP.sortKey = "date"; RP.sortDir = "desc";
        rpRenderBrokerList(); rpRender();
        return;
      }
      var id = card.dataset.sck;
      if(MRP.scOpen[id]) delete MRP.scOpen[id]; else MRP.scOpen[id] = true;
      rpRender(true);
    });
    /* 히트맵: 호버 툴팁·클릭 이동(09) 대신 상세 시트 — 캡처 단계에서 가로챈다 */
    var hp = $("#rpHeatPanel");
    hp.addEventListener("click", function(e){
      var t = e.target.closest(".tile"); if(!t) return;
      e.stopPropagation(); e.preventDefault();
      mrpHeatSheet(t.dataset.rp);
    }, true);
    ["mousemove", "mouseover"].forEach(function(ev){
      hp.addEventListener(ev, function(e){ if(e.target.closest("#rpTmap")) e.stopPropagation(); }, true);
    });

    /* 6) 공유 렌더 감싸기 */
    var renderBase = rpRender;
    rpRender = function(keepLimit){
      MRP.rendering = true;
      var r;
      try{ r = renderBase.apply(this, arguments); }
      finally{ MRP.rendering = false; }
      try{ mrpAfter(keepLimit); }catch(err){ console.error("[m] reports", err); }
      return r;
    };
    var cardBase = rpCardHtml;
    rpCardHtml = function(r, head){ return MRP.rendering ? mrpCard(r, head) : cardBase.apply(this, arguments); };
    var stocksBase = rpRenderStocks;
    rpRenderStocks = function(rows){ return MRP.rendering ? mrpStocks(rows) : stocksBase.apply(this, arguments); };
    var secBase = rpRenderSectors;
    rpRenderSectors = function(rows){ return MRP.rendering ? mrpSectors(rows) : secBase.apply(this, arguments); };
    var statsBase = rpRenderStats;
    rpRenderStats = function(rows){ var r = statsBase.apply(this, arguments); mrpOverview(rows); return r; };
    var noteBase = rpRenderLoadNote;
    rpRenderLoadNote = function(){ var r = noteBase.apply(this, arguments); mrpLoadNote(); return r; };
    var scoreBase = rpRenderScore;
    rpRenderScore = function(){ var r = scoreBase.apply(this, arguments); mrpScore(); return r; };
  },
  show: function(params, prev){
    if(prev && prev !== "reports" && MRP.lastY !== undefined) MRP.restoreY = MRP.lastY;
    mDesk("rep");
  },
  hide: function(){
    MRP.lastY = MRP.root.scrollTop;
  },
  refresh: function(){
    if(typeof rpCheckUpdate === "function") return rpCheckUpdate();
  },
  reselect: function(){
    MRP.restoreY = null;                       // 돌아올 때 복원할 위치가 남아 있으면 다음 rpRender 가 아래로 되돌린다
    mScrollTop(MRP.root);
    return true;
  }
});
