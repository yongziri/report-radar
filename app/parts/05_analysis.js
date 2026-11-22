/* =========================================================================
   종목분석 — Finviz 식 스탯 그리드 + 캔들 차트
   ========================================================================= */
const AN = { sel:null, bars:[], period:"1y", tf:"day",
             ma:{5:true,20:true,60:true,120:false}, hover:-1, loading:false,
             tgtDots:[], tgtCache:null, tgtAsked:0, tgtSrc:null, tgtSrcN:-1, tgtDrawn:0 };
const MA_COLORS = { 5:"#E8B339", 20:"#34C062", 60:"#2F91EF", 120:"#C06CE0" };
const TGT_CONS_COLOR = "#FF8A3D";          // 목표가 컨센서스 계단선
const TGT_WIN = 90;                        // 컨센서스: 증권사별 최근 목표가를 이 일수 안에서만
const TGT_CLAMP = 2.5;                     // y축 확장 상한: 보이는 가격 범위의 배수

function renderMaLegend(){
  $("#maLeg").innerHTML = [5,20,60,120].map(function(p){
    return '<button data-ma="' + p + '" class="' + (AN.ma[p]?"on":"") + '" style="color:' + MA_COLORS[p] + '">' +
           '<span class="dot"></span>MA' + p + '</button>';
  }).join("") +
    '<button data-tgt="1" class="' + (tgtOn()?"on":"") + '" style="color:' + TGT_CONS_COLOR + '" ' +
    'title="증권사 목표주가 이력 표시">' + '<span class="dot"></span>목표가</button>';
}

/* ---------- 목표주가 이력 오버레이 (09_reports.js 의 rpByCode 를 읽기 전용으로 사용) ---------- */
function tgtOn(){ return !(S.settings && S.settings.anTgt === false); }   // 기본 켜짐
function tgtYmd(iso){ return String(iso || "").replace(/-/g, "").slice(0, 8); }
function tgtShiftYmd(ymd, days){
  var d = new Date(Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8)) + days*86400000);
  return d.toISOString().slice(0,10).replace(/-/g, "");
}
function tgtDaysSince(ymd){
  var t = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8));
  return Math.max(0, Math.ceil((Date.now() - t) / 86400000));
}
/* 해당 종목의 목표가 있는 리포트 (suspect 제외), 날짜 오름차순 */
function tgtRecords(code){
  if(typeof RP_READY === "undefined" || !RP_READY || typeof rpByCode === "undefined") return null;
  var list = rpByCode[code];
  if(!list) return { list:null, recs:[] };
  var recs = [];
  for(var i=0;i<list.length;i++){
    var r = list[i];
    if(r.suspect || typeof r.target !== "number" || !(r.target > 0) || !r.date) continue;
    recs.push({ r:r, d:tgtYmd(r.date), b:r.broker || ("?" + (r.id || i)) });
  }
  recs.sort(function(a,b){ return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });
  return { list:list, recs:recs };
}
/* 날짜 D 기준 컨센서스: 최근 TGT_WIN 일 안의 증권사별 최신 목표가 */
function tgtConsAt(latest, D){
  var floor = tgtShiftYmd(D, -TGT_WIN), vals = [];
  for(var b in latest){ if(latest[b].d >= floor) vals.push(latest[b].r.target); }
  return vals;
}
function tgtCompute(bars, code){
  if(typeof RP_READY === "undefined" || !RP_READY || typeof rpByCode === "undefined") return null;
  var c = AN.tgtCache, cur = rpByCode[code];
  if(c && c.bars === bars && c.code === code && c.list === cur && c.ln === (cur ? cur.length : 0)) return c;
  var src = tgtRecords(code);
  if(!src) return null;
  var recs = src.recs, n = bars.length;
  var dots = [], cons = new Array(n), latest = {}, p = 0;
  var first = n ? bars[0].d : "", lastD = n ? bars[n-1].d : "";
  /* 점: 리포트 날짜가 속한 봉 (그 날짜 이하의 마지막 봉) */
  var bi = 0;
  for(var k=0;k<recs.length && n;k++){
    var d = recs[k].d;
    if(d < first) continue;
    while(bi < n-1 && bars[bi+1].d <= d) bi++;
    dots.push({ i:(d > lastD ? n-1 : bi), v:recs[k].r.target, r:recs[k].r });
  }
  /* 계단선: 봉마다 컨센서스 */
  for(var i=0;i<n;i++){
    var D = bars[i].d;
    if(i === n-1 && todayStr() > D) D = todayStr();      // 마지막 봉은 오늘까지 반영
    while(p < recs.length && recs[p].d <= D){ latest[recs[p].b] = recs[p]; p++; }
    var vals = tgtConsAt(latest, D);
    cons[i] = vals.length ? vals.reduce(function(s, v){ return s + v; }, 0) / vals.length : null;
  }
  /* 요약: 오늘 기준 */
  var all = {};
  recs.forEach(function(x){ all[x.b] = x; });
  var now = tgtConsAt(all, todayStr());
  AN.tgtCache = { bars:bars, list:src.list, code:code, ln:src.list ? src.list.length : 0, dots:dots, cons:cons,
                  sum:{ k:now.length,
                        avg:now.length ? now.reduce(function(s, v){ return s + v; }, 0) / now.length : null,
                        hi:now.length ? Math.max.apply(null, now) : null,
                        lo:now.length ? Math.min.apply(null, now) : null } };
  return AN.tgtCache;
}
function tgtRenderSummary(t){
  var el = $("#anTgtSum"); if(!el) return;
  var html = "";
  if(t && tgtOn() && AN.sel && !isIdx(AN.sel)){
    var it = AN.sel, s = t.sum, q = QUOTES[keyOf(it.mk, it.code)];
    var price = (q && q.price > 0) ? q.price : (AN.bars.length ? AN.bars[AN.bars.length-1].c : null);
    var gap = (s.avg && price) ? (s.avg - price) / price * 100 : null;
    var leg = '<span class="tl"><i class="td up"></i>상향</span><span class="tl"><i class="td down"></i>하향</span>' +
              '<span class="tl"><i class="td flat"></i>유지·신규</span>' +
              '<span class="tl"><i class="tc" style="background:' + TGT_CONS_COLOR + '"></i>컨센서스(' + TGT_WIN + '일)</span>';
    var body = s.k
      ? '<span class="k">증권사</span> ' + s.k + "곳" +
        '<span class="k">컨센서스</span> <b>' + fmt(Math.round(s.avg)) + "</b>" +
        '<span class="k">최고</span> ' + fmt(s.hi) + '<span class="k">최저</span> ' + fmt(s.lo) +
        '<span class="k">현재가 대비</span> <span class="' + dirCls(gap) + '">' + (gap === null ? "-" : fmtPct(gap)) + "</span>"
      : '<span class="k">최근 ' + TGT_WIN + "일 목표주가 없음</span>";
    html = '<span class="tb">' + body + '</span><span class="tg">' + leg + "</span>";
  }
  if(el.innerHTML !== html) el.innerHTML = html;
  el.style.display = html ? "" : "none";
}
/* 로더가 rpEnsureHistory(days) 를 제공하면 차트 기간 + 컨센서스 창만큼 과거 리포트를 확보 */
function tgtEnsure(days){
  if(typeof rpEnsureHistory !== "function" || days <= AN.tgtAsked) return;
  AN.tgtAsked = days;
  Promise.resolve(rpEnsureHistory(days)).then(function(){
    AN.tgtCache = null;
    if(AN.sel) drawChart();
  }).catch(function(e){ console.warn("리포트 이력 확보 실패:", e && e.message ? e.message : e); });
}
/* 리포트 데이터 도착/갱신 시 차트 다시 그리기 — 09 의 rpLoad·rpCheckUpdate 가 rpRenderAnal() 을 부른다 */
function tgtOnData(){
  if(typeof RPT === "undefined") return;
  if(RPT === AN.tgtSrc && RPT.length === AN.tgtSrcN) return;
  AN.tgtSrc = RPT; AN.tgtSrcN = RPT.length; AN.tgtCache = null;
  if(AN.sel && !isIdx(AN.sel) && AN.bars.length) drawChart();
}
function tgtHit(mx, my, rad){
  var best = null, bd = rad*rad;
  AN.tgtDots.forEach(function(p){
    var dx = p.x - mx, dy = p.y - my, d2 = dx*dx + dy*dy;
    if(d2 <= bd){ bd = d2; best = p; }
  });
  return best;
}
function isIdx(it){ return it && it.mk === "IDX"; }

function selectStock(it){
  AN.sel = it; AN.hover = -1;
  $("#anEmpty").style.display = "none";
  $("#anBody").style.display = "block";
  var u = UNI_BY_KEY[keyOf(it.mk, it.code)];
  $("#anTitle").textContent = it.name;
  $("#anSub").textContent = isIdx(it) ? "지수" : (it.code + (u && u.industry ? " · " + u.industry : ""));
  /* 지수는 종목 전용 UI(관심추가·기업분석·뉴스/공시)를 숨긴다 */
  var stockOnly = !isIdx(it);
  $("#anAddWl").classList.toggle("hide", !stockOnly);
  $("#anCmp").classList.toggle("hide", !stockOnly);
  $("#anFeeds").style.display = stockOnly ? "grid" : "none";
  renderAnalysisHead();
  rpRenderAnal();                  // 지수는 여기서 리포트 패널을 감춘다
  loadBars();
  if(stockOnly) renderNews();
  if(stockOnly && !QUOTES[keyOf(it.mk, it.code)]) refreshAll();
}
/* 헤더 지수 클릭 → 지수 캔들차트 */
function selectIndex(code){
  selectStock({ mk:"IDX", code:code, name:code });
  showTab("anal");
}
function periodMonths(p){ return { "3m":3, "6m":6, "1y":12, "3y":36 }[p] || 12; }

function loadBars(){
  var it = AN.sel; if(!it) return;
  AN.loading = true; AN.bars = []; drawChart();
  {                                // 종목·지수 모두 siseJson 으로 조회
    naverHistory(it.code, AN.tf, ymdShift(periodMonths(AN.period)), todayStr()).then(function(bars){
      noteOk();
      if(AN.sel !== it) return;
      AN.bars = bars; AN.loading = false; drawChart(); renderAnalysisHead();
    }).catch(function(e){
      noteFail(); AN.loading = false; drawChart();
      toast("차트 데이터를 불러오지 못했습니다: " + e.message, "err");
    });
  }
}

function renderAnalysisHead(){
  var it = AN.sel; if(!it) return;
  var bars = AN.bars, closes = bars.map(function(b){ return b.c; });

  /* 지수: 종목 전용 스탯(PER/거래대금/배당 등) 없이 가격·성과 지표만 */
  if(isIdx(it)){
    var c = closes.length ? closes[closes.length-1] : null;
    var last = bars.length ? bars[bars.length-1] : null;
    var prev = bars.length > 1 ? bars[bars.length-2].c : null;
    var chg = (c !== null && prev) ? c - prev : null;
    var win = bars.slice(-252);
    var h52 = win.length ? Math.max.apply(null, win.map(function(b){ return b.h; })) : null;
    var l52 = win.length ? Math.min.apply(null, win.map(function(b){ return b.l; })) : null;
    var r = lastOf(calcRSI(closes, 14));
    var f2 = function(v){ return v === null || v === undefined ? "-" : Number(v).toFixed(2); };
    var cl = function(k, v, x){ return '<td class="k">' + k + '</td><td class="v ' + (x||"") + '">' + v + '</td>'; };
    $("#anStats").innerHTML = [
      cl("현재 지수", f2(c)) +
        cl("전일대비", chg === null ? "-" : (chg > 0 ? "+" : "") + f2(chg), dirCls(chg)) +
        cl("등락률", prev ? fmtPct(chg/prev*100) : "-", dirCls(chg)) +
        cl("거래량", last ? fmtBig(last.v) : "-"),
      cl("시가", last ? f2(last.o) : "-") + cl("고가", last ? f2(last.h) : "-") +
        cl("저가", last ? f2(last.l) : "-") +
        cl("RSI(14)", r === null ? "-" : r.toFixed(1), r === null ? "" : (r > 70 ? "hot" : (r < 30 ? "cold" : ""))),
      cl("52주 최고", f2(h52)) + cl("52주 최저", f2(l52)) +
        cl("1주", fmtPct(perfDays(bars,5)), dirCls(perfDays(bars,5))) +
        cl("1개월", fmtPct(perfDays(bars,21)), dirCls(perfDays(bars,21))),
      cl("3개월", fmtPct(perfDays(bars,63)), dirCls(perfDays(bars,63))) +
        cl("YTD", fmtPct(perfYTD(bars)), dirCls(perfYTD(bars))) +
        cl("변동성(연율)", (function(v){ return v === null ? "-" : v.toFixed(1) + "%"; })(calcVol(bars,20))) +
        cl("데이터", bars.length + "봉")
    ].map(function(x){ return "<tr>" + x + "</tr>"; }).join("");
    return;
  }

  var q = QUOTES[keyOf(it.mk, it.code)], u = UNI_BY_KEY[keyOf(it.mk, it.code)];
  var cur = q ? q.price : (closes.length ? closes[closes.length-1] : null);
  var mk = it.mk;

  var hi52 = null, lo52 = null;
  if(bars.length){
    var win = AN.tf === "day" ? bars.slice(-252) : bars.slice(-52);
    hi52 = Math.max.apply(null, win.map(function(b){ return b.h; }));
    lo52 = Math.min.apply(null, win.map(function(b){ return b.l; }));
  }
  if(q && q.hi52){ hi52 = q.hi52; lo52 = q.lo52; }

  var rsi = lastOf(calcRSI(closes, 14));
  function sep(p){
    if(!closes.length || cur === null) return null;
    var v = lastOf(calcMA(closes, p));
    return v ? (cur - v)/v*100 : null;
  }
  var pos52 = (hi52 !== null && lo52 !== null && hi52 > lo52 && cur !== null)
              ? (cur - lo52)/(hi52 - lo52)*100 : null;

  function cell(k, v, cls){ return '<td class="k">' + k + '</td><td class="v ' + (cls||"") + '">' + v + '</td>'; }
  function pctCell(k, v){ return cell(k, fmtPct(v), dirCls(v)); }
  var rsiCls = rsi === null ? "" : (rsi > 70 ? "hot" : (rsi < 30 ? "cold" : ""));

  var rows = [
    cell("현재가", cur !== null ? fmtPrice(cur, mk) : "-") +
      pctCell("등락률", q ? q.pct : null) +
      cell("전일대비", q ? '<span class="' + dirCls(q.chg) + '">' + fmtSigned(q.chg) + "</span>" : "-") +
      cell("전일종가", q ? fmtPrice(q.prev, mk) : "-"),
    cell("시가", q ? fmtPrice(q.open, mk) : "-") +
      cell("고가", q ? fmtPrice(q.high, mk) : "-") +
      cell("저가", q ? fmtPrice(q.low, mk) : "-") +
      cell("당일 고저위치", q && q.pos !== null ? q.pos.toFixed(0) + "%" : "-",
           q && q.pos !== null && q.pos >= 90 ? "up" : ""),
    cell("52주 최고", hi52 !== null ? fmtPrice(hi52, mk) : "-") +
      cell("52주 최저", lo52 !== null ? fmtPrice(lo52, mk) : "-") +
      cell("52주 위치", pos52 !== null ? pos52.toFixed(0) + "%" : "-",
           pos52 === null ? "" : (pos52 >= 90 ? "hot" : (pos52 <= 10 ? "cold" : ""))) +
      cell("RSI(14)", rsi !== null ? rsi.toFixed(1) : "-", rsiCls),
    pctCell("SMA20 이격", sep(20)) + pctCell("SMA60 이격", sep(60)) +
      pctCell("SMA120 이격", sep(120)) +
      cell("거래량", q ? fmtBig(q.vol) : "-"),
    cell("거래대금", q && q.amt ? fmtBig(q.amt) + "원" : "-") +
      cell("시가총액", (q && q.capE) ? fmt(Math.round(q.capE)) + "억" : ((u && u.cap) ? fmt(u.cap) + "억" : "-")) +
      cell("PER", q && q.per ? q.per.toFixed(2) : "-") +
      cell("PBR", q && q.pbr ? q.pbr.toFixed(2) : "-"),
    cell("선행 PER", q && q.fper ? q.fper.toFixed(2) : "-") +
      cell("EPS", q && q.eps ? fmt(q.eps) : "-") +
      cell("BPS", q && q.bps ? fmt(Math.round(q.bps)) : "-") +
      cell("배당수익률", q && q.divy ? q.divy.toFixed(2) + "%" : "-"),
    cell("갭%", q && q.gap !== null ? fmtPct(q.gap) : "-", q ? dirCls(q.gap) : "") +
      cell("당일 변동폭", q && q.range !== null ? q.range.toFixed(2) + "%" : "-") +
      cell("상한가 근접", q && q.ulNear !== null ? q.ulNear.toFixed(1) + "%" : "-",
           q && q.ulNear >= 95 ? "hot" : "") +
      cell("회전율", q && q.turn !== null ? q.turn.toFixed(2) + "%" : "-")
  ];
  $("#anStats").innerHTML = rows.map(function(r){ return "<tr>" + r + "</tr>"; }).join("");
  rpRenderAnal();                  // 증권사 리포트 패널 (09_reports.js)
}

/* ---------- 캔들 차트 ---------- */
function drawChart(){
  var cv = $("#chart"); if(!cv) return;
  var dpr = window.devicePixelRatio || 1;
  var W = cv.clientWidth || 900, H = cv.clientHeight || 500;
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  var ctx = cv.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  var C = { tx3:cssVar("--tx3"), line:cssVar("--line"), line2:cssVar("--line2"),
            up:cssVar("--up"), down:cssVar("--down"), acc:cssVar("--link") };
  ctx.font = '10.5px "Wooridaum","IBM Plex Sans",sans-serif';

  var bars = AN.bars;
  AN.tgtDots = [];
  var tg = (bars.length && AN.sel && !isIdx(AN.sel)) ? tgtCompute(bars, AN.sel.code) : null;
  tgtRenderSummary(tg);
  if(!tgtOn()) tg = null;
  if(bars.length && AN.sel && !isIdx(AN.sel)) tgtEnsure(tgtDaysSince(bars[0].d) + TGT_WIN);
  if(!bars.length){
    ctx.fillStyle = C.tx3; ctx.textAlign = "center";
    ctx.fillText(AN.loading ? "차트 데이터를 불러오는 중…" : "데이터가 없습니다", W/2, H/2);
    return;
  }

  var PL = 6, PR = 58, PT = 8, PB = 18, gap = 7;
  var plotW = W - PL - PR, avail = H - PT - PB - gap*2;
  var hMain = Math.round(avail*0.62), hVol = Math.round(avail*0.15);
  var hRsi = avail - hMain - hVol;
  var yMain = PT, yVol = PT + hMain + gap, yRsi = yVol + hVol + gap;
  var n = bars.length, step = plotW/n;
  var bw = Math.max(1, Math.min(13, Math.floor(step*0.72)));
  var closes = bars.map(function(b){ return b.c; });

  var mas = {};
  [5,20,60,120].forEach(function(p){ if(AN.ma[p]) mas[p] = calcMA(closes, p); });
  var lo = Infinity, hi = -Infinity;
  bars.forEach(function(b){ if(b.l < lo) lo = b.l; if(b.h > hi) hi = b.h; });
  Object.keys(mas).forEach(function(p){
    mas[p].forEach(function(v){ if(v !== null){ if(v < lo) lo = v; if(v > hi) hi = v; } });
  });
  /* 목표가가 들어오도록 y축 확장. 가격 범위의 TGT_CLAMP 배를 넘는 값은 가장자리에 고정 */
  var capHi = Infinity, capLo = -Infinity;
  if(tg){
    var pr = (hi - lo) || hi*0.05 || 1;
    capHi = lo + pr*TGT_CLAMP; capLo = Math.max(0, hi - pr*TGT_CLAMP);
    var tHi = -Infinity, tLo = Infinity;
    tg.dots.forEach(function(p){ if(p.v > tHi) tHi = p.v; if(p.v < tLo) tLo = p.v; });
    tg.cons.forEach(function(v){ if(v !== null){ if(v > tHi) tHi = v; if(v < tLo) tLo = v; } });
    if(tHi > hi) hi = Math.min(tHi, capHi);
    if(tLo < lo) lo = Math.max(tLo, capLo);
  }
  var pad = (hi-lo)*0.06 || hi*0.02 || 1;
  lo -= pad; hi += pad;
  var maxVol = Math.max.apply(null, bars.map(function(b){ return b.v; })) || 1;

  var X = function(i){ return PL + i*step + step/2; };
  var Y = function(v){ return yMain + hMain - (v-lo)/(hi-lo)*hMain; };
  var YV = function(v){ return yVol + hVol - v/maxVol*hVol; };
  var YR = function(v){ return yRsi + hRsi - v/100*hRsi; };

  ctx.strokeStyle = C.line; ctx.fillStyle = C.tx3; ctx.textAlign = "left";
  for(var g=0; g<=5; g++){
    var gv = lo + (hi-lo)*g/5, gy = Math.round(Y(gv))+0.5;
    ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(PL+plotW, gy); ctx.stroke();
    ctx.fillText(fmtAxis(gv), PL+plotW+5, gy+3.5);
  }
  [[yVol,hVol],[yRsi,hRsi]].forEach(function(p){
    ctx.strokeStyle = C.line; ctx.strokeRect(PL+0.5, p[0]+0.5, plotW, p[1]);
  });

  bars.forEach(function(b, i){
    var x = X(i), col = b.c >= b.o ? C.up : C.down;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(Math.round(x)+0.5, Y(b.h)); ctx.lineTo(Math.round(x)+0.5, Y(b.l)); ctx.stroke();
    var yo = Y(b.o), yc = Y(b.c);
    ctx.fillRect(Math.round(x-bw/2), Math.round(Math.min(yo,yc)), bw, Math.max(1, Math.round(Math.abs(yc-yo))));
  });
  Object.keys(mas).forEach(function(p){
    var arr = mas[p], st = false;
    ctx.beginPath(); ctx.strokeStyle = MA_COLORS[p]; ctx.lineWidth = 1.2;
    for(var i=0;i<arr.length;i++){
      if(arr[i] === null) continue;
      if(!st){ ctx.moveTo(X(i), Y(arr[i])); st = true; } else ctx.lineTo(X(i), Y(arr[i]));
    }
    ctx.stroke();
  });
  ctx.lineWidth = 1;

  /* 목표주가: 컨센서스 계단선 + 리포트별 점 */
  if(tg){
    var yTop = yMain + 4, yBot = yMain + hMain - 4;
    var YT = function(v){ return Math.max(yTop, Math.min(yBot, Y(v))); };
    ctx.save(); ctx.beginPath(); ctx.rect(PL, yMain, plotW, hMain); ctx.clip();
    ctx.strokeStyle = TGT_CONS_COLOR; ctx.lineWidth = 1.4; ctx.setLineDash([5,3]);
    ctx.beginPath();
    var prevY = null;
    for(var ci=0; ci<n; ci++){
      var cv2 = tg.cons[ci];
      if(cv2 === null){ prevY = null; continue; }
      var cy = YT(cv2), x0 = PL + ci*step, x1 = x0 + step;
      if(prevY === null) ctx.moveTo(x0, cy); else ctx.lineTo(x0, cy);   // 세로 계단
      ctx.lineTo(x1, cy);
      prevY = cy;
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    var colNeu = cssVar("--tx2");
    tg.dots.forEach(function(p){
      var x = X(p.i), ch = p.r.target_change;
      var col = ch === "up" ? C.up : (ch === "down" ? C.down : colNeu);
      var pin = p.v > capHi ? 1 : (p.v < capLo ? -1 : 0);
      var y = pin > 0 ? yTop + 5 : (pin < 0 ? yBot - 5 : YT(p.v));
      ctx.fillStyle = col; ctx.strokeStyle = cssVar("--panel") || "#000"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      if(pin){                                   // 범위 밖: 가장자리 고정 + 방향 삼각형
        ctx.fillStyle = col; ctx.beginPath();
        var ty = pin > 0 ? y - 3 : y + 3, d = pin > 0 ? -4 : 4;
        ctx.moveTo(x - 3.5, ty); ctx.lineTo(x + 3.5, ty); ctx.lineTo(x, ty + d); ctx.closePath(); ctx.fill();
      }
      AN.tgtDots.push({ x:x, y:y, r:p.r, pin:pin });
    });
    ctx.restore(); ctx.lineWidth = 1;
  }
  AN.tgtDrawn = AN.tgtDots.length;               // 검증용 카운터

  bars.forEach(function(b, i){
    ctx.fillStyle = b.c >= b.o ? C.up : C.down;
    ctx.globalAlpha = .5;
    ctx.fillRect(Math.round(X(i)-bw/2), Math.round(YV(b.v)), bw, Math.max(1, Math.round(yVol+hVol-YV(b.v))));
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.tx3; ctx.fillText("거래량", PL+5, yVol+11);

  var rsi = calcRSI(closes, 14);
  ctx.save(); ctx.beginPath(); ctx.rect(PL, yRsi, plotW, hRsi); ctx.clip();
  [30,50,70].forEach(function(lv){
    ctx.beginPath(); ctx.setLineDash(lv === 50 ? [] : [3,3]);
    ctx.strokeStyle = C.line2;
    var y = Math.round(YR(lv))+0.5;
    ctx.moveTo(PL, y); ctx.lineTo(PL+plotW, y); ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.beginPath(); ctx.strokeStyle = C.acc; ctx.lineWidth = 1.2;
  var st2 = false;
  for(var r=0;r<rsi.length;r++){
    if(rsi[r] === null) continue;
    if(!st2){ ctx.moveTo(X(r), YR(rsi[r])); st2 = true; } else ctx.lineTo(X(r), YR(rsi[r]));
  }
  ctx.stroke(); ctx.restore(); ctx.lineWidth = 1;
  var lastRsi = lastOf(rsi);
  ctx.fillStyle = C.tx3;
  ctx.fillText("RSI(14)" + (lastRsi !== null ? "  " + lastRsi.toFixed(1) : ""), PL+5, yRsi+11);
  ctx.fillText("70", PL+plotW+5, YR(70)+3.5);
  ctx.fillText("30", PL+plotW+5, YR(30)+3.5);

  ctx.textAlign = "center";
  var ticks = Math.max(2, Math.min(9, Math.floor(plotW/90)));
  for(var t=0;t<=ticks;t++){
    var idx = Math.min(n-1, Math.round(t*(n-1)/ticks)), lbl = fmtDate(bars[idx].d), lx = X(idx);
    if(IS_APP){ var hw = ctx.measureText(lbl).width/2 + 2; lx = Math.max(hw, Math.min(W - hw, lx)); }   // 앱: 화면 폭 꽉 찬 차트에서 양 끝 날짜가 잘리지 않게
    ctx.fillText(lbl, lx, H-5);
  }

  if(AN.hover >= 0 && AN.hover < n){
    var b = bars[AN.hover], hx = X(AN.hover);
    ctx.strokeStyle = C.line2; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, H-PB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PL, Y(b.c)); ctx.lineTo(PL+plotW, Y(b.c)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.acc; ctx.fillRect(PL+plotW+2, Y(b.c)-7, PR-5, 14);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left";
    ctx.fillText(fmtAxis(b.c), PL+plotW+5, Y(b.c)+3.5);
  }
}
function fmtAxis(v){
  if(v >= 10000) return Math.round(v).toLocaleString("ko-KR");
  if(v >= 100) return v.toFixed(0);
  return v.toFixed(2);
}
function fmtDate(d){
  d = String(d);
  return d.length === 8 ? d.slice(2,4)+"/"+d.slice(4,6)+"/"+d.slice(6,8) : d;
}
function initChartEvents(){
  var cv = $("#chart"), tip = $("#tip");
  function row(k, v){ return '<div class="r"><span>'+k+'</span><span>'+v+'</span></div>'; }
  function onPoint(e, rad){
    var r = cv.getBoundingClientRect();
    var plotW = cv.clientWidth - 6 - 58, n = AN.bars.length;
    var i = n ? Math.floor((e.clientX - r.left - 6)/(plotW/n)) : -1;
    if(i < 0 || i >= n) i = -1;
    if(i !== AN.hover){ AN.hover = i; drawChart(); }
    var dot = tgtHit(e.clientX - r.left, e.clientY - r.top, rad);
    if(i < 0 && !dot){ tip.style.display = "none"; return; }
    if(dot){                                       // 목표주가 점: 리포트 정보
      var rp = dot.r, tc = rp.target_change;
      var chTxt = tc === "up" ? '<span class="up">상향</span>' : (tc === "down" ? '<span class="down">하향</span>' :
                  (tc === "new" ? "신규" : (tc === "same" ? "유지" : "-")));
      tip.innerHTML = "<b>" + esc(rp.date || "") + " · " + esc(rp.broker || "") + "</b>" +
        (rp.analyst ? row("애널리스트", esc(rp.analyst)) : "") +
        row("의견", esc(rp.rating || "-")) +
        row("목표가", "<b>" + fmt(rp.target) + "</b>") +
        row("이전 목표가", typeof rp.prev_target === "number" ? fmt(rp.prev_target) : "-") +
        row("변경", chTxt) +
        (rp.title ? '<div class="tt">' + esc(rp.title) + "</div>" : "");
    }else{
      var b = AN.bars[i], mk = AN.sel ? AN.sel.mk : "KR";
      var prev = i > 0 ? AN.bars[i-1].c : b.o;
      var ch = b.c - prev, pc = prev ? ch/prev*100 : 0;
      tip.innerHTML = "<b>" + fmtDate(b.d) + "</b>" +
        row("시가", fmtPrice(b.o, mk)) + row("고가", fmtPrice(b.h, mk)) +
        row("저가", fmtPrice(b.l, mk)) + row("종가", fmtPrice(b.c, mk)) +
        row("대비", '<span class="'+dirCls(ch)+'">'+fmtSigned(ch)+" ("+fmtPct(pc)+")</span>") +
        row("거래량", fmtBig(b.v));
    }
    tip.style.display = "block";
    var wrap = cv.parentElement.getBoundingClientRect();
    var lx = e.clientX - wrap.left + 14;
    if(lx + tip.offsetWidth > wrap.width) lx = e.clientX - wrap.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(0, lx) + "px";
    tip.style.top = Math.max(0, Math.min(wrap.height - tip.offsetHeight, e.clientY - wrap.top + 10)) + "px";
  }
  cv.addEventListener("mousemove", function(e){ onPoint(e, 7); });
  cv.addEventListener("click", function(e){ onPoint(e, 12); });      // 터치 탭: 판정 반경을 넓힌다
  cv.addEventListener("mouseleave", function(){ AN.hover = -1; tip.style.display = "none"; drawChart(); });
  document.addEventListener("touchstart", function(e){            // 차트 밖을 탭하면 툴팁 닫기
    if(e.target !== cv && tip.style.display !== "none"){ AN.hover = -1; tip.style.display = "none"; drawChart(); }
  }, { passive:true });

  /* 목표가 토글 (07 의 #maLeg onclick 은 data-ma 버튼만 처리한다) */
  $("#maLeg").addEventListener("click", function(e){
    var b = e.target.closest("button[data-tgt]"); if(!b) return;
    S.settings = S.settings || {};
    S.settings.anTgt = !tgtOn();
    save(); renderMaLegend(); drawChart();
  });

  /* 리포트 데이터 도착 훅: 09 를 건드리지 않고 전역 rpRenderAnal 을 감싼다.
     rpLoad()·rpCheckUpdate()(·이후 로더)가 데이터 적재 뒤 rpRenderAnal() 을 부르므로 여기서 차트를 다시 그린다. */
  if(typeof rpRenderAnal === "function" && !rpRenderAnal.tgtWrapped){
    var rpAnalNow = rpRenderAnal;
    rpRenderAnal = function(){
      var ret = rpAnalNow.apply(this, arguments);
      try{ tgtOnData(); }catch(err){ console.warn("목표가 오버레이 갱신 실패:", err); }
      return ret;
    };
    rpRenderAnal.tgtWrapped = true;
  }
}

/* =========================================================================
   기업분석 — 와이즈리포트(FnGuide) 리포트 iframe 임베드
   두 URL 모두 X-Frame-Options / CSP frame-ancestors 가 없어 임베드 가능.
   교차 출처라 내부 스타일 개입은 불가능하다.
   ========================================================================= */
/* 와이즈리포트 종목별 리포트 (모두 cmp_cd 로 종목 지정됨).
   comp.wisereport.co.kr 의 ReportSummary.aspx 는 cmp_cd 를 무시하고
   전체 증권사 리포트 목록을 보여주므로 쓰지 않는다. */
const CMP_REPORTS = [
  { r:"c1010001", t:"기업현황" },
  { r:"c1030001", t:"재무분석" },
  { r:"c1040001", t:"투자지표" },
  { r:"c1050001", t:"컨센서스" },
  { r:"c1070001", t:"지분현황" }
];
const CMP = { sel:null, report:"c1010001" };

function cmpUrl(code, report){
  return "https://navercomp.wisereport.co.kr/v2/company/" + (report || "c1010001") +
         ".aspx?cmp_cd=" + encodeURIComponent(code) + "&cn=";
}
function selectCompany(it){
  CMP.sel = it;
  $("#cmpEmpty").style.display = "none";
  $("#cmpBody").style.display = "block";
  var u = UNI_BY_KEY[keyOf(it.mk, it.code)];
  $("#cmpTitle").textContent = it.name;
  $("#cmpSub").textContent = it.code + (u && u.industry ? " · " + u.industry : "");
  loadCmpFrame();
}
function loadCmpFrame(){
  if(!CMP.sel) return;
  var fr = $("#cmpFrame"), ld = $("#cmpLoad");
  ld.style.display = "flex";
  fr.style.height = Math.max(1200, window.innerHeight - 150) + "px";
  fr.src = cmpUrl(CMP.sel.code, CMP.report);
}
/* =========================================================================
   경제 캘린더 — TradingView 공식 이벤트 위젯 (XFO/frame-ancestors 없음 실측)
   설정은 URL 해시에 JSON 으로 전달한다.
   ========================================================================= */
function calendarUrl(){
  var cfg = {
    colorTheme: S.theme === "dark" ? "dark" : "light",
    isTransparent: false,
    locale: "kr",
    countryFilter: "kr,us",
    importanceFilter: "0,1",
    width: "100%",
    height: "100%"
  };
  return "https://www.tradingview-widget.com/embed-widget/events/?locale=kr#" +
         encodeURIComponent(JSON.stringify(cfg));
}
function initCalendar(){
  var fr = $("#calFrame"), failed = true;
  fr.addEventListener("load", function(){
    failed = false;
    window.__calLoads = (window.__calLoads || 0) + 1;
    $("#calFail").classList.add("hide");
  });
  fr.src = calendarUrl();
  setTimeout(function(){
    if(failed){ $("#calFail").classList.remove("hide"); fr.style.display = "none"; }
  }, 9000);
  $("#calToggle").onclick = function(){
    var w = $("#calWrap"), hidden = w.classList.toggle("hide");
    $("#calToggle").textContent = hidden ? "펼치기" : "접기";
  };
}

function initCmp(){
  $("#segCmp").innerHTML = CMP_REPORTS.map(function(x){
    return '<button data-r="' + x.r + '"' + (x.r === CMP.report ? ' class="act"' : "") + '>' + x.t + '</button>';
  }).join("");
  var fr = $("#cmpFrame");
  fr.addEventListener("load", function(){
    $("#cmpLoad").style.display = "none";
    CMP.loaded = (CMP.loaded || 0) + 1;       // 계측용
  });
  $("#segCmp").onclick = function(e){
    var b = e.target.closest("button[data-r]"); if(!b) return;
    CMP.report = b.dataset.r;
    $$("#segCmp button").forEach(function(x){ x.classList.toggle("act", x === b); });
    loadCmpFrame();
  };
  $("#cmpOpen").onclick = function(){
    if(!CMP.sel){ toast("먼저 종목을 선택하세요.", "err"); return; }
    window.open(cmpUrl(CMP.sel.code, CMP.report), "_blank", "noopener");
  };
  window.addEventListener("resize", function(){
    if(CMP.sel) $("#cmpFrame").style.height = Math.max(1200, window.innerHeight - 150) + "px";
  });
}

/* ---------- 뉴스 (구글뉴스 RSS via rss2json) ---------- */
function renderNews(force){
  var it = AN.sel; if(!it) return;
  $("#anFeeds").style.display = "grid";
  var box = $("#anNews"), sub = $("#anNewsSub");
  var q = it.name;
  var key = "n:" + keyOf(it.mk, it.code);

  box.innerHTML = '<div style="color:var(--tx3)">뉴스를 불러오는 중…</div>';
  sub.textContent = "구글 뉴스";
  RSS.get(key, gnewsRss(q), force).then(function(r){
    if(AN.sel !== it) return;
    box.innerHTML = newsListHtml(r.items, 10);
    sub.innerHTML = "구글 뉴스 · " + (r.stale ? '<span class="stalebadge">갱신 실패 · 이전 결과</span> ' : "") +
      (r.cached && !r.stale ? "캐시 · " : "") + new Date(r.at).toLocaleTimeString("ko-KR", {hour12:false});
  }).catch(function(e){
    if(AN.sel !== it) return;
    sub.innerHTML = '<span class="stalebadge">불러오기 실패</span>';
    box.innerHTML = '<div class="note">뉴스를 불러오지 못했습니다 (' + esc(e.message) + ').<br>' +
      '<a href="' + gnewsLink(q) + '" target="_blank" rel="noopener">구글 뉴스에서 “' + esc(q) + '” 검색 →</a>' +
      ' · <a href="https://finance.naver.com/item/news.naver?code=' + esc(it.code) +
      '" target="_blank" rel="noopener">네이버 금융 뉴스 →</a></div>';
  });
  renderStockDart(it);
}

/* ---------- 종목 공시 (오늘의 DART에서 종목명 필터) ---------- */
function renderStockDart(it){
  var box = $("#anDc"), sub = $("#anDcSub");
  box.innerHTML = '<div style="color:var(--tx3)">공시를 불러오는 중…</div>';
  var link = '<a href="' + dartSearchUrl(it.name) + '" target="_blank" rel="noopener">DART에서 ' +
             esc(it.name) + ' 전체 공시 검색 →</a>';
  RSS.get("dart", DART_RSS).then(function(r){
    if(AN.sel !== it) return;
    var mine = r.items.map(parseDart).filter(function(d){
      return d.comp.indexOf(it.name) >= 0 || d.rpt.indexOf(it.name) >= 0;
    });
    sub.textContent = "오늘 " + mine.length + "건";
    box.innerHTML = (mine.length
      ? '<ul style="margin:0;padding:0">' + mine.slice(0,10).map(function(d){
          return '<li style="list-style:none;border-bottom:1px solid var(--line);padding:4px 0">' +
            '<a href="' + esc(d.link) + '" target="_blank" rel="noopener">' + esc(d.rpt) + '</a>' +
            '<div style="font-size:10px;color:var(--tx3)">' + esc(d.comp) + " · " + esc(relTime(d.at)) + '</div></li>';
        }).join("") + "</ul>"
      : '<div style="color:var(--tx3);margin-bottom:7px">오늘 접수된 공시가 없습니다. ' +
        'DART는 당일 공시만 제공하므로 주말·공휴일에는 비어 있을 수 있습니다.</div>') +
      '<div class="note" style="margin-top:7px">' + link + '</div>';
  }).catch(function(e){
    if(AN.sel !== it) return;
    sub.innerHTML = '<span class="stalebadge">실패</span>';
    box.innerHTML = '<div class="note">공시를 불러오지 못했습니다 (' + esc(e.message) + ').<br>' + link + '</div>';
  });
}
