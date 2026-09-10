/* =========================================================================
   스크리너 — 필터 / 프리셋 / 심층분석 / 컬럼선택 / CSV / 트리맵 뷰
   ========================================================================= */

/* 컬럼 정의. deep:true 는 심층 분석으로만 채워짐 */
const COLS = [
  { k:"name",     t:"종목",       type:"s", al:"l", def:true,  csv:true },
  { k:"industry", t:"업종",       type:"s", al:"l", def:false },
  { k:"market",   t:"시장",       type:"s", al:"c", def:false },
  { k:"price",    t:"현재가",     f:"int",  def:true },
  { k:"chg",      t:"전일대비",   f:"sgn",  color:true, def:false },
  { k:"pct",      t:"등락률",     f:"pct",  color:true, def:true },
  { k:"amt",      t:"거래대금",   f:"big",  def:true },
  { k:"vol",      t:"거래량",     f:"big",  def:false },
  { k:"capE",     t:"시총(억)",   f:"int",  def:true },
  { k:"per",      t:"PER",        f:"f2",   def:true },
  { k:"fper",     t:"선행PER",    f:"f2",   def:false },
  { k:"pbr",      t:"PBR",        f:"f2",   def:true },
  { k:"divy",     t:"배당%",      f:"f2",   def:true },
  { k:"eps",      t:"EPS",        f:"int",  def:false },
  { k:"bps",      t:"BPS",        f:"int",  def:false },
  { k:"gap",      t:"갭%",        f:"pct",  color:true, def:false },
  { k:"range",    t:"변동폭%",    f:"f2",   def:false },
  { k:"pos",      t:"고저위치%",  f:"f0",   def:false },
  { k:"ulNear",   t:"상한근접%",  f:"f1",   def:false },
  { k:"turn",     t:"회전율%",    f:"f2",   def:false },
  { k:"rsi",      t:"RSI",        f:"f0",   def:false, deep:true },
  { k:"sep20",    t:"SMA20이격",  f:"pct",  color:true, def:false, deep:true },
  { k:"sep60",    t:"SMA60이격",  f:"pct",  color:true, def:false, deep:true },
  { k:"sep120",   t:"SMA120이격", f:"pct",  color:true, def:false, deep:true },
  { k:"pos52",    t:"52주위치%",  f:"f0",   def:false, deep:true },
  { k:"volx",     t:"거래량배율", f:"f2",   def:false, deep:true },
  { k:"gc",       t:"골든크로스", f:"bool", def:false, deep:true },
  { k:"pw",       t:"1주%",      f:"pct",  color:true, def:false, deep:true },
  { k:"pm",       t:"1개월%",    f:"pct",  color:true, def:false, deep:true },
  { k:"pytd",     t:"YTD%",      f:"pct",  color:true, def:false, deep:true },
  { k:"nearHi",   t:"신고가근접", f:"f1",   def:false, deep:true },
  { k:"nearLo",   t:"신저가근접", f:"f1",   def:false, deep:true },
  { k:"atr",      t:"ATR(14)",   f:"f0",   def:false, deep:true },
  { k:"atrp",     t:"ATR%",      f:"f2",   def:false, deep:true },
  { k:"vol20",    t:"변동성%",   f:"f1",   def:false, deep:true },
  /* 증권사 리포트 (09_reports.js 의 rpAnnotate 가 채운다) */
  { k:"rep1m",    t:"리포트(1M)", f:"f0",  def:false },
  { k:"repGap",   t:"컨센 괴리율", f:"pct", color:true, def:false }
];

/* 컬럼 프리셋 뷰 (핀비즈 Overview/Valuation/Performance/Technical) */
const COL_VIEWS = {
  overview:{ t:"개요", cols:["name","industry","market","price","pct","amt","capE","per","pbr","divy"] },
  value:   { t:"가치", cols:["name","price","capE","per","fper","pbr","divy","eps","bps","turn"] },
  perf:    { t:"성과", cols:["name","price","pct","pw","pm","pytd","pos52","nearHi","nearLo","amt"] },
  tech:    { t:"기술", cols:["name","price","pct","rsi","sep20","sep60","sep120","atrp","vol20","volx","gc","pos"] }
};
const COL_BY_K = {};
COLS.forEach(function(c){ COL_BY_K[c.k] = c; });
const DEFAULT_COLS = COLS.filter(function(c){ return c.def; }).map(function(c){ return c.k; });

/* 필터 정의. 프리셋 값은 "min:max" (빈쪽은 무제한) */
const FILTERS = [
  { k:"market", t:"시장", kind:"enum",
    opts:[["","전체"],["KOSPI","코스피"],["KOSDAQ","코스닥"]] },
  { k:"sector", t:"업종", kind:"enum", opts:null },
  { k:"capE", t:"시가총액(억)", p:[["10000:","대형 1조↑"],["3000:10000","중형 3천억~1조"],[":3000","소형 3천억↓"]] },
  { k:"price", t:"주가(원)", p:[[":1000","1천원↓"],["1000:10000","1천~1만"],["10000:50000","1만~5만"],["50000:","5만↑"]] },
  { k:"pct", t:"등락률%", p:[["3:","+3%↑"],["5:","+5%↑"],["0:","상승"],[":0","하락"],[":-3","-3%↓"],[":-5","-5%↓"]] },
  { k:"amtE", t:"거래대금(억)", p:[["100:","100억↑"],["500:","500억↑"],["1000:","1천억↑"]] },
  { k:"per", t:"PER", p:[[":10","저평가 <10"],["10:20","보통 10~20"],["20:","고평가 >20"]] },
  { k:"fper", t:"선행PER", p:[[":10","<10"],["10:20","10~20"],["20:",">20"]] },
  { k:"pbr", t:"PBR", p:[[":1","1배↓"],["1:2","1~2배"],["2:","2배↑"]] },
  { k:"divy", t:"배당수익률%", p:[["1:","1%↑"],["3:","3%↑"],["5:","5%↑"]] },
  { k:"eps", t:"EPS", p:[["0:","흑자"],[":0","적자"]] },
  { k:"bps", t:"BPS", p:[] },
  { k:"gap", t:"갭%", p:[["2:","갭상승 2%↑"],[":-2","갭하락 -2%↓"]] },
  { k:"range", t:"당일 변동폭%", p:[["5:","5%↑"],["10:","10%↑"]] },
  { k:"pos", t:"당일 고저위치%", p:[["90:","고가권 90↑"],[":10","저가권 10↓"]] },
  { k:"ulNear", t:"상한가 근접%", p:[["95:","임박 95↑"],["90:","90↑"]] },
  { k:"turn", t:"회전율%", p:[["2:","2%↑"],["5:","5%↑"],["10:","10%↑"]] },
  { k:"rsi", t:"RSI(14)", deep:true, p:[["70:","과열 70↑"],[":30","침체 30↓"],["30:70","중립"]] },
  { k:"sep20", t:"SMA20 이격%", deep:true, p:[["0:","정배열"],[":0","역배열"]] },
  { k:"sep60", t:"SMA60 이격%", deep:true, p:[["0:","위"],[":0","아래"]] },
  { k:"pos52", t:"52주 위치%", deep:true, p:[["90:","신고가권 90↑"],[":10","신저가권 10↓"]] },
  { k:"volx", t:"거래량 배율", deep:true, p:[["2:","2배↑"],["3:","3배↑"]] },
  { k:"gc", t:"골든크로스", kind:"enum", deep:true, opts:[["","전체"],["1","최근 발생"]] },
  { k:"pw", t:"1주 수익률%", deep:true, p:[["5:","+5%↑"],[":-5","-5%↓"]] },
  { k:"pm", t:"1개월 수익률%", deep:true, p:[["10:","+10%↑"],[":-10","-10%↓"]] },
  { k:"pytd", t:"YTD 수익률%", deep:true, p:[["0:","플러스"],[":0","마이너스"]] },
  { k:"nearHi", t:"52주 신고가 근접%", deep:true, p:[[":5","5% 이내"],[":10","10% 이내"]] },
  { k:"nearLo", t:"52주 신저가 근접%", deep:true, p:[[":5","5% 이내"],[":10","10% 이내"]] },
  { k:"atrp", t:"ATR%", deep:true, p:[["3:","3%↑"],["5:","5%↑"]] },
  { k:"vol20", t:"변동성%(연율)", deep:true, p:[["40:","40%↑"],[":20","20%↓"]] }
];

/* 내장 스크린 프리셋 */
const BUILTIN = [
  { name:"저PER 고배당", fs:{ per:":10", divy:"3:" } },
  { name:"대형주 급등", fs:{ capE:"10000:", pct:"3:" } },
  { name:"거래 폭발", fs:{ turn:"5:", pct:"0:" }, sort:{ key:"turn", dir:-1 } },
  { name:"상한가 임박", fs:{ ulNear:"95:" } },
  { name:"낙폭 과대", fs:{ pct:":-5", capE:"3000:" } },
  { name:"당일 고가권 마감", fs:{ pos:"90:", amtE:"100:" } },
  { name:"Top Gainers", fs:{}, sort:{ key:"pct", dir:-1 } },
  { name:"Top Losers", fs:{}, sort:{ key:"pct", dir:1 } },
  { name:"52주 신고가 근접", fs:{ nearHi:":5" }, sort:{ key:"nearHi", dir:1 }, deep:true,
    cols:COL_VIEWS.perf.cols },
  { name:"52주 신저가 근접", fs:{ nearLo:":5" }, sort:{ key:"nearLo", dir:1 }, deep:true,
    cols:COL_VIEWS.perf.cols }
];

let FS = {};                                   // 필터 상태 {key: "min:max" | 값}
let scrSort = { key:"pct", dir:-1 };
let scrView = "table";
let scanning = false, deepRunning = false;
let scrSelected = {};                          // code -> true
let lastList = [];

function activeCols(){
  var c = (S.cols && S.cols.length) ? S.cols : DEFAULT_COLS;
  return c.filter(function(k){ return COL_BY_K[k]; });
}

/* ---------- 필터 UI ---------- */
function buildFilterUI(){
  var g = $("#fgrid");
  g.innerHTML = FILTERS.map(function(f){
    var opts;
    if(f.kind === "enum"){
      var list = f.opts || [["","전체"]].concat(SECTORS.map(function(s){ return [s, s]; }));
      opts = list.map(function(o){ return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join("");
    }else{
      opts = '<option value="">전체</option>' +
        (f.p||[]).map(function(o){ return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join("") +
        '<option value="custom">직접입력…</option>';
    }
    return '<div class="fcell" data-k="' + f.k + '">' +
      '<div class="fk">' + esc(f.t) + (f.deep ? ' <span class="deep">(심층)</span>' : "") + '</div>' +
      '<select data-k="' + f.k + '">' + opts + '</select>' +
      (f.kind === "enum" ? "" :
        '<div class="fmm hide"><input type="number" step="any" placeholder="min" data-mm="min" data-k="' + f.k + '">' +
        '<input type="number" step="any" placeholder="max" data-mm="max" data-k="' + f.k + '"></div>') +
      '</div>';
  }).join("");

  g.addEventListener("change", function(e){
    var k = e.target.dataset.k;
    if(!k) return;
    var cell = e.target.closest(".fcell");
    if(e.target.tagName === "SELECT"){
      if(e.target.value === "custom"){
        $(".fmm", cell).classList.remove("hide");
        FS[k] = readCustom(cell, k);
      }else{
        var mm = $(".fmm", cell);
        if(mm) mm.classList.add("hide");
        if(e.target.value) FS[k] = e.target.value; else delete FS[k];
      }
    }else{
      FS[k] = readCustom(cell, k);
      if(FS[k] === ":") delete FS[k];
    }
    markCell(cell, k);
    applyFilter();
  });
}
function readCustom(cell, k){
  var mn = $('input[data-mm="min"]', cell), mx = $('input[data-mm="max"]', cell);
  return (mn ? mn.value : "") + ":" + (mx ? mx.value : "");
}
function markCell(cell, k){ cell.classList.toggle("on", FS[k] !== undefined && FS[k] !== ""); }

/* FS -> UI 반영 */
function syncFilterUI(){
  $$("#fgrid .fcell").forEach(function(cell){
    var k = cell.dataset.k, sel = $("select", cell), mm = $(".fmm", cell);
    var v = FS[k];
    if(v === undefined || v === ""){
      sel.value = ""; if(mm) mm.classList.add("hide");
    }else{
      var opt = Array.prototype.some.call(sel.options, function(o){ return o.value === v; });
      if(opt){ sel.value = v; if(mm) mm.classList.add("hide"); }
      else if(mm){
        sel.value = "custom"; mm.classList.remove("hide");
        var p = String(v).split(":");
        $('input[data-mm="min"]', mm).value = p[0] || "";
        $('input[data-mm="max"]', mm).value = p[1] || "";
      }
    }
    markCell(cell, k);
  });
}

function passFilter(q){
  for(var k in FS){
    var v = FS[k];
    if(v === undefined || v === "") continue;
    var f = FILTERS.filter(function(x){ return x.k === k; })[0];
    if(f && f.kind === "enum"){
      if(k === "gc"){ if(q.gc !== 1) return false; }
      else if(String(q[k]) !== v) return false;
      continue;
    }
    var parts = String(v).split(":");
    var mn = parts[0] === "" ? null : +parts[0];
    var mx = parts[1] === "" ? null : +parts[1];
    var val = q[k];
    if(val === null || val === undefined || isNaN(val)) return false;
    if(mn !== null && val < mn) return false;
    if(mx !== null && val > mx) return false;
  }
  return true;
}

function sortList(list){
  var k = scrSort.key, dir = scrSort.dir;
  return list.sort(function(a, b){
    var av = a[k], bv = b[k];
    if(av === null || av === undefined || (typeof av === "number" && isNaN(av))) return 1;
    if(bv === null || bv === undefined || (typeof bv === "number" && isNaN(bv))) return -1;
    if(typeof av === "string") return av.localeCompare(bv, "ko")*dir;
    return (av - bv)*dir;
  });
}

function applyFilter(){
  rpAnnotate(SCREEN);                       // 리포트(1M)·컨센 괴리율 컬럼 값 채우기
  var list = sortList(SCREEN.filter(statFilter).filter(passFilter));
  lastList = list;
  renderScrHead();
  if(scrView === "table") renderScreen(list);
  else if(scrView === "tree") renderScrTree(list);
  else renderScrChart(list);
  renderScrSum(list);
}

function renderScrSum(list){
  var deepN = list.filter(function(q){ return q.rsi !== undefined && q.rsi !== null; }).length;
  var pool = SCREEN.filter(statFilter).length;
  $("#scrSum").innerHTML =
    "조건 충족 <b>" + list.length + "</b>종목 / " + statScopeTag() + " <b>" + fmt(pool) + "</b>종목" +
    (S.inclEtf ? "" : ' <span style="color:var(--tx3)">(ETF·ETN 제외)</span>') +
    (SCAN_AT ? " · 스캔 " + esc(SCAN_AT) : "") +
    (deepN ? " · 심층분석 " + deepN + "종목" : "") +
    (Object.keys(scrSelected).length ? " · 선택 " + Object.keys(scrSelected).length : "");
}

/* ---------- 값 포맷 ---------- */
function cellVal(q, c){
  var v = q[c.k];
  if(c.type === "s"){
    if(c.k === "market") return v === "KOSDAQ" ? "코스닥" : "코스피";
    return esc(v || "");
  }
  if(v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "-";
  switch(c.f){
    case "int": return fmt(Math.round(v));
    case "sgn": return fmtSigned(v);
    case "pct": return fmtPct(v);
    case "big": return fmtBig(v);
    case "f0":  return v.toFixed(0);
    case "f1":  return v.toFixed(1);
    case "f2":  return v.toFixed(2);
    case "bool":return v ? "●" : "-";
    default:    return String(v);
  }
}
function cellCls(q, c){
  if(c.color) return dirCls(q[c.k]);
  if(c.k === "rsi" && typeof q.rsi === "number") return q.rsi > 70 ? "hot" : (q.rsi < 30 ? "cold" : "");
  if(c.k === "ulNear" && q.ulNear >= 95) return "hot";
  if(c.k === "pos52" && typeof q.pos52 === "number") return q.pos52 >= 90 ? "hot" : (q.pos52 <= 10 ? "cold" : "");
  if(c.k === "gc" && q.gc) return "up";
  if(c.k === "nearHi" && typeof q.nearHi === "number" && q.nearHi <= 5) return "hot";
  if(c.k === "nearLo" && typeof q.nearLo === "number" && q.nearLo <= 5) return "cold";
  return "";
}

function renderScrHead(){
  var cols = activeCols();
  $("#scrHead").innerHTML =
    '<th class="c"><input type="checkbox" id="scrAll" title="전체 선택"></th><th class="c">#</th>' +
    cols.map(function(k){
      var c = COL_BY_K[k];
      return '<th class="srt ' + (c.al === "l" ? "l " : (c.al === "c" ? "c " : "")) +
             (scrSort.key === k ? "on" : "") + '" data-s="' + k + '">' + esc(c.t) +
             (scrSort.key === k ? (scrSort.dir < 0 ? " ▼" : " ▲") : "") + '</th>';
    }).join("") + '<th class="c">관심</th>';
}

function renderScreen(list){
  var tb = $("#scrBody"); tb.innerHTML = "";
  var cols = activeCols();
  $("#scrEmpty").style.display = list.length ? "none" : "block";
  $("#scrEmpty").textContent = SCREEN.length
    ? "조건에 맞는 종목이 없습니다." : "스캔 결과가 없습니다. 전체 스캔을 실행하세요.";

  list.slice(0, 300).forEach(function(q, i){
    var tr = document.createElement("tr");
    tr.className = "clk";
    tr.innerHTML =
      '<td class="c"><input type="checkbox" class="selbox" data-cd="' + q.code + '"' +
        (scrSelected[q.code] ? " checked" : "") + '></td>' +
      '<td class="c" style="color:var(--tx3)">' + (i+1) + '</td>' +
      cols.map(function(k){
        var c = COL_BY_K[k];
        var cls = cellCls(q, c), al = c.al === "l" ? "l " : (c.al === "c" ? "c " : "num ");
        var extra = (k === "name")
          ? '<span class="tk" data-hv="' + esc(q.code) + '">' + esc(q.name) + '</span>'
          : cellVal(q, c);
        if(k === "industry" || k === "market") extra = '<span style="color:var(--tx3);font-size:10.5px">' + cellVal(q, c) + '</span>';
        return '<td class="' + al + cls + '">' + extra + '</td>';
      }).join("") + '<td class="c"></td>';
    var b = document.createElement("button");
    b.className = "btn xs"; b.textContent = "+"; b.title = "관심종목 추가";
    b.onclick = function(ev){ ev.stopPropagation(); addWatch({ mk:"KR", code:q.code, name:q.name }); };
    tr.lastChild.appendChild(b);
    tr.onclick = function(ev){
      if(ev.target.classList.contains("selbox")) return;
      selectStock({ mk:"KR", code:q.code, name:q.name }); showTab("anal");
    };
    tb.appendChild(tr);
  });

  $$(".selbox", tb).forEach(function(cb){
    cb.onchange = function(){
      if(cb.checked) scrSelected[cb.dataset.cd] = true; else delete scrSelected[cb.dataset.cd];
      renderScrSum(lastList);
    };
  });
  var all = $("#scrAll");
  if(all) all.onchange = function(){
    list.slice(0,300).forEach(function(q){
      if(all.checked) scrSelected[q.code] = true; else delete scrSelected[q.code];
    });
    renderScreen(list); renderScrSum(list);
  };
}

function renderScrTree(list){
  $("#scrEmpty").style.display = list.length ? "none" : "block";
  var nodes = list.map(function(q){
    return { code:q.code, name:q.name, cap:q.capE || 0, sector:q.sector || "기타", pct:q.pct };
  });
  renderTreemapInto($("#scrTmap"), nodes);
}

/* ---------- 차트 그리드 뷰 (상위 20종목, 3개월 일봉) ---------- */
let cgRunning = false;
function drawCard(cv, bars){
  var ctx = cv.getContext("2d");
  var dpr = 2, W = cv.width/dpr, H = cv.height/dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  if(!bars || bars.length < 2){
    ctx.fillStyle = cssVar("--tx3"); ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("…", W/2, H/2);
    return;
  }
  var lo = Infinity, hi = -Infinity;
  bars.forEach(function(b){ if(b.l < lo) lo = b.l; if(b.h > hi) hi = b.h; });
  var pad = (hi-lo)*0.08 || 1; lo -= pad; hi += pad;
  var step = W/bars.length, bw = Math.max(1, step*0.62);
  var Y = function(v){ return H - 1 - (v-lo)/(hi-lo)*(H-2); };
  var up = cssVar("--up"), dn = cssVar("--down");
  bars.forEach(function(b, i){
    var x = i*step + step/2, col = b.c >= b.o ? up : dn;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
    var yo = Y(b.o), yc = Y(b.c);
    ctx.fillRect(x-bw/2, Math.min(yo,yc), bw, Math.max(1, Math.abs(yc-yo)));
  });
}
function renderScrChart(list){
  var box = $("#scrChart");
  var top = list.slice(0, 20);
  $("#scrEmpty").style.display = top.length ? "none" : "block";
  box.innerHTML = top.map(function(q){
    return '<div class="ccard" data-cd="' + q.code + '">' +
      '<div class="ch"><span class="tk" data-hv="' + esc(q.code) + '">' + esc(q.name) + '</span>' +
      '<span class="' + dirCls(q.pct) + '">' + fmtPct(q.pct) + '</span></div>' +
      '<canvas width="440" height="150" style="height:75px"></canvas></div>';
  }).join("");
  $$(".ccard", box).forEach(function(card){
    var cd = card.dataset.cd;
    drawCard($("canvas", card), (HIST[cd] || {}).bars);
    card.onclick = function(){
      var q = QUOTES["KR:" + cd] || UNI_BY_KEY["KR:" + cd];
      selectStock({ mk:"KR", code:cd, name:q ? q.name : cd });
      showTab("anal");
    };
  });
  /* 없는 이력만 온디맨드 순차 로드 */
  var need = top.filter(function(q){ return !HIST[q.code]; });
  if(!need.length || cgRunning){
    $("#cgMsg").textContent = top.length + "종목 · 3개월 일봉";
    $("#cgBar").style.width = "100%";
    return;
  }
  cgRunning = true;
  var done = 0, seq = Promise.resolve();
  need.forEach(function(q){
    seq = seq.then(function(){
      return loadHist(q.code, 3).catch(function(){
        HIST[q.code] = { bars:[], months:3, at:Date.now() };
      }).then(function(){
        done++;
        $("#cgBar").style.width = Math.round(done/need.length*100) + "%";
        $("#cgMsg").textContent = "차트 불러오는 중… " + done + "/" + need.length;
        var card = $('.ccard[data-cd="' + q.code + '"]', box);
        if(card) drawCard($("canvas", card), (HIST[q.code] || {}).bars);
      });
    });
  });
  seq.then(function(){
    cgRunning = false;
    $("#cgMsg").textContent = top.length + "종목 · 3개월 일봉 · " + nowTime();
  });
}

function setView(v){
  scrView = v;
  $$("#segView button").forEach(function(b){ b.classList.toggle("act", b.dataset.v === v); });
  $("#scrTableWrap").classList.toggle("hide", v !== "table");
  $("#scrTmap").classList.toggle("hide", v !== "tree");
  $("#scrChartWrap").classList.toggle("hide", v !== "chart");
  applyFilter();
}
function setColView(v){
  var cv = COL_VIEWS[v];
  if(!cv) return;
  S.cols = cv.cols.slice(); save();
  $$("#segColView button").forEach(function(b){ b.classList.toggle("act", b.dataset.cv === v); });
  buildColPicker(); applyFilter();
  var needDeep = cv.cols.some(function(k){ return COL_BY_K[k] && COL_BY_K[k].deep; });
  if(needDeep && !Object.keys(DEEP).length)
    toast("이 뷰의 지표는 '심층 분석 (상위 50)'을 실행해야 채워집니다.");
}

/* ---------- 스캔 ----------
   범위: top500(시총 상위 500, 약 1분) / all(전 종목, 약 4분). 선택은 localStorage 저장. */
function scanCodes(){
  var list = KR_UNIVERSE;
  if(S.scanScope !== "all")
    list = list.slice().sort(function(a, b){ return b.cap - a.cap; }).slice(0, SCAN_TOP_N);
  return list.map(function(u){ return u.code; });
}
function scopeLabel(scope, n){
  return scope === "all" ? ("전체 " + fmt(n) + "종목 기준") : ("상위 " + fmt(n) + "종목 기준");
}
function setScanIndicator(txt){
  var el = $("#scanInd");
  if(!el) return;
  el.textContent = txt || "";
  el.classList.toggle("hide", !txt);
}

function runScan(){
  if(scanning) return;
  scanning = true;
  $("#scrScan").disabled = true;
  var scope = S.scanScope;
  SCREEN = [];
  var codes = scanCodes();
  var chunks = [], retry = [];
  for(var i=0;i<codes.length;i+=40) chunks.push(codes.slice(i, i+40));
  var done = 0, failed = 0, total = chunks.length;

  function finish(){
    scanning = false;
    $("#scrScan").disabled = false;
    $("#scrBar").style.width = "100%";
    SCAN_AT_MS = Date.now();
    SCAN_AT = new Date().toLocaleString("ko-KR");
    SCAN_SCOPE = scope;
    SCAN_LABEL = scopeLabel(scope, SCREEN.length);
    $("#scrMsg").textContent = "스캔 완료 · " + SCREEN.length + "종목 (" +
      (scope === "all" ? "전체" : "상위 " + SCAN_TOP_N) + ")" +
      (failed ? " · " + failed + "청크 실패" : "") + " · " + nowTime();
    setScanIndicator("");
    cacheScan();
    applyFilter(); renderGauge(); renderSignals(); renderSectorPerf();
  }

  function step(){
    if(!chunks.length){
      if(retry.length){                       // 실패 청크 1회 재시도
        chunks = retry.slice(); retry = [];
        total = done + chunks.length;
        step(); return;
      }
      finish(); return;
    }
    var ch = chunks.shift();
    naverRealtime(ch, false).then(function(r){
      noteOk();
      Object.keys(r.items).forEach(function(cd){
        var q = krQuote(r.items[cd]);
        SCREEN.push(q); QUOTES["KR:" + cd] = q;
      });
    }).catch(function(e){
      failed++; noteFail(); retry.push(ch);
      console.warn("스크리너 청크 실패(재시도 예정):", e.message);
    }).then(function(){
      done++;
      var pct = Math.round(done/Math.max(total,1)*100);
      $("#scrBar").style.width = pct + "%";
      $("#scrMsg").textContent = "수집 중… " + done + "/" + total + " 청크 · " + SCREEN.length + "종목";
      setScanIndicator("스캔 " + pct + "%");
      /* 청크가 도착하는 대로 소비처를 점진 갱신 (라벨도 진행 중 수치로 맞춘다) */
      if(done % 3 === 0){
        SCAN_LABEL = scopeLabel(scope, SCREEN.length) + " · 수집 중 " + pct + "%";
        applyFilter(); renderGauge(); renderSignals(); renderSectorPerf();
      }
      step();
    });
  }
  $("#scrMsg").textContent = "수집 시작… (" + total + "청크)";
  setScanIndicator("스캔 0%");
  step();
}

/* 자동 스캔 판단: 신선도 + 장 마감 게이트 */
function shouldAutoScan(){
  if(!S.autoScan || scanning) return { go:false, why:"자동 스캔 꺼짐" };
  if(!SCREEN.length || !SCAN_AT_MS) return { go:true, why:"스캔 이력 없음" };
  if(SCAN_SCOPE !== S.scanScope) return { go:true, why:"스캔 범위 변경" };
  var age = Date.now() - SCAN_AT_MS;
  if(age < SCAN_FRESH_MS)
    return { go:false, why:"최근 " + Math.round(age/60000) + "분 전 스캔 — 캐시 사용" };
  if(!marketOpen().kr && SCAN_AT_MS >= lastMarketCloseEpoch())
    return { go:false, why:"장 마감 후 스캔본 — 시세 불변" };
  return { go:true, why:"갱신 필요" };
}
function maybeAutoScan(){
  var d = shouldAutoScan();
  if(d.go) runScan();
  else if(SCREEN.length) $("#scrMsg").textContent = "캐시 사용 중 (" + d.why + ") · " + (SCAN_AT || "");
  return d;
}

/* 스캔 결과 localStorage 캐시 */
/* 전 종목 스캔은 4천 행이라 그대로 넣으면 localStorage 용량(보통 5MB)에 부담이 된다.
   화면에서 실제로 쓰는 필드만 남겨 저장하고, 복원 시 상수 필드를 되채운다. */
const SCAN_KEEP = ["code","name","market","sector","industry","price","chg","pct","amt","vol",
  "capE","capW","per","fper","pbr","divy","eps","bps","gap","range","pos","ulNear","turn",
  "rsi","sep20","sep60","sep120","pos52","nearHi","nearLo","pw","pm","pytd","atr","atrp","vol20","volx","gc"];
function slimRow(q){
  var o = {};
  for(var i=0;i<SCAN_KEEP.length;i++){
    var k = SCAN_KEEP[i];
    if(q[k] !== undefined && q[k] !== null) o[k] = q[k];
  }
  return o;
}
function cacheScan(){
  try{
    localStorage.setItem(LS_SCAN, JSON.stringify({
      at:SCAN_AT, atMs:SCAN_AT_MS, scope:SCAN_SCOPE, label:SCAN_LABEL,
      rows:SCREEN.map(slimRow)
    }));
  }catch(e){
    console.warn("스캔 캐시 저장 실패(용량 초과 가능):", e.message);
    try{ localStorage.removeItem(LS_SCAN); }catch(e2){}
    toast("스캔 결과가 커서 캐시에 저장하지 못했습니다. 이번 세션에서는 정상 동작합니다.", "err");
  }
}
function restoreScan(){
  try{
    var raw = localStorage.getItem(LS_SCAN);
    if(!raw) return false;
    var o = JSON.parse(raw);
    if(!o || !o.rows || !o.rows.length) return false;
    SCREEN = o.rows;
    SCAN_AT = o.at;
    SCAN_AT_MS = o.atMs || 0;
    SCAN_SCOPE = o.scope || "top500";          // 구버전 캐시는 상위500 스캔으로 간주
    SCAN_LABEL = o.label || scopeLabel(SCAN_SCOPE, o.rows.length);
    SCREEN.forEach(function(q){
      q.mk = "KR"; q.ok = true; q.at = SCAN_AT_MS;   // 캐시에서 뺀 상수 필드 복원
      QUOTES["KR:" + q.code] = q;
      if(q.rsi !== undefined && q.rsi !== null){
        DEEP[q.code] = { rsi:q.rsi, sep20:q.sep20, sep60:q.sep60, sep120:q.sep120,
                         pos52:q.pos52, volx:q.volx, gc:q.gc };
      }
    });
    return true;
  }catch(e){ return false; }
}

/* ---------- 심층 분석 (상위 50) ---------- */
function runDeep(){
  if(deepRunning) return;
  if(!SCREEN.length){ toast("먼저 전체 스캔을 실행하세요.", "err"); return; }
  var cand = lastList.slice(0, 50);
  var need = cand.filter(function(q){ return q.rsi === undefined || q.rsi === null; });
  if(!need.length){ toast("이미 계산되어 있습니다 (상위 50)."); return; }

  deepRunning = true; $("#scrDeep").disabled = true;
  var done = 0;
  $("#scrMsg").textContent = "심층 분석 중… 0/" + need.length;
  var seq = Promise.resolve();
  need.forEach(function(q){
    seq = seq.then(function(){
      return loadHist(q.code, 15).then(function(bars){     // 120일선 + 52주 확보용
        var m = bars.length ? deepMetrics(bars, q.vol) : null;
        if(m){
          DEEP[q.code] = m;
          Object.keys(m).forEach(function(k){ q[k] = m[k]; });
        }else{ q.rsi = null; }
      }).catch(function(){ q.rsi = null; })
        .then(function(){
          done++;
          $("#scrBar").style.width = Math.round(done/need.length*100) + "%";
          $("#scrMsg").textContent = "심층 분석 중… " + done + "/" + need.length + " (상위 50개만 조회)";
        });
    });
  });
  seq.then(function(){
    deepRunning = false; $("#scrDeep").disabled = false;
    $("#scrMsg").textContent = "심층 분석 완료 · " + need.length + "종목 · " + nowTime();
    cacheScan(); applyFilter();
    toast("심층 분석 완료 — RSI·이격도·52주위치·거래량배율·골든크로스 컬럼을 사용할 수 있습니다.", "ok");
  });
}

/* ---------- 컬럼 선택 ---------- */
function buildColPicker(){
  var cur = activeCols();
  $("#colpick").innerHTML = COLS.map(function(c){
    return '<label><input type="checkbox" data-c="' + c.k + '"' +
           (cur.indexOf(c.k) >= 0 ? " checked" : "") + '>' + esc(c.t) +
           (c.deep ? ' <span style="color:var(--tx3)">(심층)</span>' : "") + '</label>';
  }).join("");
  $("#colpick").onchange = function(){
    var sel = $$("#colpick input:checked").map(function(i){ return i.dataset.c; });
    if(!sel.length){ toast("컬럼을 최소 1개는 선택하세요.", "err"); return; }
    S.cols = COLS.filter(function(c){ return sel.indexOf(c.k) >= 0; }).map(function(c){ return c.k; });
    save(); applyFilter();
  };
}

/* ---------- CSV ---------- */
function exportCsv(){
  if(!lastList.length){ toast("내보낼 결과가 없습니다.", "err"); return; }
  var cols = activeCols();
  var head = ["코드"].concat(cols.map(function(k){ return COL_BY_K[k].t; }));
  var lines = [head.join(",")];
  lastList.forEach(function(q){
    var row = [q.code].concat(cols.map(function(k){
      var c = COL_BY_K[k], v = q[k];
      if(c.type === "s"){
        if(k === "market") v = (v === "KOSDAQ" ? "코스닥" : "코스피");
        return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      }
      if(v === null || v === undefined || isNaN(v)) return "";
      return (typeof v === "number") ? (Math.round(v*10000)/10000) : v;
    }));
    lines.push(row.join(","));
  });
  var blob = new Blob(["﻿" + lines.join("\r\n")], { type:"text/csv;charset=utf-8;" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "screener-" + todayStr() + ".csv";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  toast(lastList.length + "종목을 CSV로 내보냈습니다 (UTF-8 BOM).", "ok");
}

/* ---------- 저장된 스크린 ---------- */
function renderScreens(){
  var sel = $("#savedScreens");
  var opts = ['<option value="">— 스크린 불러오기 —</option>'];
  opts.push('<optgroup label="기본 제공">');
  BUILTIN.forEach(function(b, i){ opts.push('<option value="b' + i + '">' + esc(b.name) + '</option>'); });
  opts.push("</optgroup>");
  if(S.screens.length){
    opts.push('<optgroup label="내 스크린">');
    S.screens.forEach(function(s, i){ opts.push('<option value="u' + i + '">' + esc(s.name) + '</option>'); });
    opts.push("</optgroup>");
  }
  sel.innerHTML = opts.join("");
}
function loadScreen(v){
  if(!v) return;
  var s = v[0] === "b" ? BUILTIN[+v.slice(1)] : S.screens[+v.slice(1)];
  if(!s) return;
  FS = JSON.parse(JSON.stringify(s.fs || {}));
  if(s.sort) scrSort = JSON.parse(JSON.stringify(s.sort));
  if(s.cols){ S.cols = s.cols.slice(); save(); buildColPicker(); }
  syncFilterUI(); applyFilter();
  var deepNeed = Object.keys(FS).some(function(k){
    var f = FILTERS.filter(function(x){ return x.k === k; })[0];
    return f && f.deep;
  });
  toast("스크린 적용: " + s.name + (deepNeed ? " — 심층 지표 필터가 있으니 '심층 분석'을 먼저 실행하세요." : ""),
        deepNeed ? "err" : "ok");
}
function saveScreen(){
  var name = prompt("스크린 이름을 입력하세요", "내 스크린 " + (S.screens.length+1));
  if(!name) return;
  S.screens.push({ name:name.trim(), fs:JSON.parse(JSON.stringify(FS)),
                   sort:JSON.parse(JSON.stringify(scrSort)), cols:activeCols() });
  save(); renderScreens();
  toast("스크린 저장됨: " + name, "ok");
}
function deleteScreen(){
  var v = $("#savedScreens").value;
  if(!v || v[0] !== "u"){ toast("삭제할 '내 스크린'을 선택하세요.", "err"); return; }
  var i = +v.slice(1);
  if(!confirm("'" + S.screens[i].name + "' 스크린을 삭제할까요?")) return;
  S.screens.splice(i, 1); save(); renderScreens();
  toast("삭제되었습니다.", "ok");
}

/* ---------- 프리셋 버튼 ---------- */
function buildPresetBtns(){
  $("#presets").innerHTML =
    '<button data-b="">전체</button>' +
    BUILTIN.map(function(b, i){ return '<button data-b="b' + i + '">' + esc(b.name) + '</button>'; }).join("");
}

/* ---------- 장중 자동 재스캔 ---------- */
let autoScanTimer = null;
function syncAutoScan(){
  if(autoScanTimer){ clearInterval(autoScanTimer); autoScanTimer = null; }
  $("#autoScan").checked = !!S.autoScan;
  $("#inclEtf").checked = !!S.inclEtf;
  $$("#segScope button").forEach(function(b){ b.classList.toggle("act", b.dataset.s === S.scanScope); });
  if(S.autoScan){
    autoScanTimer = setInterval(function(){       // 장중 주기 재스캔
      if(marketOpen().kr && !scanning) runScan();
    }, 5*60*1000);
  }
}
