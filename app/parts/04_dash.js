/* =========================================================================
   시세 갱신 / 대시보드
   ========================================================================= */
let refreshing = false;

function trackedItems(){
  var map = {};
  WL().forEach(function(w){ map[keyOf(w.mk, w.code)] = w; });
  S.portfolio.forEach(function(p){ map[keyOf(p.mk, p.code)] = p; });
  S.alerts.forEach(function(a){ if(a.on) map[keyOf(a.mk, a.code)] = a; });
  if(AN.sel) map[keyOf(AN.sel.mk, AN.sel.code)] = AN.sel;
  return Object.keys(map).map(function(k){ return map[k]; });
}

function refreshAll(){
  if(refreshing) return Promise.resolve();
  refreshing = true;
  $("#btnRefresh").disabled = true;

  var tracked = trackedItems();
  var krCodes = tracked.map(function(t){ return t.code; });
  /* 리포트 탭이 열려 있으면 화면에 보이는 종목 시세도 같은 요청에 얹는다 (타이머 중복 없음) */
  var seen = {};
  krCodes.forEach(function(c){ seen[c] = 1; });
  rpQuoteCodes().forEach(function(c){ if(!seen[c]){ seen[c] = 1; krCodes.push(c); } });
  var jobs = [];

  var chunks = [];
  for(var i=0;i<krCodes.length;i+=40) chunks.push(krCodes.slice(i, i+40));
  if(!chunks.length) chunks.push([]);
  chunks.forEach(function(ch, idx){
    jobs.push(naverRealtime(ch, idx === 0).then(function(r){
      noteOk();
      Object.keys(r.items).forEach(function(cd){ QUOTES[keyOf("KR", cd)] = krQuote(r.items[cd]); });
      if(idx === 0) renderIndex(r.index);
    }).catch(function(e){
      noteFail();
      ch.forEach(function(c){ if(QUOTES["KR:"+c]) QUOTES["KR:"+c].ok = false; });
      console.warn("국내 시세 갱신 실패:", e.message);
    }));
  });


  return Promise.all(jobs).then(function(){
    $("#upd").textContent = "갱신 " + nowTime();
    renderWatchlist(); renderPortfolio(); renderMarket();
    if(AN.sel) renderAnalysisHead();
    if(curTab === "rep") rpRenderKeep();       // 리포트 표의 현재가·괴리율 갱신
    evalAlerts(); loadSparklines();
    if(curTab === "dash" && TMAP_LOADED) loadTreemap(true);
  }).catch(function(e){ console.warn("갱신 중 오류", e); })
    .then(function(){ refreshing = false; $("#btnRefresh").disabled = false; });
}

/* 관심종목 이력 로드 — 스파크라인 + 1주/1개월 수익률이 같은 데이터를 쓴다(추가 호출 없음) */
let sparkLoading = false;
function loadSparklines(){
  if(sparkLoading) return;
  var need = WL().filter(function(w){ return !HIST[w.code]; });
  if(!need.length) return;
  sparkLoading = true;
  var seq = Promise.resolve();
  need.slice(0,15).forEach(function(w){
    seq = seq.then(function(){
      return loadHist(w.code, 3).then(function(){ renderWatchlist(); })
        .catch(function(){ HIST[w.code] = { bars:[], months:3, at:Date.now() }; });
    });
  });
  seq.then(function(){ sparkLoading = false; });
}

/* ---------- 헤더 / 시장 개요 ---------- */
function renderIndex(idx){
  [["KOSPI","#tKospi","#tKospiC","#ovKospi","#ovKospiC"],
   ["KOSDAQ","#tKosdaq","#tKosdaqC","#ovKosdaq","#ovKosdaqC"]].forEach(function(a){
    var d = idx && idx[a[0]];
    if(!d) return;
    var down = (d.rf === "5" || d.rf === "4");
    var v = d.nv/100;                                   // 지수는 100배 스케일
    var cv = down ? -Math.abs(d.cv/100) : d.cv/100;
    var cr = down ? -Math.abs(d.cr) : d.cr;
    var cls = dirCls(cr), txt = fmtSigned(cv, 2) + " (" + fmtPct(cr) + ")";
    $(a[1]).textContent = v.toFixed(2); $(a[1]).className = cls;
    $(a[2]).textContent = txt;          $(a[2]).className = "num " + cls;
    $(a[3]).textContent = v.toFixed(2); $(a[3]).className = "v " + cls;
    $(a[4]).textContent = txt;          $(a[4]).className = "c num " + cls;
  });
}
function renderMarket(){
  var m = marketOpen();
  $("#mkKr").className = "mkb" + (m.kr ? " open" : "");
  $("#mkKr").textContent = "국내장 " + (m.kr ? "개장" : "마감");
}

/* 상승/하락 게이지 — 스캔 캐시 기반 */
function renderGauge(){
  if(!SCREEN.length){
    $("#gUp").textContent = "상승 -"; $("#gDn").textContent = "하락 -"; $("#gFlat").textContent = "보합 -";
    $("#gBarU").style.width = "0"; $("#gBarD").style.width = "0"; $("#gBarF").style.width = "100%";
    $("#gNote").textContent = "스크리너 탭에서 전체 스캔을 실행하면 표시됩니다.";
    return;
  }
  var rows = SCREEN.filter(statFilter);
  if(!rows.length){ rows = SCREEN; }
  var u = 0, d = 0, f = 0;
  rows.forEach(function(q){ if(q.pct > 0) u++; else if(q.pct < 0) d++; else f++; });
  var t = rows.length, pu = u/t*100, pd = d/t*100, pf = f/t*100;
  $("#gUp").textContent = "상승 " + u + " (" + pu.toFixed(0) + "%)";
  $("#gDn").textContent = "하락 " + d + " (" + pd.toFixed(0) + "%)";
  $("#gFlat").textContent = "보합 " + f;
  $("#gBarU").style.width = pu + "%";
  $("#gBarF").style.width = pf + "%";
  $("#gBarD").style.width = pd + "%";
  $("#gNote").textContent = (SCAN_LABEL || (t + "종목 기준")) + " · " + statScopeTag() +
    " " + fmt(t) + "종목 · 스캔 " + (SCAN_AT || "-");
}

/* ---------- 시그널 패널 ---------- */
function renderSignals(){
  $$(".sigscope").forEach(function(e){ e.textContent = SCREEN.length ? statScopeTag() : ""; });
  [["#sigUp","cr",-1],["#sigDn","cr",1],["#sigAmt","aa",-1]].forEach(function(b){
    var tb = $(b[0]);
    if(!SCREEN.length){
      tb.innerHTML = '<tr><td class="l" style="color:var(--tx3);padding:10px 8px">스크리너 전체 스캔 후 표시됩니다.</td></tr>';
      return;
    }
    var key = b[1], dir = b[2];
    var list = SCREEN.filter(statFilter).sort(function(x, y){
      var xv = key === "cr" ? x.pct : x.amt, yv = key === "cr" ? y.pct : y.amt;
      return (xv - yv) * dir;
    }).slice(0, 12);
    tb.innerHTML = list.map(function(q){
      return '<tr class="clk" data-cd="' + q.code + '">' +
        '<td class="l"><span class="tk" data-hv="' + esc(q.code) + '">' + esc(q.name) + '</span></td>' +
        '<td class="num">' + fmt(q.price) + '</td>' +
        '<td class="num ' + dirCls(q.pct) + '">' + fmtPct(q.pct) + '</td>' +
        '<td class="num" style="color:var(--tx3)">' + fmtBig(key === "aa" ? q.amt : q.vol) + '</td></tr>';
    }).join("");
  });
}
function onSignalClick(e){
  var tr = e.target.closest("tr[data-cd]");
  if(!tr) return;
  var cd = tr.dataset.cd, u = UNI_BY_KEY["KR:" + cd];
  selectStock({ mk:"KR", code:cd, name:(u ? u.name : cd) });
  showTab("anal");
}

/* =========================================================================
   트리맵 (squarified) — 대시보드와 스크리너 결과 뷰가 공유
   ========================================================================= */
function squarify(items, X, Y, W, H){
  var out = [], x = X, y = Y, w = W, h = H;
  var total = items.reduce(function(s, i){ return s + i.value; }, 0);
  if(total <= 0 || w <= 0 || h <= 0) return out;
  var scale = (w*h)/total;
  var rest = items.map(function(i){ return { ref:i.ref, area:i.value*scale }; });
  function worst(row, rowArea, side){
    if(!row.length) return Infinity;
    var mx = -Infinity, mn = Infinity;
    row.forEach(function(r){ if(r.area > mx) mx = r.area; if(r.area < mn) mn = r.area; });
    var s2 = side*side, a2 = rowArea*rowArea;
    return Math.max(s2*mx/a2, a2/(s2*mn));
  }
  while(rest.length && w > 0.5 && h > 0.5){
    var side = Math.min(w, h);
    var row = [], rowArea = 0, best = Infinity;
    while(rest.length){
      var na = rowArea + rest[0].area;
      var r = worst(row.concat([rest[0]]), na, side);
      if(!row.length || r <= best){ best = r; row.push(rest.shift()); rowArea = na; }
      else break;
    }
    var thick = rowArea/side, off = 0;
    row.forEach(function(it){
      var len = it.area/thick;
      if(w >= h) out.push({ ref:it.ref, x:x, y:y+off, w:thick, h:len });
      else       out.push({ ref:it.ref, x:x+off, y:y, w:len, h:thick });
      off += len;
    });
    if(w >= h){ x += thick; w -= thick; } else { y += thick; h -= thick; }
  }
  return out;
}

/* 등락률 -> 히트맵 색 (기본 ±3% 포화, 기간 모드에 따라 스케일 조정) */
function heatColor(pct, scale){
  var mid = hex2rgb(cssVar("--heat-mid"));
  if(pct === null || pct === undefined || isNaN(pct)) return rgb2css(mid);
  var t = Math.max(-1, Math.min(1, pct/(scale || 3)));
  var end = hex2rgb(cssVar(t >= 0 ? "--heat-up" : "--heat-down"));
  var a = Math.abs(t);
  return rgb2css([0,1,2].map(function(i){ return Math.round(mid[i] + (end[i]-mid[i])*a); }));
}
function hex2rgb(h){
  h = (h||"#414554").replace("#","");
  if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  var n = parseInt(h, 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function rgb2css(a){ return "rgb(" + a[0] + "," + a[1] + "," + a[2] + ")"; }

/* nodes: [{code,name,cap,pct}] — cap 비례 타일, 업종(sector)별 구획 */
function renderTreemapInto(box, nodes, scale){
  var W = box.clientWidth, H = box.clientHeight;
  box.innerHTML = "";
  if(!W || !H) return 0;
  nodes = nodes.filter(function(n){ return n.cap > 0; });
  if(!nodes.length){
    box.innerHTML = '<div class="empty" style="padding:24px">표시할 데이터가 없습니다.</div>';
    return 0;
  }
  var bySec = {};
  nodes.forEach(function(n){ (bySec[n.sector || "기타"] = bySec[n.sector || "기타"] || []).push(n); });
  var secs = Object.keys(bySec).map(function(name){
    return { ref:name, value:bySec[name].reduce(function(s, i){ return s + i.cap; }, 0) };
  }).sort(function(a, b){ return b.value - a.value; });

  var tiles = 0;
  squarify(secs, 0, 0, W, H).forEach(function(sr){
    var sd = document.createElement("div");
    sd.className = "tsec";
    sd.style.cssText = "left:" + sr.x + "px;top:" + sr.y + "px;width:" + sr.w + "px;height:" + sr.h + "px";
    var showLabel = sr.h > 34 && sr.w > 54;
    if(showLabel){
      var lb = document.createElement("div");
      lb.className = "sl"; lb.textContent = sr.ref;
      sd.appendChild(lb);
    }
    var pad = showLabel ? 13 : 0;
    var list = bySec[sr.ref].slice().sort(function(a, b){ return b.cap - a.cap; })
      .map(function(n){ return { ref:n, value:n.cap }; });
    squarify(list, 0, pad, sr.w, Math.max(0, sr.h - pad)).forEach(function(t){
      var n = t.ref;
      var el = document.createElement("div");
      el.className = "tile";
      el.style.cssText = "left:" + t.x + "px;top:" + t.y + "px;width:" + t.w + "px;height:" + t.h +
                         "px;background:" + heatColor(n.pct, scale);
      el.dataset.cd = n.code;
      if(t.w > 30 && t.h > 16){
        var big = t.w > 62 && t.h > 32;
        var nm = document.createElement("div");
        nm.className = "tn";
        nm.style.fontSize = (big ? 11 : 9) + "px";
        nm.textContent = n.name;
        el.appendChild(nm);
        if(n.pct !== null && n.pct !== undefined && t.h > 26){
          var pc = document.createElement("div");
          pc.className = "tp";
          pc.style.fontSize = (big ? 10.5 : 8.5) + "px";
          pc.textContent = fmtPct(n.pct);
          el.appendChild(pc);
        }
      }
      sd.appendChild(el);
      tiles++;
    });
    box.appendChild(sd);
  });
  box.dataset.tiles = tiles;
  return tiles;
}

/* 트리맵 기간: 1d = 벌크 시세 등락률, 1w/1m = 150종목 이력 온디맨드 */
let tmapPeriod = "1d";
const TMAP_SCALE = { "1d":3, "1w":8, "1m":15 };     // 색 포화 기준(%)

function tmapPct(code){
  if(tmapPeriod === "1d"){
    var q = QUOTES["KR:" + code];
    return q ? q.pct : null;
  }
  var b = (HIST[code] || {}).bars;
  return perfDays(b, tmapPeriod === "1w" ? 5 : 21);
}
function setTmapPeriod(p){
  tmapPeriod = p;
  $$("#segTmap button").forEach(function(b){ b.classList.toggle("act", b.dataset.p === p); });
  var s = TMAP_SCALE[p];
  $("#lgMin").textContent = "-" + s + "%";
  $("#lgMax").textContent = "+" + s + "%";
  renderLegend();
  if(p === "1d"){ renderTreemap(); return; }
  var need = topCaps(150).filter(function(u){ return !HIST[u.code]; });
  if(!need.length){ renderTreemap(); return; }
  /* 150종목 이력 순차 로드 — JSONP 큐가 150ms 간격을 보장하므로 약 1분 소요 */
  $("#tmapProg").classList.remove("hide");
  $("#tmapSub").textContent = "이력 0/" + need.length;
  var done = 0, seq = Promise.resolve();
  need.forEach(function(u){
    seq = seq.then(function(){
      if(tmapPeriod === "1d") return;                 // 중간에 1일로 돌아가면 중단
      return loadHist(u.code, 3).catch(function(){
        HIST[u.code] = { bars:[], months:3, at:Date.now() };
      }).then(function(){
        done++;
        $("#tmapBar").style.width = Math.round(done/need.length*100) + "%";
        $("#tmapSub").textContent = "이력 " + done + "/" + need.length;
        if(done % 15 === 0) renderTreemap();
      });
    });
  });
  seq.then(function(){
    $("#tmapProg").classList.add("hide");
    $("#tmapBar").style.width = "0";
    $("#tmapSub").textContent = nowTime();
    renderTreemap();
  });
}

function loadTreemap(silent){
  var codes = topCaps(150).map(function(u){ return u.code; });
  var chunks = [];
  for(var i=0;i<codes.length;i+=40) chunks.push(codes.slice(i, i+40));
  if(!silent) $("#tmapSub").textContent = "불러오는 중…";
  var seq = Promise.resolve(), failed = 0;
  chunks.forEach(function(ch){
    seq = seq.then(function(){
      return naverRealtime(ch, false).then(function(r){
        noteOk();
        Object.keys(r.items).forEach(function(cd){ QUOTES["KR:" + cd] = krQuote(r.items[cd]); });
      }).catch(function(e){ failed++; console.warn("트리맵 청크 실패:", e.message); });
    });
  });
  return seq.then(function(){
    TMAP_LOADED = true;
    renderTreemap();
    $("#tmapSub").textContent = (failed ? "일부 실패 · " : "") + nowTime();
  });
}
function renderTreemap(){
  var nodes = topCaps(150).map(function(u){
    return { code:u.code, name:u.name, cap:u.cap, sector:u.sector, pct:tmapPct(u.code) };
  });
  renderTreemapInto($("#tmap"), nodes, TMAP_SCALE[tmapPeriod]);
}

/* 트리맵 호버/클릭 (대시보드 + 스크리너 공용) */
function initTmapEvents(box){
  var tip = $("#ttip");
  function row(k, v){ return '<div class="r"><span>' + k + '</span><span>' + v + '</span></div>'; }
  box.addEventListener("mousemove", function(e){
    var el = e.target.closest(".tile");
    if(!el){ tip.style.display = "none"; return; }
    var u = UNI_BY_KEY["KR:" + el.dataset.cd], q = QUOTES["KR:" + el.dataset.cd];
    if(!u){ tip.style.display = "none"; return; }
    tip.innerHTML = "<b>" + esc(u.name) + " <span style='color:var(--tx3);font-weight:400'>" + u.code + "</span></b>" +
      row("업종", esc(u.industry)) +
      (q ? row("현재가", fmt(q.price)) +
           row("등락", '<span class="' + dirCls(q.pct) + '">' + fmtSigned(q.chg) + " (" + fmtPct(q.pct) + ")</span>") +
           row("거래대금", fmtBig(q.amt)) : row("시세", "없음")) +
      row("시가총액", fmt(u.cap) + "억");
    tip.style.display = "block";
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = e.clientX + 14, y = e.clientY + 14;
    if(x + tw > window.innerWidth - 6) x = e.clientX - tw - 14;
    if(y + th > window.innerHeight - 6) y = e.clientY - th - 14;
    tip.style.left = Math.max(4, x) + "px";
    tip.style.top = Math.max(4, y) + "px";
  });
  box.addEventListener("mouseleave", function(){ tip.style.display = "none"; });
  box.addEventListener("click", function(e){
    var el = e.target.closest(".tile");
    if(!el) return;
    var u = UNI_BY_KEY["KR:" + el.dataset.cd];
    if(!u) return;
    tip.style.display = "none";
    selectStock({ mk:"KR", code:u.code, name:u.name });
    showTab("anal");
  });
}

/* ---------- 업종별 퍼포먼스 (스캔 캐시 재활용, 추가 호출 없음) ---------- */
function renderSectorPerf(){
  var box = $("#secPerf");
  if(!SCREEN.length){
    $("#secSub").textContent = "";
    box.innerHTML = '<div style="color:var(--tx3);font-size:11.5px">스크리너에서 전체 스캔을 실행하면 표시됩니다.</div>';
    return;
  }
  var by = {}, srows = SCREEN.filter(statFilter);
  srows.forEach(function(q){
    var s = q.sector || "기타";
    var g = by[s] || (by[s] = { cap:0, wsum:0, n:0, up:0 });
    var w = q.capW || 0;
    g.cap += w; g.wsum += w*(q.pct||0); g.n++;
    if(q.pct > 0) g.up++;
  });
  var rows = Object.keys(by).map(function(s){
    var g = by[s];
    return { s:s, pct:(g.cap > 0 ? g.wsum/g.cap : 0), n:g.n, up:g.up };
  }).sort(function(a,b){ return b.pct - a.pct; });

  var mx = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.pct); })) || 1;
  $("#secSub").textContent = rows.length + "개 업종 · " + statScopeTag() + " " + fmt(srows.length) + "종목";
  box.innerHTML = rows.map(function(r){
    var half = Math.min(50, Math.abs(r.pct)/mx*50);
    var bar = r.pct >= 0
      ? '<i style="left:50%;width:' + half + '%;background:var(--up-bg)"></i>'
      : '<i style="right:50%;width:' + half + '%;background:var(--down-bg)"></i>';
    return '<div class="secrow" data-sec="' + esc(r.s) + '">' +
      '<div class="sn">' + esc(r.s) + '</div>' +
      '<div class="secbar">' + bar + '<span class="mid"></span></div>' +
      '<div class="sv ' + dirCls(r.pct) + '">' + fmtPct(r.pct) + '</div>' +
      '<div class="sr">상승 ' + r.up + '/' + r.n + ' (' + Math.round(r.up/r.n*100) + '%)</div></div>';
  }).join("");
}

/* ---------- 시장 뉴스 ---------- */
const MKT_Q = "코스피 OR 증시";
function renderMarketNews(force){
  var box = $("#mktNews"), sub = $("#mnSub");
  if(!RSS.cache["mkt"]) box.innerHTML = '<div style="color:var(--tx3)">불러오는 중…</div>';
  RSS.get("mkt", gnewsRss(MKT_Q), force).then(function(r){
    box.innerHTML = newsListHtml(r.items, 10);
    sub.innerHTML = (r.stale ? '<span class="stalebadge">갱신 실패 · 이전 결과</span> ' : "") +
                    (r.cached && !r.stale ? "캐시 · " : "") + new Date(r.at).toLocaleTimeString("ko-KR", {hour12:false});
  }).catch(function(e){
    sub.innerHTML = '<span class="stalebadge">불러오기 실패</span>';
    box.innerHTML = '<div class="note">뉴스를 불러오지 못했습니다 (' + esc(e.message) + ').<br>' +
      '<a href="' + gnewsLink(MKT_Q) + '" target="_blank" rel="noopener">구글 뉴스에서 “' + esc(MKT_Q) + '” 검색 →</a></div>';
  });
}

/* ---------- 최근 공시 (DART) ---------- */
let dcFilter = "";                                   // "" | stake | earn | major | etc
function renderDcTypes(counts){
  var all = counts ? counts.all : 0;
  $("#dcTypes").innerHTML =
    '<button data-t=""' + (dcFilter === "" ? ' class="act"' : "") + '>전체 ' + all + '</button>' +
    DC_TYPES.concat([{ k:"etc", t:"기타" }]).map(function(g){
      var n = counts ? (counts[g.k] || 0) : 0;
      return '<button data-t="' + g.k + '"' + (dcFilter === g.k ? ' class="act"' : "") + '>' +
             g.t + ' ' + n + '</button>';
    }).join("");
}
function renderDisclosures(force){
  var tb = $("#dcBody"), em = $("#dcEmpty"), sub = $("#dcSub");
  RSS.get("dart", DART_RSS, force).then(function(r){
    var mine = $("#dcMine").checked, names = myNames();
    var rows = r.items.map(parseDart);
    var isMine = function(d){
      return names.some(function(n){ return d.comp.indexOf(n) >= 0 || d.rpt.indexOf(n) >= 0; });
    };
    var counts = { all:rows.length };
    rows.forEach(function(d){ counts[d.type] = (counts[d.type] || 0) + 1; });
    renderDcTypes(counts);

    var list = rows;
    if(mine) list = list.filter(isMine);
    if(dcFilter) list = list.filter(function(d){ return d.type === dcFilter; });

    sub.innerHTML = (r.stale ? '<span class="stalebadge">갱신 실패 · 이전 결과</span> ' : "") +
      rows.length + "건" + (mine || dcFilter ? " 중 " + list.length + "건" : "") +
      " · " + new Date(r.at).toLocaleTimeString("ko-KR", {hour12:false}) +
      (RSS.mode() === "rss2json" ? ' <span style="color:var(--tx3)">(rss2json 10건 제한)</span>' : "");
    tb.innerHTML = list.slice(0, 60).map(function(d){
      return '<tr' + (isMine(d) ? ' class="mine"' : "") + '>' +
        '<td class="l" style="color:var(--tx3);width:52px">' + esc(relTime(d.at)) + '</td>' +
        '<td class="l"><span class="tk">' + esc(d.comp || "-") + '</span></td>' +
        '<td class="l"><a href="' + esc(d.link) + '" target="_blank" rel="noopener">' + esc(d.rpt) + '</a></td></tr>';
    }).join("");
    em.style.display = list.length ? "none" : "block";
    em.innerHTML = rows.length
      ? "조건에 맞는 공시가 없습니다."
      : "오늘 접수된 공시가 없습니다. DART는 <b>당일 공시만</b> 제공하므로 주말·공휴일·장 시작 전에는 비어 있을 수 있습니다.";
  }).catch(function(e){
    sub.innerHTML = '<span class="stalebadge">불러오기 실패</span>';
    tb.innerHTML = "";
    em.style.display = "block";
    em.innerHTML = '공시를 불러오지 못했습니다 (' + esc(e.message) + ').<br>' +
      '<a href="https://dart.fss.or.kr" target="_blank" rel="noopener">DART 바로가기 →</a>';
  });
}

function renderTmScope(){
  $$(".tmscope").forEach(function(e){ e.textContent = statScopeTag(); });
}

/* ---------- 관심종목 (그룹 탭 + 기간 수익률) ---------- */
function renderWlTabs(){
  $("#wlTabs").innerHTML = (S.wlGroups||[]).map(function(g, i){
    return '<button data-g="' + i + '"' + (i === S.wlActive ? ' class="act"' : "") + '>' +
           esc(g.name) + ' <span style="opacity:.6">' + (g.items||[]).length + '</span></button>';
  }).join("");
}
function renderWatchlist(){
  var tb = $("#wlBody"); tb.innerHTML = "";
  var wl = WL();
  renderWlTabs();
  $("#wlCnt").textContent = wl.length + "종목";
  $("#wlEmpty").style.display = wl.length ? "none" : "block";
  wl.forEach(function(w, i){
    var k = keyOf(w.mk, w.code), q = QUOTES[k], u = UNI_BY_KEY[k];
    var tr = document.createElement("tr");
    tr.className = "clk";
    var tag = '<span class="mk">' + (u ? u.market : "KR") + "</span>";
    var stale = (q && !q.ok) ? '<span class="badge-err">갱신실패</span>' : "";
    var bars = (HIST[w.code] || {}).bars;
    var pw = perfDays(bars, 5), pm = perfDays(bars, 21);   // 5거래일 ≈ 1주, 21거래일 ≈ 1개월
    var pcell = function(v){
      return '<td class="num ' + dirCls(v) + '">' + (v === null ? "-" : fmtPct(v)) + '</td>';
    };
    if(!q){
      tr.innerHTML = '<td class="l">' + tag + '<span class="tk" data-hv="' + esc(w.code) + '">' + esc(w.name) + '</span></td>' +
        '<td colspan="6" class="c" style="color:var(--tx3)">불러오는 중…</td><td class="c">-</td>';
    }else{
      tr.innerHTML =
        '<td class="l">' + tag + '<span class="tk" data-hv="' + esc(w.code) + '">' + esc(q.name) + '</span>' + stale + '</td>' +
        '<td class="num">' + fmtPrice(q.price, w.mk) + '</td>' +
        '<td class="num ' + dirCls(q.chg) + '">' + fmtSigned(q.chg) + '</td>' +
        '<td class="num ' + dirCls(q.pct) + '">' + fmtPct(q.pct) + '</td>' +
        pcell(pw) + pcell(pm) +
        '<td class="num" style="color:var(--tx3)">' + fmtBig(q.vol) + '</td>' +
        '<td class="c"><canvas class="spk" width="180" height="28" style="width:90px;height:20px"></canvas></td>';
    }
    var del = document.createElement("td");
    del.className = "c";
    del.innerHTML = '<button class="btn xs">×</button>';
    del.firstChild.onclick = function(ev){ ev.stopPropagation(); WL().splice(i,1); save(); renderWatchlist(); };
    tr.appendChild(del);
    tr.onclick = function(){ selectStock({ mk:w.mk, code:w.code, name:w.name }); showTab("anal"); };
    tb.appendChild(tr);
    var cv = tr.querySelector("canvas.spk");
    if(cv) drawSpark(cv, (bars || []).slice(-30).map(function(b){ return b.c; }), q && q.pct);
  });
}
function drawSpark(cv, data, pct){
  var ctx = cv.getContext("2d");
  ctx.clearRect(0,0,cv.width,cv.height);
  if(!data || data.length < 2){
    ctx.fillStyle = cssVar("--tx3"); ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(data ? "-" : "…", cv.width/2, cv.height/2 + 3);
    return;
  }
  var mn = Math.min.apply(null, data), mx = Math.max.apply(null, data);
  var rg = (mx - mn) || 1, pad = 2, w = cv.width, h = cv.height;
  var X = function(i){ return pad + i*(w-pad*2)/(data.length-1); };
  var Y = function(v){ return h - pad - (v-mn)/rg*(h-pad*2); };
  var col = cssVar(pct > 0 ? "--up" : (pct < 0 ? "--down" : "--tx3"));
  ctx.beginPath(); ctx.moveTo(X(0), Y(data[0]));
  for(var i=1;i<data.length;i++) ctx.lineTo(X(i), Y(data[i]));
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(X(data.length-1), h); ctx.lineTo(X(0), h); ctx.closePath();
  ctx.globalAlpha = .15; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
}

/* ---------- 포트폴리오 ---------- */
function renderPortfolio(){
  var tb = $("#pfBody"); tb.innerHTML = "";
  $("#pfEmpty").style.display = S.portfolio.length ? "none" : "block";
  var totBuy = 0, totVal = 0;
  S.portfolio.forEach(function(p, i){
    var q = QUOTES[keyOf(p.mk, p.code)];
    var qty = Number(p.qty)||0, avg = Number(p.avg)||0;
    var buy = qty*avg, cur = q ? q.price : null;
    var val = cur !== null ? qty*cur : null;
    var pl = val !== null ? val - buy : null;
    var pct = (buy > 0 && pl !== null) ? pl/buy*100 : null;
    totBuy += buy; totVal += (val !== null ? val : buy);
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="l"><span class="tk" data-hv="' + esc(p.code) + '">' +
        esc(p.name) + '</span></td><td></td><td></td>' +
      '<td class="num">' + (cur !== null ? fmtPrice(cur, p.mk) : "-") + '</td>' +
      '<td class="num">' + fmt(Math.round(buy)) + '</td>' +
      '<td class="num">' + (val !== null ? fmt(Math.round(val)) : "-") + '</td>' +
      '<td class="num ' + dirCls(pl) + '">' + (pl !== null ? fmtSigned(Math.round(pl)) : "-") + '</td>' +
      '<td class="num ' + dirCls(pct) + '">' + fmtPct(pct) + '</td><td class="c"></td>';
    var td = tr.children;
    td[1].appendChild(numInput(p.qty, function(v){ p.qty = v; save(); renderPortfolio(); }));
    td[2].appendChild(numInput(p.avg, function(v){ p.avg = v; save(); renderPortfolio(); }));
    var b = document.createElement("button");
    b.className = "btn xs"; b.textContent = "×";
    b.onclick = function(){ S.portfolio.splice(i,1); save(); renderPortfolio(); };
    td[8].appendChild(b);
    tb.appendChild(tr);
  });
  var pl = totVal - totBuy, plPct = totBuy > 0 ? pl/totBuy*100 : 0;
  $("#pfSum").innerHTML = S.portfolio.length
    ? ("매입 " + fmt(Math.round(totBuy)) + " · 평가 " + fmt(Math.round(totVal)) +
       ' · 손익 <span class="' + dirCls(pl) + '">' + fmtSigned(Math.round(pl)) + " (" + fmtPct(plPct) + ")</span>")
    : "";
}
function numInput(val, onChange){
  var el = document.createElement("input");
  el.type = "number"; el.className = "cell"; el.value = (val == null ? "" : val);
  el.step = "any"; el.min = "0";
  el.onchange = function(){ onChange(el.value === "" ? 0 : Number(el.value)); };
  return el;
}

/* =========================================================================
   티커 호버 미니차트 팝업 (핀비즈 UX)
   - 400ms 지연 후 표시, 이력 캐시 있으면 즉시 / 없으면 지연 로드(동시 1건)
   - 터치 환경에서는 비활성
   ========================================================================= */
const HOVER = { timer:null, code:null, loading:null };
const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);

function miniCandles(cv, bars){
  var ctx = cv.getContext("2d");
  var dpr = 2, W = cv.width/dpr, H = cv.height/dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  if(!bars || bars.length < 2){
    ctx.fillStyle = cssVar("--tx3"); ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("이력 불러오는 중…", W/2, H/2);
    return;
  }
  var d = bars.slice(-30);
  var lo = Infinity, hi = -Infinity;
  d.forEach(function(b){ if(b.l < lo) lo = b.l; if(b.h > hi) hi = b.h; });
  var pad = (hi-lo)*0.08 || 1; lo -= pad; hi += pad;
  var PB = 1, step = W/d.length, bw = Math.max(1.5, step*0.62);
  var Y = function(v){ return H - PB - (v-lo)/(hi-lo)*(H-PB*2); };
  var up = cssVar("--up"), dn = cssVar("--down");
  d.forEach(function(b, i){
    var x = i*step + step/2, col = b.c >= b.o ? up : dn;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
    var yo = Y(b.o), yc = Y(b.c);
    ctx.fillRect(x-bw/2, Math.min(yo,yc), bw, Math.max(1, Math.abs(yc-yo)));
  });
}
function showHover(code, x, y){
  var u = UNI_BY_KEY["KR:" + code], q = QUOTES["KR:" + code];
  if(!u) return;
  var pop = $("#mpop");
  $("#mpopName").textContent = u.name;
  var pctEl = $("#mpopPct");
  pctEl.textContent = q ? fmtPct(q.pct) : "";
  pctEl.className = q ? dirCls(q.pct) : "";
  pop.style.display = "block";
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var px = Math.min(x + 16, window.innerWidth - pw - 8);
  var py = y + 16 + ph > window.innerHeight ? y - ph - 12 : y + 16;
  pop.style.left = Math.max(6, px) + "px";
  pop.style.top = Math.max(6, py) + "px";

  var bars = (HIST[code] || {}).bars;
  miniCandles($("#mpopCv"), bars);
  if(bars && bars.length){
    var w = perfDays(bars, 5), m = perfDays(bars, 21);
    var d30 = bars.slice(-30);
    var lo = Math.min.apply(null, d30.map(function(b){ return b.l; }));
    var hi = Math.max.apply(null, d30.map(function(b){ return b.h; }));
    $("#mpopRange").textContent = "30일 " + fmt(lo) + "~" + fmt(hi);
    $("#mpopPerf").innerHTML = '1주 <span class="' + dirCls(w) + '">' + (w===null?"-":fmtPct(w)) + '</span>' +
                               ' · 1개월 <span class="' + dirCls(m) + '">' + (m===null?"-":fmtPct(m)) + '</span>';
  }else{
    $("#mpopRange").textContent = "";
    $("#mpopPerf").textContent = "";
    if(!HOVER.loading){                       // 동시 1건만
      HOVER.loading = code;
      loadHist(code, 3).then(function(){
        HOVER.loading = null;
        if(HOVER.code === code) showHover(code, x, y);
      }).catch(function(){
        HOVER.loading = null;
        HIST[code] = { bars:[], months:3, at:Date.now() };
      });
    }
  }
}
function hideHover(){
  if(HOVER.timer){ clearTimeout(HOVER.timer); HOVER.timer = null; }
  HOVER.code = null;
  $("#mpop").style.display = "none";
}
/* 위임 방식이라 테이블이 다시 그려져도 계속 동작 */
function initHover(){
  if(isTouch) return;
  document.addEventListener("mouseover", function(e){
    var el = e.target.closest("[data-hv]");
    if(!el){ return; }
    var code = el.dataset.hv;
    if(!code || !/^\d{6}$/.test(code)) return;
    if(HOVER.code === code) return;
    hideHover();
    HOVER.code = code;
    var x = e.clientX, y = e.clientY;
    HOVER.timer = setTimeout(function(){ if(HOVER.code === code) showHover(code, x, y); }, 400);
  });
  document.addEventListener("mouseout", function(e){
    var el = e.target.closest("[data-hv]");
    if(el) hideHover();
  });
  document.addEventListener("scroll", hideHover, true);
}

/* ---------- 종목 검색 ---------- */
function setupSearch(sel, onPick){
  var box = $(sel), input = $("input", box), sug = $(".sug", box);
  var items = [], hi = -1;
  function close(){ sug.classList.remove("open"); hi = -1; }
  function render(list){
    items = list;
    if(!list.length){ close(); return; }
    sug.innerHTML = list.map(function(u, i){
      return '<div data-i="' + i + '"><span class="mk">' + u.market + '</span>' + esc(u.name) +
             '<span class="cd">' + esc(u.code) + '</span></div>';
    }).join("");
    sug.classList.add("open");
  }
  function search(q){
    q = q.trim();
    if(!q){ close(); return; }
    /* 전 종목(약 2,600개) 대상. 정확일치 > 접두일치 > 부분일치, 동순위는 시총 큰 순 */
    var lq = q.toLowerCase();
    var exact = [], starts = [], contains = [];
    for(var i=0;i<UNIVERSE.length;i++){
      var u = UNIVERSE[i], n = u.name.toLowerCase(), c = u.code.toLowerCase();
      if(n === lq || c === lq) exact.push(u);
      else if(n.indexOf(lq) === 0 || c.indexOf(lq) === 0) starts.push(u);
      else if(n.indexOf(lq) >= 0 || c.indexOf(lq) >= 0) contains.push(u);
    }
    var byCap = function(a, b){ return (b.cap || 0) - (a.cap || 0); };
    exact.sort(byCap); starts.sort(byCap); contains.sort(byCap);
    var list = exact.concat(starts, contains).slice(0, 15);
    if(!list.length || list[0].code.toLowerCase() !== lq){
      if(/^\d{6}$/.test(q)) list.unshift({ market:"KOSPI", code:q, name:q + " (직접 입력)" });
    }
    /* 알파벳만 입력한 경우: 국내 전용 앱이므로 안내 */
    if(!list.length && /^[A-Za-z][A-Za-z.\-]*$/.test(q)){
      sug.innerHTML = '<div class="nohit">국내 종목(6자리 코드)만 지원합니다. ' +
                      '종목명 또는 코드로 검색하세요.</div>';
      sug.classList.add("open");
      items = [];
      return;
    }
    render(list);
  }
  function pick(i){
    var u = items[i]; if(!u) return;
    onPick({ mk:"KR", code:u.code, name:u.name.replace(/ \(직접 입력\)$/, "") });
    input.value = ""; close();
  }
  input.addEventListener("input", function(){ search(input.value); });
  input.addEventListener("focus", function(){ if(input.value) search(input.value); });
  input.addEventListener("blur", function(){ setTimeout(close, 160); });
  input.addEventListener("keydown", function(e){
    if(!sug.classList.contains("open")) return;
    var divs = $$("div", sug);
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      hi += (e.key === "ArrowDown" ? 1 : -1);
      if(hi < 0) hi = divs.length-1;
      if(hi >= divs.length) hi = 0;
      divs.forEach(function(d, i){ d.classList.toggle("hi", i === hi); });
      divs[hi].scrollIntoView({ block:"nearest" });
    }else if(e.key === "Enter"){ e.preventDefault(); pick(hi >= 0 ? hi : 0); }
    else if(e.key === "Escape") close();
  });
  sug.addEventListener("mousedown", function(e){
    var d = e.target.closest("div[data-i]");
    if(d) pick(+d.dataset.i);
  });
}
function addWatch(it, quiet){
  var k = keyOf(it.mk, it.code);
  if(WL().some(function(w){ return keyOf(w.mk, w.code) === k; })){
    if(!quiet) toast("이미 “" + S.wlGroups[S.wlActive].name + "” 그룹에 있습니다: " + it.name);
    return false;
  }
  WL().push(it); save(); renderWatchlist();
  if(!quiet){ toast(it.name + " 추가됨", "ok"); refreshAll(); }
  return true;
}
