/* =========================================================================
   증권사 리포트 — 리포트 탭 + 대시보드·종목분석 연동
   데이터: data/reports.json · data/meta.json (scraper/ 수집 결과)
   시세·유니버스·트리맵·테마는 앱의 기존 것을 그대로 쓴다(중복 구현 없음).
   ========================================================================= */

const RP_LS = "rr:filters:v1";                       // stock-helper 키와 분리
const RP_RATINGS = ["BUY","HOLD","SELL","NR"];
const RP_UNCL = "미분류";
const RP_PAGE = 500;                                 // 표를 한 번에 그리는 행 수
const RP_VIEWS = ["reports","stocks","sectors","heat"];
const RP_DATA_IV = 300000;                           // 리포트 갱신 확인 주기 (5분)
const RP_LIVE_MAX = 120;                             // 한 번에 시세를 붙이는 종목 수 상한
/* 대분류. scraper/sectors.py 의 SECTOR_ORDER 와 같은 순서다 (네이버 업종 대분류와 다름) */
const RP_SECTORS = ["IT","헬스케어","금융","산업재","경기소비재","필수소비재",
                    "소재","에너지","유틸리티","통신·미디어","기타"];

let RPT = [];                    // 리포트 원본
let RMETA = null;
let RP_READY = false;
let RP_LIMIT = RP_PAGE;
let RP_BROKERS = [];
let RP_SECLIST = [];
let rpOpenSum = {};              // 펼쳐 둔 요약 (id)
let rpOpenSec = {};              // 펼쳐 둔 대분류 (업종별 탭)
let rpStockIndex = [];           // 자동완성 후보 (코드 기준 유일, 리포트 수 내림차순)
let rpStockByCode = {};
let rpByCode = {};               // code -> 리포트[] (최신순) — 종목분석 패널용
let rpHeatByCode = {};
let rpAcItems = [], rpAcIndex = -1, rpAcOpen = false;
let rpDataTimer = null;

const RP = {
  period:"7",        // 1 | 3 | 7 | 30 | all
  ratings:[],        // 비어 있으면 전체
  changes:[],        // up | down | new. 비어 있으면 전체
  brokers:[],
  sectors:[],
  industry:"",       // 세부 업종 하나
  codes:[],          // 자동완성에서 고른 종목
  q:"",              // Enter 로 확정한 자유 텍스트
  view:"reports",
  sortKey:"date", sortDir:"desc",
  heatColor:"gap"    // gap | buy
};

/* ---------- 작은 도우미 ---------- */
function rpDebounce(fn, ms){
  var t;
  return function(){
    var args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(function(){ fn.apply(self, args); }, ms);
  };
}
function rpNorm(s){ return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, ""); }
/* 수집기가 제목 일부를 종목명에 섞어 넣는 경우가 있어 유니버스 이름을 우선한다 */
function rpName(code, fallback){
  var u = code ? UNI_BY_KEY["KR:" + code] : null;
  return u ? u.name : (fallback || code || "");
}
function rpTodayISO(){ return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10); }
function rpShiftISO(iso, days){
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}
function rpSave(){ try{ localStorage.setItem(RP_LS, JSON.stringify(RP)); }catch(e){} }
function rpLoadState(){
  try{
    var raw = localStorage.getItem(RP_LS);
    if(!raw) return;
    var o = JSON.parse(raw);
    if(!o || typeof o !== "object") return;
    for(var k in RP){ if(Object.prototype.hasOwnProperty.call(o, k)) RP[k] = o[k]; }
  }catch(e){}
}

/* ---------- 시세: 앱의 QUOTES(naverRealtime) 를 그대로 쓴다 ---------- */
function rpQuote(code){ return code ? QUOTES["KR:" + code] : null; }
function rpPrice(r){
  var q = rpQuote(r.code);
  return (q && q.ok && q.price > 0) ? q.price : r.price;
}
function rpLive(r){
  var q = rpQuote(r.code);
  return (q && q.ok && q.price > 0) ? q : null;
}
/* 목표가 대비 괴리율. 실시간가가 있으면 그 값으로 다시 계산한다 */
function rpGapOf(r){
  if(typeof r.target !== "number") return null;
  var p = rpPrice(r);
  if(!p) return (r.gap === null || r.gap === undefined) ? null : r.gap;
  return Math.round((r.target - p) / p * 10000) / 100;
}

/* 지금 시세를 붙일 종목 코드 — refreshAll() 이 기존 타이머로 함께 조회한다 */
function rpQuoteCodes(){
  if(!RP_READY || curTab !== "rep") return [];
  var rows = rpFiltered(), seen = {}, out = [], open = marketOpen().kr;
  for(var i=0;i<rows.length && out.length < RP_LIVE_MAX;i++){
    var c = rows[i].code;
    if(!c || seen[c]) continue;
    seen[c] = 1;
    if(!open && QUOTES["KR:" + c]) continue;   // 장외에는 최초 1회만
    out.push(c);
  }
  return out;
}

/* ---------- 데이터 적재 ---------- */
function rpFetchJson(path){
  return fetch(path, { cache:"no-store" }).then(function(r){
    if(!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  });
}
function rpLoad(){
  return Promise.all([
    rpFetchJson("data/reports.json"),
    rpFetchJson("data/meta.json").catch(function(){ return null; })
  ]).then(function(res){
    RPT = Array.isArray(res[0]) ? res[0] : [];
    RMETA = res[1];
    RP_READY = true;
    rpRebuild();
    rpShowNotice("");
    if(!RPT.length){
      rpShowNotice("수집된 리포트가 없습니다. <code>python scraper/collect.py --days 45</code> 를 먼저 실행하세요.");
      return;
    }
    rpBuildControls();
    rpRender();
    rpRenderToday();
    if(AN.sel) rpRenderAnal();
    if(SCREEN.length) applyFilter();          // 스크리너 리포트 컬럼 채우기
    if(!rpDataTimer) rpDataTimer = setInterval(rpCheckUpdate, RP_DATA_IV);
  }).catch(function(err){
    RP_READY = false;
    var isFile = location.protocol === "file:";
    rpShowNotice(
      "<b>리포트 데이터를 불러오지 못했습니다.</b><br>" +
      (isFile
        ? "<code>file://</code> 로 열면 보안 정책 때문에 JSON을 읽을 수 없습니다. " +
          "프로젝트 폴더에서 <code>python -m http.server 3491</code> 을 실행한 뒤 " +
          "<code>http://localhost:3491</code> 로 접속하세요."
        : "<code>data/reports.json</code> 을 읽을 수 없습니다. 수집을 먼저 실행했는지 확인하세요.<br>" +
          "<code>python scraper/collect.py --days 45</code>") +
      '<br><span style="color:var(--tx3)">' + esc(err && err.message ? err.message : err) + "</span>");
    console.warn("리포트 데이터 적재 실패:", err);
  });
}

/* 5분마다 meta 만 확인하고, 바뀐 경우에만 본문을 다시 받는다 */
function rpCheckUpdate(){
  if(document.hidden) return;
  rpFetchJson("data/meta.json").then(function(m){
    if(!m || !m.updated_at) return null;
    if(RMETA && RMETA.updated_at === m.updated_at) return null;
    return rpFetchJson("data/reports.json").then(function(list){
      if(!Array.isArray(list)) return;
      RMETA = m; RPT = list;
      rpRebuild();
      rpBuildControls();
      rpRenderKeep();
      rpRenderToday();
      if(AN.sel) rpRenderAnal();
    });
  }).catch(function(err){
    console.warn("리포트 갱신 확인 실패:", err && err.message ? err.message : err);
  });
}

function rpRebuild(){
  /* 증권사 */
  if(RMETA && Array.isArray(RMETA.brokers) && RMETA.brokers.length){
    RP_BROKERS = RMETA.brokers.slice();
  }else{
    var set = {};
    RPT.forEach(function(r){ if(r.broker) set[r.broker] = 1; });
    RP_BROKERS = Object.keys(set).sort(function(a,b){ return a.localeCompare(b, "ko"); });
  }
  RP.brokers = RP.brokers.filter(function(b){ return RP_BROKERS.indexOf(b) >= 0; });

  /* 대분류 */
  RP_SECLIST = RP_SECTORS.slice();
  for(var i=0;i<RPT.length;i++){ if(!RPT[i].sector){ RP_SECLIST.push(RP_UNCL); break; } }
  RP.sectors = RP.sectors.filter(function(s){ return RP_SECLIST.indexOf(s) >= 0; });

  /* 종목 색인 + 코드별 리포트 */
  var map = {}, byCode = {};
  for(var j=0;j<RPT.length;j++){
    var r = RPT[j];
    if(!r.code) continue;
    var s = map[r.code];
    if(!s) s = map[r.code] = { code:r.code, name:rpName(r.code, r.name), industry:"", n:0 };
    s.n++;
    if(r.industry) s.industry = r.industry;
    (byCode[r.code] = byCode[r.code] || []).push(r);
  }
  Object.keys(byCode).forEach(function(c){
    byCode[c].sort(function(a,b){ return String(b.date||"").localeCompare(String(a.date||"")); });
  });
  rpByCode = byCode;
  rpStockByCode = map;
  rpStockIndex = [];
  for(var code in map){
    var st = map[code];
    st.nameNorm = rpNorm(st.name);
    st.codeNorm = rpNorm(st.code);
    rpStockIndex.push(st);
  }
  rpStockIndex.sort(function(a,b){ return b.n - a.n || a.name.localeCompare(b.name, "ko"); });
}

/* ---------- 필터 ---------- */
function rpPeriodFloor(){
  if(RP.period === "all") return null;
  var days = parseInt(RP.period, 10);
  if(!days || days < 1) days = 1;
  // 데이터가 있는 최신일 기준 — 주말·휴장일에도 빈 화면이 되지 않게
  var base = (RMETA && RMETA.latest_date) ? RMETA.latest_date : rpTodayISO();
  var today = rpTodayISO();
  if(base > today) base = today;
  return rpShiftISO(base, -(days - 1));
}

/* opts.skipIndustry: 세부 업종 선택지를 셀 때만 쓴다 */
function rpFiltered(opts){
  opts = opts || {};
  var floor = rpPeriodFloor();
  var q = RP.q.trim().toLowerCase();
  var rs = RP.ratings, cs = RP.changes, bs = RP.brokers, cd = RP.codes;
  var ss = opts.skipSector ? [] : RP.sectors;
  var ind = opts.skipIndustry ? "" : RP.industry;
  var out = [];
  for(var i=0;i<RPT.length;i++){
    var r = RPT[i];
    if(cd.length && cd.indexOf(r.code) < 0) continue;
    if(floor && (r.date || "") < floor) continue;
    if(rs.length && rs.indexOf(r.rating) < 0) continue;
    if(cs.length && cs.indexOf(r.target_change) < 0) continue;
    if(bs.length && bs.indexOf(r.broker) < 0) continue;
    if(ss.length && ss.indexOf(r.sector || RP_UNCL) < 0) continue;
    if(ind && (r.industry || RP_UNCL) !== ind) continue;
    if(q){
      var hay = ((r.name||"") + " " + (r.code||"") + " " + (r.title||"") + " " +
                 (r.broker||"") + " " + (r.analyst||"")).toLowerCase();
      if(hay.indexOf(q) < 0) continue;
    }
    out.push(r);
  }
  return out;
}

function rpSortRows(rows, keys){
  var getter = keys[RP.sortKey];
  if(!getter) return rows;
  var dir = RP.sortDir === "asc" ? 1 : -1;
  return rows.slice().sort(function(x, y){
    var a = getter(x), b = getter(y);
    var an = (a === null || a === undefined || a === "");
    var bn = (b === null || b === undefined || b === "");
    if(an !== bn) return an ? 1 : -1;        // 빈 값은 방향과 무관하게 아래로
    if(!an){
      var c;
      if(typeof a === "number" && typeof b === "number") c = a - b;
      else c = String(a).localeCompare(String(b), "ko");
      if(c !== 0) return c * dir;
    }
    return String(y.date||"").localeCompare(String(x.date||""));   // 동점은 최신순
  });
}

/* ---------- 색 ---------- */
/* t: -1(하) ~ 0(중립) ~ +1(상). null 이면 중립색. 04_dash.js 의 hex2rgb/rgb2css 재사용 */
function rpHeat(t){
  var mid = hex2rgb(cssVar("--heat-mid"));
  if(t === null || t === undefined || isNaN(t)) return rgb2css(mid);
  t = Math.max(-1, Math.min(1, t));
  var end = hex2rgb(cssVar(t >= 0 ? "--heat-up" : "--heat-down"));
  var a = Math.abs(t);
  return rgb2css([0,1,2].map(function(i){ return Math.round(mid[i] + (end[i]-mid[i])*a); }));
}
function rpHeatRGBA(up, alpha){
  var c = hex2rgb(cssVar(up ? "--heat-up" : "--heat-down"));
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha.toFixed(2) + ")";
}
function rpQuantile(sorted, p){
  if(!sorted.length) return 0;
  var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  if(lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
/* 괴리율 색 기준. 0%를 중립에 두면 시장이 한쪽으로 쏠린 기간엔 전부 같은 색이 된다.
   화면에 있는 종목들의 중앙값을 중립으로, 사분위 범위(IQR)를 포화 폭으로 쓴다. */
function rpGapScale(nodes){
  var v = [];
  nodes.forEach(function(n){ if(typeof n.gap === "number") v.push(n.gap); });
  v.sort(function(a,b){ return a - b; });
  if(v.length < 4) return { mid:0, span:50 };
  var iqr = rpQuantile(v, 0.75) - rpQuantile(v, 0.25);
  return { mid:rpQuantile(v, 0.5), span:Math.max(iqr, 2) };
}

/* ---------- 셀 ---------- */
function rpGapCell(g){
  if(g === null || g === undefined) return '<span class="flat">-</span>';
  var cls = g > 0 ? "up" : (g < 0 ? "down" : "flat");
  var a = Math.min(1, Math.abs(g) / 50) * 0.42;
  var bg = a > 0.03 ? "background:" + rpHeatRGBA(g > 0, a) : "";
  return '<span class="gapv ' + cls + '" style="' + bg + '">' + fmtPct(g) + "</span>";
}
function rpTargetCell(r){
  if(r.target === null || r.target === undefined) return '<span class="flat">-</span>';
  var mark = "";
  if(r.target_change === "up") mark = '<span class="tgt up" title="직전 ' + fmt(r.prev_target) + '원">▲</span>';
  else if(r.target_change === "down") mark = '<span class="tgt down" title="직전 ' + fmt(r.prev_target) + '원">▼</span>';
  else if(r.target_change === "new") mark = '<span class="tgt new" title="이 증권사의 첫 목표가">NEW</span>';
  return "<b>" + fmt(r.target) + "</b>" + mark;
}
function rpChgTag(p){
  if(typeof p !== "number") return "";
  return '<span class="chgt ' + dirCls(p) + '">' + fmtPct(p) + "</span>";
}
function rpPriceCell(r){
  var p = rpPrice(r), q = rpLive(r);
  if(!p) return '<span class="flat">-</span>';
  return fmt(p) + (q ? rpChgTag(q.pct) : "");
}
/* 종목 셀: 이름 클릭 → 종목분석 탭, 코드 옆 작은 아이콘 → 네이버 금융 */
function rpStockCell(code, name, industry, sector){
  if(!code) return '<span class="tk">' + esc(name || "") + "</span>";
  return '<a class="tk rpgo" href="#" data-go="' + esc(code) + '" title="종목분석에서 열기">' +
         esc(rpName(code, name)) + "</a>" +
         '<span class="rcode">' + esc(code) + "</span>" +
         '<a class="rnav" href="https://finance.naver.com/item/main.naver?code=' + esc(code) +
         '" target="_blank" rel="noopener" title="네이버 금융에서 열기">↗</a>' +
         (industry ? '<span class="rind" title="' + esc((sector || RP_UNCL) + " · " + industry) + '">' +
                     esc(industry) + "</span>" : "");
}
function rpBadge(rating, raw){
  var v = rating || "NR";
  return '<span class="rbadge ' + esc(v) + '" title="' + esc(raw || "") + '">' + esc(v) + "</span>";
}

/* ---------- 개요 ---------- */
function rpOvi(k, v, cls, c){
  return '<div class="ovi sm"><div class="k">' + k + '</div><div class="v ' + (cls||"") + '">' + v + "</div>" +
         (c ? '<div class="c">' + c + "</div>" : "") + "</div>";
}
function rpAgg(rows){
  var a = { BUY:0, HOLD:0, SELL:0, NR:0, up:0, down:0, gapSum:0, gapN:0 };
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    if(a[r.rating] !== undefined) a[r.rating]++;
    if(r.target_change === "up") a.up++;
    else if(r.target_change === "down") a.down++;
    var g = rpGapOf(r);
    if(typeof g === "number"){ a.gapSum += g; a.gapN++; }
  }
  a.avgGap = a.gapN ? Math.round(a.gapSum / a.gapN * 100) / 100 : null;
  return a;
}
function rpPeriodLabel(){
  return { "1":"오늘", "3":"최근 3일", "7":"최근 1주", "30":"최근 1개월", "all":"전체 기간" }[RP.period] || "";
}
function rpRenderStats(rows){
  var a = rpAgg(rows), n = rows.length || 1;
  var html = rpOvi("리포트", fmt(rows.length), "", "전체 " + fmt(RPT.length) + "건");
  RP_RATINGS.forEach(function(k){
    html += rpOvi(k, fmt(a[k]), k === "BUY" ? "up" : (k === "SELL" ? "down" : ""),
                  Math.round(a[k] / n * 100) + "%");
  });
  html += rpOvi("목표가 상향", fmt(a.up), "up");
  html += rpOvi("하향", fmt(a.down), "down");
  html += rpOvi("평균 괴리율", a.avgGap === null ? "-" : fmtPct(a.avgGap), dirCls(a.avgGap),
                a.gapN ? fmt(a.gapN) + "건 기준" : "");
  $("#rpStats").innerHTML = html;
  $("#rpOvSub").textContent = rpPeriodLabel();
}

/* ---------- 표 머리 ---------- */
function rpHead(cols){
  return "<tr>" + cols.map(function(c){
    var sortable = c.sortable !== false;
    var arrow = (sortable && RP.sortKey === c.key) ? (RP.sortDir === "asc" ? " ▲" : " ▼") : "";
    return '<th class="' + (c.al || "") + (sortable ? " srt" : "") +
           (RP.sortKey === c.key ? " on" : "") + '"' +
           (sortable ? ' data-s="' + c.key + '" tabindex="0" role="button"' : "") + ">" +
           esc(c.label) + arrow + "</th>";
  }).join("") + "</tr>";
}

/* ---------- 리포트 표 ---------- */
const RP_COLS = [
  { key:"date",   label:"날짜",     al:"l", get:function(r){ return r.date; } },
  { key:"name",   label:"종목",     al:"l", get:function(r){ return r.name; } },
  { key:"title",  label:"제목",     al:"l", sortable:false },
  { key:"broker", label:"증권사",   al:"l", get:function(r){ return r.broker; } },
  { key:"rating", label:"의견",     al:"c", get:function(r){ return RP_RATINGS.indexOf(r.rating); } },
  { key:"target", label:"목표주가", get:function(r){ return r.target; } },
  { key:"price",  label:"현재가",   get:function(r){ return rpPrice(r); } },
  { key:"gap",    label:"괴리율",   get:function(r){ return rpGapOf(r); } }
];

function rpRenderReports(rows){
  $("#rpThead").innerHTML = rpHead(RP_COLS);
  var keys = {};
  RP_COLS.forEach(function(c){ if(c.get) keys[c.key] = c.get; });
  rows = rpSortRows(rows, keys);

  // 정렬·집계는 전체 기준으로 끝내고 그리는 행 수만 끊는다
  var total = rows.length, lim = Math.min(total, RP_LIMIT), html = [];
  for(var i=0;i<lim;i++){
    var r = rows[i];
    var link = r.pdf || r.url || "#";
    var hasSum = !!(r.summary && r.summary.length);
    var open = hasSum && rpOpenSum[r.id];
    html.push("<tr>");
    html.push('<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>");
    html.push('<td class="l">' + rpStockCell(r.code, r.name, r.industry, r.sector) + "</td>");
    html.push('<td class="l wr"><a class="rtitle" href="' + esc(link) + '" target="_blank" rel="noopener">' +
              esc(r.title || "") + "</a>" +
              (hasSum ? ' <button class="tgl" data-sum="' + esc(r.id) + '" aria-expanded="' +
                        (open ? "true" : "false") + '">' + (open ? "▴" : "▾") + "</button>" : "") + "</td>");
    html.push('<td class="l">' + esc(r.broker || "") +
              (r.analyst ? '<span class="rsub">' + esc(r.analyst) + "</span>" : "") + "</td>");
    html.push('<td class="c">' + rpBadge(r.rating, r.rating_raw) + "</td>");
    html.push("<td>" + rpTargetCell(r) + "</td>");
    html.push("<td>" + rpPriceCell(r) + "</td>");
    html.push("<td>" + rpGapCell(rpGapOf(r)) + "</td>");
    html.push("</tr>");
    if(open){
      html.push('<tr class="sumrow"><td class="l wr" colspan="' + RP_COLS.length + '">' +
                esc(r.summary) + "</td></tr>");
    }
  }
  if(total > lim){
    html.push('<tr class="morerow"><td class="c" colspan="' + RP_COLS.length + '">' +
              '<button class="btn" id="rpMore">더 보기 (+' + fmt(RP_PAGE) + ") · 남은 " +
              fmt(total - lim) + "건</button></td></tr>");
  }
  $("#rpTbody").innerHTML = html.join("");
  return total;
}

/* ---------- 종목별 ---------- */
const RP_SCOLS = [
  { key:"name",     label:"종목",           al:"l", get:function(s){ return s.name; } },
  { key:"industry", label:"업종",           al:"l", get:function(s){ return s.industry; } },
  { key:"n",        label:"리포트",         get:function(s){ return s.n; } },
  { key:"buy",      label:"BUY/HOLD/SELL",  al:"c", sortable:false },
  { key:"avg",      label:"평균 목표가",    get:function(s){ return s.avg; } },
  { key:"max",      label:"최고",           get:function(s){ return s.max; } },
  { key:"min",      label:"최저",           get:function(s){ return s.min; } },
  { key:"price",    label:"현재가",         get:function(s){ return s.price; } },
  { key:"gap",      label:"평균 괴리율",    get:function(s){ return s.gap; } }
];

function rpGroupByStock(rows){
  var map = {};
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    if(!r.code) continue;
    var g = map[r.code];
    if(!g){
      g = map[r.code] = { code:r.code, name:rpName(r.code, r.name), industry:null, sector:null, n:0,
                          targets:[], price:null, pct:null, date:"",
                          BUY:0, HOLD:0, SELL:0, NR:0 };
    }
    g.n++;
    if(r.industry){ g.industry = r.industry; g.sector = r.sector; }
    if((r.date || "") > g.date) g.date = r.date || "";
    var p = rpPrice(r);
    if(p) g.price = p;
    var q = rpLive(r);
    if(q) g.pct = q.pct;
    if(typeof r.target === "number") g.targets.push(r.target);
    if(g[r.rating] !== undefined) g[r.rating]++;
  }
  var out = [];
  for(var code in map){
    var s = map[code];
    if(s.targets.length){
      var sum = 0;
      for(var j=0;j<s.targets.length;j++) sum += s.targets[j];
      s.avg = Math.round(sum / s.targets.length);
      s.max = Math.max.apply(null, s.targets);
      s.min = Math.min.apply(null, s.targets);
    }else s.avg = s.max = s.min = null;
    s.gap = (s.price && s.avg) ? Math.round((s.avg - s.price) / s.price * 10000) / 100 : null;
    s.buyRatio = s.n ? Math.round(s.BUY / s.n * 1000) / 10 : null;
    out.push(s);
  }
  return out;
}

function rpRenderStocks(rows){
  $("#rpThead").innerHTML = rpHead(RP_SCOLS);
  var keys = {};
  RP_SCOLS.forEach(function(c){ if(c.get) keys[c.key] = c.get; });
  var stocks = rpGroupByStock(rows);
  var saved = RP.sortKey;
  if(!keys[RP.sortKey]) RP.sortKey = "n";       // 리포트 탭의 정렬 키(날짜 등)는 여기 없다
  stocks = rpSortRows(stocks, keys);
  RP.sortKey = saved;

  var html = stocks.map(function(s){
    return "<tr>" +
      '<td class="l">' + rpStockCell(s.code, s.name, null, null) + "</td>" +
      '<td class="l">' + (s.industry
        ? '<span class="rind2" title="' + esc((s.sector || RP_UNCL) + " · " + s.industry) + '">' +
          esc(s.industry) + "</span>"
        : '<span class="flat">-</span>') + "</td>" +
      "<td><b>" + fmt(s.n) + "</b></td>" +
      '<td class="c">' + rpMix(s) + "</td>" +
      "<td>" + (s.avg ? "<b>" + fmt(s.avg) + "</b>" : '<span class="flat">-</span>') + "</td>" +
      "<td>" + (s.max ? fmt(s.max) : '<span class="flat">-</span>') + "</td>" +
      "<td>" + (s.min ? fmt(s.min) : '<span class="flat">-</span>') + "</td>" +
      "<td>" + (s.price ? fmt(s.price) + rpChgTag(s.pct) : '<span class="flat">-</span>') + "</td>" +
      "<td>" + rpGapCell(s.gap) + "</td></tr>";
  });
  $("#rpTbody").innerHTML = html.join("");
  return stocks.length;
}

function rpMix(g){
  return '<span class="rmini BUY">' + g.BUY + "</span> " +
         '<span class="rmini HOLD">' + g.HOLD + "</span> " +
         '<span class="rmini SELL">' + g.SELL + "</span>";
}

/* ---------- 업종별 (대분류 -> 세부 업종 2단계) ---------- */
const RP_ECOLS = [
  { key:"name",   label:"업종",             al:"l", get:function(g){ return g.name; } },
  { key:"n",      label:"리포트",           get:function(g){ return g.n; } },
  { key:"stocks", label:"종목",             get:function(g){ return g.stocks; } },
  { key:"buy",    label:"BUY/HOLD/SELL",    al:"c", get:function(g){ return g.buyRatio; } },
  { key:"up",     label:"목표가 상향/하향", al:"c", get:function(g){ return g.up; } },
  { key:"gap",    label:"평균 괴리율",      get:function(g){ return g.gap; } },
  { key:"last",   label:"최근 리포트",      al:"c", get:function(g){ return g.last; } }
];

function rpNewAgg(name, sector){
  return { name:name, sector:sector, n:0, codes:{}, BUY:0, HOLD:0, SELL:0, NR:0,
           up:0, down:0, gapSum:0, gapN:0, last:"", kids:{} };
}
function rpAddAgg(g, r){
  g.n++;
  if(r.code) g.codes[r.code] = 1;
  if(g[r.rating] !== undefined) g[r.rating]++;
  if(r.target_change === "up") g.up++;
  else if(r.target_change === "down") g.down++;
  var gp = rpGapOf(r);
  if(typeof gp === "number"){ g.gapSum += gp; g.gapN++; }
  if((r.date || "") > g.last) g.last = r.date || "";
}
function rpFinishAgg(g){
  g.stocks = Object.keys(g.codes).length;
  g.gap = g.gapN ? Math.round(g.gapSum / g.gapN * 100) / 100 : null;
  g.buyRatio = g.n ? Math.round(g.BUY / g.n * 1000) / 10 : null;
  return g;
}
function rpGroupBySector(rows){
  var map = {};
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    var sname = r.sector || RP_UNCL, iname = r.industry || RP_UNCL;
    var g = map[sname] || (map[sname] = rpNewAgg(sname, sname));
    rpAddAgg(g, r);
    var kid = g.kids[iname] || (g.kids[iname] = rpNewAgg(iname, sname));
    rpAddAgg(kid, r);
  }
  var out = [];
  for(var key in map){
    var group = rpFinishAgg(map[key]);
    group.children = [];
    for(var ik in group.kids) group.children.push(rpFinishAgg(group.kids[ik]));
    out.push(group);
  }
  return out;
}
function rpChangeCell(g){
  if(!g.up && !g.down) return '<span class="flat">-</span>';
  var out = [];
  if(g.up) out.push('<span class="up"><b>▲' + fmt(g.up) + "</b></span>");
  if(g.down) out.push('<span class="down"><b>▼' + fmt(g.down) + "</b></span>");
  return out.join(" ");
}
function rpSectorRow(g, isChild){
  var caret = "";
  if(!isChild){
    var open = !!rpOpenSec[g.name];
    caret = '<button class="tgl" data-secopen="' + esc(g.name) + '" aria-expanded="' +
            (open ? "true" : "false") + '">' + (open ? "▾" : "▸") + "</button> ";
  }
  return '<tr class="' + (isChild ? "secchild" : "secgroup") + '" data-sec="' + esc(g.sector) +
         '" data-ind="' + (isChild ? esc(g.name) : "") + '" title="이 업종의 리포트 보기">' +
         '<td class="l">' + caret + esc(g.name) + "</td>" +
         "<td><b>" + fmt(g.n) + "</b></td>" +
         "<td>" + fmt(g.stocks) + "</td>" +
         '<td class="c">' + rpMix(g) +
           (g.buyRatio === null ? "" : '<span class="ratio">BUY ' + g.buyRatio + "%</span>") + "</td>" +
         '<td class="c">' + rpChangeCell(g) + "</td>" +
         "<td>" + rpGapCell(g.gap) + "</td>" +
         '<td class="c dt">' + esc((g.last || "").slice(2)) + "</td></tr>";
}
function rpRenderSectors(rows){
  $("#rpThead").innerHTML = rpHead(RP_ECOLS);
  var keys = {};
  RP_ECOLS.forEach(function(c){ if(c.get) keys[c.key] = c.get; });
  var groups = rpGroupBySector(rows);
  var saved = RP.sortKey;
  if(!keys[RP.sortKey]) RP.sortKey = "n";
  groups = rpSortRows(groups, keys);
  var html = [], shown = 0;
  groups.forEach(function(g){
    html.push(rpSectorRow(g, false));
    if(rpOpenSec[g.name]){
      rpSortRows(g.children, keys).forEach(function(k){ html.push(rpSectorRow(k, true)); });
    }
    shown += g.children.length;
  });
  RP.sortKey = saved;
  $("#rpTbody").innerHTML = html.join("");
  return shown;
}

/* ---------- 히트맵 (04_dash.js 의 squarify 재사용) ---------- */
function rpHeatValue(nd, sc){
  if(RP.heatColor === "buy"){
    var ratio = nd.buyRatio;
    return { t:(ratio === null ? null : (ratio - 50) / 50), label:(ratio === null ? "" : ratio + "%") };
  }
  var g = nd.gap;
  if(g === null || g === undefined) return { t:null, label:"" };
  return { t:Math.max(-1, Math.min(1, (g - sc.mid) / sc.span)), label:fmtPct(g) };
}
function rpRenderLegend(sc){
  var gap = RP.heatColor !== "buy";
  $("#rpLgMin").textContent = gap ? fmtPct(sc.mid - sc.span) : "BUY 0%";
  $("#rpLgMax").textContent = gap ? fmtPct(sc.mid + sc.span) : "100%";
  $("#rpLgMid").textContent = gap ? "중앙값 " + fmtPct(sc.mid) : "50%";
  [-1,-0.5,0,0.5,1].forEach(function(t, i){
    var el = $("#rpLg" + (i+1));
    if(el) el.style.background = rpHeat(t);
  });
}
function rpRenderHeat(rows){
  var box = $("#rpTmap"), W = box.clientWidth, H = box.clientHeight;
  box.innerHTML = "";
  rpHeatByCode = {};
  var nodes = rpGroupByStock(rows).filter(function(s){ return s.n > 0; });
  nodes.forEach(function(s){ rpHeatByCode[s.code] = s; });
  var sc = rpGapScale(nodes);
  rpRenderLegend(sc);
  if(!W || !H) return nodes.length;
  if(!nodes.length){
    box.innerHTML = '<div class="empty" style="padding:24px">조건에 맞는 리포트가 없습니다.</div>';
    return 0;
  }
  var bySec = {};
  nodes.forEach(function(nd){ (bySec[nd.sector || RP_UNCL] = bySec[nd.sector || RP_UNCL] || []).push(nd); });
  var secs = Object.keys(bySec).map(function(name){
    return { ref:name, value:bySec[name].reduce(function(s, i){ return s + i.n; }, 0) };
  }).sort(function(a, b){ return b.value - a.value; });

  squarify(secs, 0, 0, W, H).forEach(function(sr){
    var sd = document.createElement("div");
    sd.className = "tsec";
    sd.style.cssText = "left:" + sr.x + "px;top:" + sr.y + "px;width:" + sr.w + "px;height:" + sr.h + "px";
    var showLabel = sr.h > 34 && sr.w > 54;
    if(showLabel){
      var lb = document.createElement("div");
      lb.className = "sl";
      lb.textContent = sr.ref + " · " + bySec[sr.ref].length;
      sd.appendChild(lb);
    }
    var pad = showLabel ? 13 : 0;
    var list = bySec[sr.ref].slice().sort(function(a, b){ return b.n - a.n; })
      .map(function(nd){ return { ref:nd, value:nd.n }; });
    squarify(list, 0, pad, sr.w, Math.max(0, sr.h - pad)).forEach(function(t){
      var nd = t.ref, hv = rpHeatValue(nd, sc);
      var el = document.createElement("div");
      el.className = "tile";
      el.style.cssText = "left:" + t.x + "px;top:" + t.y + "px;width:" + t.w + "px;height:" + t.h +
                         "px;background:" + rpHeat(hv.t);
      el.dataset.rp = nd.code;
      if(t.w > 30 && t.h > 16){
        var big = t.w > 62 && t.h > 32;
        var nm = document.createElement("div");
        nm.className = "tn";
        nm.style.fontSize = (big ? 11 : 9) + "px";
        nm.textContent = nd.name || nd.code;
        el.appendChild(nm);
        if(t.h > 30){
          var cn = document.createElement("div");
          cn.className = "tp";
          cn.style.fontSize = (big ? 9.5 : 8.5) + "px";
          cn.textContent = nd.n + "건";
          el.appendChild(cn);
        }
        if(hv.label && t.h > 44){
          var pc = document.createElement("div");
          pc.className = "tp";
          pc.style.fontSize = (big ? 10.5 : 8.5) + "px";
          pc.textContent = hv.label;
          el.appendChild(pc);
        }
      }
      sd.appendChild(el);
    });
    box.appendChild(sd);
  });
  return nodes.length;
}

/* 히트맵 툴팁·클릭 (앱 공용 #ttip 재사용) */
function rpInitHeatEvents(){
  var box = $("#rpTmap"), tip = $("#ttip");
  function row(k, v){ return '<div class="r"><span>' + k + "</span><span>" + v + "</span></div>"; }
  box.addEventListener("mousemove", function(e){
    var el = e.target.closest(".tile");
    var nd = el ? rpHeatByCode[el.dataset.rp] : null;
    if(!nd){ tip.style.display = "none"; return; }
    tip.innerHTML = "<b>" + esc(nd.name || nd.code) +
      " <span style='color:var(--tx3);font-weight:400'>" + esc(nd.code) + "</span></b>" +
      row("업종", esc((nd.sector || RP_UNCL) + (nd.industry ? " · " + nd.industry : ""))) +
      row("리포트", fmt(nd.n) + "건") +
      row("BUY/HOLD/SELL", nd.BUY + " / " + nd.HOLD + " / " + nd.SELL) +
      row("평균 목표가", nd.avg ? fmt(nd.avg) + "원" : "-") +
      row("현재가", nd.price ? fmt(nd.price) + "원" : "-") +
      row("평균 괴리율", nd.gap === null ? "-"
          : '<span class="' + dirCls(nd.gap) + '">' + fmtPct(nd.gap) + "</span>");
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
    tip.style.display = "none";
    rpPickStock(el.dataset.rp);
  });
}

/* ---------- 전체 렌더 ---------- */
function rpRender(keepLimit){
  if(!RP_READY) return;
  if(!keepLimit) RP_LIMIT = RP_PAGE;
  var rows = rpFiltered();
  rpRenderStats(rows);
  rpRenderSelbar();

  var heat = RP.view === "heat";
  $("#rpTablePanel").classList.toggle("hide", heat);
  $("#rpHeatPanel").classList.toggle("hide", !heat);

  var shown, count;
  if(heat){
    shown = rpRenderHeat(rows);
    count = "종목 " + fmt(shown) + "개 / 리포트 " + fmt(rows.length) + "건";
  }else if(RP.view === "sectors"){
    $("#rpTableTitle").textContent = "업종별";
    shown = rpRenderSectors(rows);
    count = "업종 " + fmt(shown) + "개 / 리포트 " + fmt(rows.length) + "건";
  }else if(RP.view === "stocks"){
    $("#rpTableTitle").textContent = "종목별";
    shown = rpRenderStocks(rows);
    count = "종목 " + fmt(shown) + "개 / 리포트 " + fmt(rows.length) + "건";
  }else{
    $("#rpTableTitle").textContent = "리포트";
    shown = rpRenderReports(rows);
    count = fmt(rows.length) + "건 / 전체 " + fmt(RPT.length) + "건";
  }
  $("#rpCount").textContent = count;
  $("#rpCount2").textContent = count;

  if(!heat){
    var em = $("#rpEmpty");
    if(shown === 0){
      // 종목을 골랐는데 기간에 걸려 비었다면 기간을 넓힐 길을 열어 준다
      em.innerHTML = (RP.codes.length && RP.period !== "all")
        ? '이 기간엔 리포트가 없습니다 · <button class="btn xs" id="rpAllPeriod">전체 기간 보기</button>'
        : "조건에 맞는 리포트가 없습니다.";
    }
    em.style.display = shown === 0 ? "block" : "none";
    $("#rpTable").style.display = shown === 0 ? "none" : "table";
  }
  rpSyncControls();
  rpSave();
  rpUpdated();
}
function rpRenderKeep(){
  var y = window.pageYOffset;
  rpRender(true);
  window.scrollTo(0, y);
}
function rpUpdated(){
  if(!RMETA || !RMETA.updated_at) return;
  $("#rpUpd").textContent = "리포트 " + RMETA.updated_at.replace("T", " ").slice(5, 16) + " 기준";
}
function rpShowNotice(html){
  var n = $("#rpNotice");
  n.innerHTML = html;
  n.classList.toggle("hide", !html);
  $("#rpApp").classList.toggle("hide", !!html);
}

/* ---------- 컨트롤 ---------- */
function rpBuildControls(){
  $("#rpSectorChips").innerHTML = RP_SECLIST.map(function(s){
    return '<button class="chip" data-rsector="' + esc(s) + '">' + esc(s) + "</button>";
  }).join("");
  rpRenderBrokerList();
}
function rpRenderBrokerList(){
  $("#rpBrokerList").innerHTML = RP_BROKERS.map(function(b){
    return '<label><input type="checkbox" value="' + esc(b) + '"' +
           (RP.brokers.indexOf(b) >= 0 ? " checked" : "") + "> " + esc(b) + "</label>";
  }).join("");
}
function rpRenderIndustrySelect(){
  var rows = rpFiltered({ skipIndustry:true }), counts = {};
  for(var i=0;i<rows.length;i++){
    var k = rows[i].industry || RP_UNCL;
    counts[k] = (counts[k] || 0) + 1;
  }
  var names = Object.keys(counts).sort(function(a,b){
    return counts[b] - counts[a] || a.localeCompare(b, "ko");
  });
  if(RP.industry && counts[RP.industry] === undefined) names.unshift(RP.industry);
  var sel = $("#rpIndustry");
  sel.innerHTML = '<option value="">세부 업종 전체</option>' + names.map(function(n){
    return '<option value="' + esc(n) + '">' + esc(n) + " (" + fmt(counts[n] || 0) + ")</option>";
  }).join("");
  sel.value = RP.industry || "";
  sel.classList.toggle("on", !!RP.industry);
}
function rpSyncControls(){
  $$("#rpPeriod button").forEach(function(b){ b.classList.toggle("act", b.dataset.p === RP.period); });
  $$("#rpViewSeg button, #rpViewSeg2 button").forEach(function(b){ b.classList.toggle("act", b.dataset.v === RP.view); });
  $$("#rpHeatSeg button").forEach(function(b){ b.classList.toggle("act", b.dataset.hc === RP.heatColor); });
  $$("[data-rrating]").forEach(function(b){ b.classList.toggle("act", RP.ratings.indexOf(b.dataset.rrating) >= 0); });
  $$("[data-rchange]").forEach(function(b){ b.classList.toggle("act", RP.changes.indexOf(b.dataset.rchange) >= 0); });
  $$("[data-rsector]").forEach(function(b){ b.classList.toggle("act", RP.sectors.indexOf(b.dataset.rsector) >= 0); });
  $("#rpBrokerSum").textContent = RP.brokers.length ? "증권사 " + RP.brokers.length + "곳 ▾" : "증권사 전체 ▾";
  rpRenderIndustrySelect();
}
function rpRenderSelbar(){
  var html = RP.codes.map(function(code){
    var s = rpStockByCode[code];
    var label = s ? s.name : code;
    return '<span class="selchip">' + esc(label) + '<span class="c">' + esc(code) + "</span>" +
           '<button class="x" data-uncode="' + esc(code) + '" aria-label="' + esc(label) +
           ' 선택 해제">×</button></span>';
  });
  if(RP.q){
    html.push('<span class="selchip">제목 검색: ‘' + esc(RP.q) + '’' +
              '<button class="x" id="rpUnq" aria-label="검색어 지우기">×</button></span>');
  }
  var bar = $("#rpSelbar");
  bar.innerHTML = html.join("");
  bar.classList.toggle("hide", !html.length);
}

/* ---------- 이동 ---------- */
function rpToggle(arr, v){
  var i = arr.indexOf(v);
  if(i >= 0) arr.splice(i, 1); else arr.push(v);
}
function rpPickStock(code){
  if(!code) return;
  if(RP.codes.indexOf(code) < 0) RP.codes.push(code);
  RP.view = "reports";
  RP.sortKey = "date"; RP.sortDir = "desc";
  rpRender();
  window.scrollTo(0, 0);
}
function rpGotoSector(sector, industry){
  RP.sectors = sector ? [sector] : [];
  RP.industry = industry || "";
  RP.view = "reports";
  RP.sortKey = "date"; RP.sortDir = "desc";
  rpRender();
  window.scrollTo(0, 0);
}
/* 리포트 표의 종목명 클릭 → 종목분석 탭에서 열기 */
function rpGotoAnal(code){
  var s = rpStockByCode[code];
  selectStock({ mk:"KR", code:code, name:rpName(code, s ? s.name : code) });
  showTab("anal");
}

/* ---------- 검색 자동완성 (.srch/.sug 재사용) ---------- */
const RP_AC_STOCKS = 12, RP_AC_BROKERS = 5;

function rpHilite(text, raw){
  var t = String(text == null ? "" : text);
  var i = raw ? t.toLowerCase().indexOf(raw) : -1;
  if(i < 0) return esc(t);
  return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + raw.length)) + "</mark>" +
         esc(t.slice(i + raw.length));
}
function rpAcCandidates(input){
  var qn = rpNorm(input);
  var out = { stocks:[], brokers:[], raw:input.trim().toLowerCase() };
  if(!qn) return out;
  var hits = [];
  for(var i=0;i<rpStockIndex.length;i++){
    var s = rpStockIndex[i];
    var byName = s.nameNorm.indexOf(qn), byCode = s.codeNorm.indexOf(qn);
    if(byName < 0 && byCode < 0) continue;
    hits.push({ s:s, rank:(byName === 0 ? 0 : (byCode === 0 ? 1 : 2)) });
  }
  hits.sort(function(a,b){ return a.rank - b.rank || b.s.n - a.s.n || a.s.name.localeCompare(b.s.name, "ko"); });
  for(var j=0;j<hits.length && out.stocks.length < RP_AC_STOCKS;j++) out.stocks.push(hits[j].s);
  for(var k=0;k<RP_BROKERS.length && out.brokers.length < RP_AC_BROKERS;k++){
    if(rpNorm(RP_BROKERS[k]).indexOf(qn) >= 0) out.brokers.push(RP_BROKERS[k]);
  }
  return out;
}
function rpRenderAc(){
  var input = $("#rpQ").value;
  var c = rpAcCandidates(input), html = [], n = 0;
  rpAcItems = [];
  if(c.stocks.length){
    html.push('<div class="sec">종목</div>');
    c.stocks.forEach(function(s){
      rpAcItems.push({ kind:"stock", value:s.code });
      html.push('<div data-i="' + n + '"><span class="nm">' + rpHilite(s.name, c.raw) + "</span>" +
                '<span class="cd">' + rpHilite(s.code, c.raw) + "</span>" +
                (s.industry ? '<span class="ind">' + esc(s.industry) + "</span>" : "") +
                '<span class="n">' + fmt(s.n) + "건</span></div>");
      n++;
    });
  }
  if(c.brokers.length){
    html.push('<div class="sec">증권사</div>');
    c.brokers.forEach(function(b){
      rpAcItems.push({ kind:"broker", value:b });
      html.push('<div data-i="' + n + '"><span class="nm">' + rpHilite(b, c.raw) + "</span></div>");
      n++;
    });
  }
  if(!n){
    html.push('<div class="nohit">일치하는 종목·증권사가 없습니다.<br>Enter 를 누르면 제목까지 텍스트로 찾습니다.</div>');
  }
  $("#rpSug").innerHTML = html.join("");
  rpAcIndex = -1;
  rpSetAc(!!input.trim());
}
function rpSetAc(on){
  rpAcOpen = !!on;
  $("#rpSug").classList.toggle("open", rpAcOpen);
  if(!rpAcOpen) rpAcIndex = -1;
}
function rpMoveAc(delta){
  if(!rpAcOpen || !rpAcItems.length) return;
  var panel = $("#rpSug");
  var prev = panel.querySelector("div.hi");
  if(prev) prev.classList.remove("hi");
  rpAcIndex += delta;
  if(rpAcIndex < 0) rpAcIndex = rpAcItems.length - 1;
  if(rpAcIndex >= rpAcItems.length) rpAcIndex = 0;
  var el = panel.querySelector('div[data-i="' + rpAcIndex + '"]');
  if(!el) return;
  el.classList.add("hi");
  if(el.scrollIntoView) el.scrollIntoView({ block:"nearest" });
}
function rpPickAc(i){
  var it = rpAcItems[i];
  if(!it) return;
  $("#rpQ").value = "";
  rpSetAc(false);
  if(it.kind === "stock"){
    if(RP.codes.indexOf(it.value) < 0) RP.codes.push(it.value);
  }else{
    if(RP.brokers.indexOf(it.value) < 0) RP.brokers.push(it.value);
    rpRenderBrokerList();
  }
  rpRender();
  $("#rpQ").focus();
}
function rpCommitText(){
  var v = $("#rpQ").value.trim();
  rpSetAc(false);
  if(!v) return;
  RP.q = v;
  $("#rpQ").value = "";
  rpRender();
}

/* ---------- 대시보드: 오늘의 리포트 ---------- */
function rpRenderToday(){
  var box = $("#rpToday");
  if(!box) return;
  if(!RP_READY || !RPT.length){
    box.innerHTML = '<div style="color:var(--tx3)">리포트 데이터를 불러오는 중…</div>';
    return;
  }
  var day = "";
  for(var i=0;i<RPT.length;i++){ if((RPT[i].date || "") > day) day = RPT[i].date || ""; }
  var rows = RPT.filter(function(r){ return r.date === day; });
  var a = rpAgg(rows);
  var ups = rows.filter(function(r){ return r.target_change === "up"; })
    .sort(function(x, y){ return (rpGapOf(y) || 0) - (rpGapOf(x) || 0); }).slice(0, 8);

  var head = '<div class="ovw" style="gap:16px">' +
    rpOvi("리포트", fmt(rows.length), "", day.slice(5) + (day === rpTodayISO() ? " (오늘)" : " (최근 영업일)")) +
    rpOvi("BUY 비율", (rows.length ? Math.round(a.BUY / rows.length * 100) : 0) + "%", "up",
          "BUY " + a.BUY + "건") +
    rpOvi("목표가 상향", fmt(a.up), "up") +
    rpOvi("하향", fmt(a.down), "down") +
    rpOvi("평균 괴리율", a.avgGap === null ? "-" : fmtPct(a.avgGap), dirCls(a.avgGap)) + "</div>";

  var list = ups.length
    ? '<table class="rtbl" style="margin-top:6px"><tbody>' + ups.map(function(r){
        return '<tr><td class="l" style="width:36%">' + rpStockCell(r.code, r.name, null, null) + "</td>" +
               '<td class="l" style="color:var(--tx3)">' + esc(r.broker || "") + "</td>" +
               "<td>" + rpTargetCell(r) + "</td>" +
               "<td>" + rpGapCell(rpGapOf(r)) + "</td></tr>";
      }).join("") + "</tbody></table>"
    : '<div style="color:var(--tx3);margin-top:6px">이 날 목표가를 올린 리포트가 없습니다.</div>';

  box.innerHTML = head + list;
}

/* ---------- 종목분석: 증권사 리포트 패널 ---------- */
function rpRenderAnal(){
  var panel = $("#anRepPanel");
  if(!panel) return;
  var it = AN.sel;
  if(!it || isIdx(it)){ panel.classList.add("hide"); return; }
  panel.classList.remove("hide");

  if(!RP_READY){
    $("#anRepSub").textContent = "";
    $("#anRepCons").innerHTML = "";
    $("#anRepBody").innerHTML = '<tr><td class="l" colspan="7" style="color:var(--tx3)">리포트 데이터를 불러오는 중…</td></tr>';
    return;
  }
  var list = rpByCode[it.code] || [];
  if(!list.length){
    $("#anRepSub").textContent = "최근 리포트 없음";
    $("#anRepCons").innerHTML = "";
    $("#anRepBody").innerHTML = '<tr><td class="l" colspan="7" style="color:var(--tx3)">최근 리포트 없음</td></tr>';
    return;
  }
  /* 컨센서스: 최근 3개월 */
  var floor = rpShiftISO(rpTodayISO(), -92);
  var recent = list.filter(function(r){ return (r.date || "") >= floor; });
  if(!recent.length) recent = list.slice(0, 10);
  var tg = recent.map(function(r){ return r.target; }).filter(function(v){ return typeof v === "number"; });
  var buy = recent.filter(function(r){ return r.rating === "BUY"; }).length;
  var q = QUOTES["KR:" + it.code];
  var price = (q && q.ok && q.price > 0) ? q.price : null;
  var avg = tg.length ? Math.round(tg.reduce(function(s, v){ return s + v; }, 0) / tg.length) : null;
  var gap = (avg && price) ? Math.round((avg - price) / price * 10000) / 100 : null;

  $("#anRepSub").textContent = "전체 " + fmt(list.length) + "건 · 최근 3개월 " + fmt(recent.length) + "건";
  $("#anRepCons").innerHTML = '<div class="ovw" style="gap:16px">' +
    rpOvi("평균 목표가", avg ? fmt(avg) : "-", "", tg.length ? tg.length + "개 증권사" : "목표가 없음") +
    rpOvi("최고", tg.length ? fmt(Math.max.apply(null, tg)) : "-") +
    rpOvi("최저", tg.length ? fmt(Math.min.apply(null, tg)) : "-") +
    rpOvi("BUY 비율", Math.round(buy / recent.length * 100) + "%", "up", "BUY " + buy + "건") +
    rpOvi("현재가 대비", gap === null ? "-" : fmtPct(gap), dirCls(gap),
          price ? fmt(price) + "원 기준" : "시세 없음") + "</div>";

  $("#anRepBody").innerHTML = list.slice(0, 30).map(function(r){
    var link = r.pdf || r.url || "#";
    return "<tr>" +
      '<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>" +
      '<td class="l">' + esc(r.broker || "") + "</td>" +
      '<td class="l" style="color:var(--tx3)">' + esc(r.analyst || "") + "</td>" +
      '<td class="l wr"><a class="rtitle" href="' + esc(link) + '" target="_blank" rel="noopener">' +
        esc(r.title || "") + "</a></td>" +
      '<td class="c">' + rpBadge(r.rating, r.rating_raw) + "</td>" +
      "<td>" + rpTargetCell(r) + "</td>" +
      "<td>" + rpGapCell(rpGapOf(r)) + "</td></tr>";
  }).join("");
}

/* ---------- 스크리너 컬럼: 리포트(1M) · 컨센 괴리율 ---------- */
/* 최근 1개월 리포트 수와 그 평균 목표가 기준 괴리율을 스캔 결과에 붙인다 */
function rpAnnotate(list){
  if(!RP_READY || !list || !list.length) return;
  var floor = rpShiftISO((RMETA && RMETA.latest_date) ? RMETA.latest_date : rpTodayISO(), -29);
  list.forEach(function(q){
    var rs = rpByCode[q.code];
    if(!rs){ q.rep1m = 0; q.repGap = null; return; }
    var n = 0, sum = 0, cnt = 0;
    for(var i=0;i<rs.length;i++){
      if((rs[i].date || "") < floor) break;        // 최신순 정렬이라 여기서 끊는다
      n++;
      if(typeof rs[i].target === "number"){ sum += rs[i].target; cnt++; }
    }
    q.rep1m = n;
    q.repGap = (cnt && q.price > 0) ? Math.round((sum/cnt - q.price) / q.price * 10000) / 100 : null;
  });
}

/* ---------- 이벤트 / 초기화 ---------- */
function rpBind(){
  $("#rpPeriod").onclick = function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    RP.period = b.dataset.p; rpRender();
  };
  /* 서브뷰 전환 — 히트맵 패널에도 같은 seg 를 두어 돌아올 길을 남긴다 */
  ["#rpViewSeg", "#rpViewSeg2"].forEach(function(sel){
    $(sel).onclick = function(e){
      var b = e.target.closest("button[data-v]"); if(!b) return;
      RP.view = b.dataset.v; rpRender();
    };
  });
  $("#rpFilters").onclick = function(e){
    var b = e.target.closest("[data-rrating],[data-rchange],[data-rsector]"); if(!b) return;
    if(b.dataset.rrating) rpToggle(RP.ratings, b.dataset.rrating);
    else if(b.dataset.rchange) rpToggle(RP.changes, b.dataset.rchange);
    else rpToggle(RP.sectors, b.dataset.rsector);
    rpRender();
  };
  $("#rpIndustry").onchange = function(){ RP.industry = this.value; rpRender(); };
  $("#rpReset").onclick = function(){
    RP.ratings = []; RP.changes = []; RP.brokers = []; RP.sectors = [];
    RP.industry = ""; RP.codes = []; RP.q = ""; RP.period = "7";
    RP.sortKey = "date"; RP.sortDir = "desc";
    $("#rpQ").value = ""; rpSetAc(false);
    rpRenderBrokerList(); rpRender();
  };
  $("#rpBrokerAll").onclick = function(){ RP.brokers = RP_BROKERS.slice(); rpRenderBrokerList(); rpRender(); };
  $("#rpBrokerNone").onclick = function(){ RP.brokers = []; rpRenderBrokerList(); rpRender(); };
  $("#rpBrokerList").onchange = function(e){
    if(e.target.type !== "checkbox") return;
    rpToggle(RP.brokers, e.target.value);
    rpRender();
  };
  $("#rpHeatSeg").onclick = function(e){
    var b = e.target.closest("button[data-hc]"); if(!b) return;
    RP.heatColor = b.dataset.hc; rpRender(true);
  };

  /* 검색: 타이핑 중에는 드롭다운만 갱신하고 표는 건드리지 않는다 */
  var acDeb = rpDebounce(rpRenderAc, 120);
  var q = $("#rpQ");
  q.oninput = function(){ if(!q.value.trim()) rpSetAc(false); else acDeb(); };
  q.onfocus = function(){ if(q.value.trim()) rpRenderAc(); };
  q.onkeydown = function(e){
    if(e.key === "ArrowDown"){
      e.preventDefault();
      if(!rpAcOpen && q.value.trim()) rpRenderAc();
      rpMoveAc(1);
    }else if(e.key === "ArrowUp"){ e.preventDefault(); rpMoveAc(-1); }
    else if(e.key === "Enter"){
      e.preventDefault();
      if(rpAcOpen && rpAcIndex >= 0) rpPickAc(rpAcIndex); else rpCommitText();
    }else if(e.key === "Escape"){ if(rpAcOpen){ e.preventDefault(); rpSetAc(false); } }
    else if(e.key === "Backspace"){
      if(!q.value && RP.codes.length){ e.preventDefault(); RP.codes.pop(); rpSetAc(false); rpRender(); }
    }
  };
  // click 보다 먼저 처리해야 입력창 포커스가 빠지지 않는다
  $("#rpSug").addEventListener("mousedown", function(e){
    var it = e.target.closest("div[data-i]"); if(!it) return;
    e.preventDefault();
    rpPickAc(Number(it.dataset.i));
  });

  $("#rpSelbar").onclick = function(e){
    var x = e.target.closest("[data-uncode]");
    if(x){
      var i = RP.codes.indexOf(x.dataset.uncode);
      if(i >= 0) RP.codes.splice(i, 1);
      rpRender();
      return;
    }
    if(e.target.closest("#rpUnq")){ RP.q = ""; rpRender(); }
  };
  $("#rpEmpty").onclick = function(e){
    if(e.target.closest("#rpAllPeriod")){ RP.period = "all"; rpRender(); }
  };
  $("#rpThead").addEventListener("click", function(e){
    var th = e.target.closest("th[data-s]"); if(!th) return;
    var key = th.dataset.s;
    if(RP.sortKey === key) RP.sortDir = RP.sortDir === "asc" ? "desc" : "asc";
    else{
      RP.sortKey = key;
      RP.sortDir = (key === "name" || key === "broker" || key === "industry") ? "asc" : "desc";
    }
    rpRender();
  });
  $("#rpThead").addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){
      var th = e.target.closest("th[data-s]");
      if(th){ e.preventDefault(); th.click(); }
    }
  });
  $("#rpTbody").addEventListener("click", function(e){
    var go = e.target.closest("[data-go]");
    if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); return; }
    if(e.target.closest("#rpMore")){ RP_LIMIT += RP_PAGE; rpRenderKeep(); return; }
    var b = e.target.closest("button[data-sum]");
    if(b){
      var id = b.dataset.sum;
      if(rpOpenSum[id]) delete rpOpenSum[id]; else rpOpenSum[id] = true;
      rpRender(true);
      return;
    }
    var caret = e.target.closest("button[data-secopen]");
    if(caret){
      var key = caret.dataset.secopen;
      if(rpOpenSec[key]) delete rpOpenSec[key]; else rpOpenSec[key] = true;
      rpRenderKeep();
      return;
    }
    var tr = e.target.closest("tr[data-sec]");
    if(tr) rpGotoSector(tr.dataset.sec, tr.dataset.ind);
  });

  /* 대시보드 오늘의 리포트 / 종목분석 리포트 패널의 종목 링크 */
  ["#rpToday", "#anRepPanel"].forEach(function(sel){
    var el = $(sel);
    if(!el) return;
    el.addEventListener("click", function(e){
      var go = e.target.closest("[data-go]");
      if(!go) return;
      e.preventDefault();
      rpGotoAnal(go.dataset.go);
    });
  });
  $("#rpTodayMore").onclick = function(){ showTab("rep"); };

  rpInitHeatEvents();

  /* 드롭다운 바깥 클릭 */
  document.addEventListener("click", function(e){
    var dd = $("#rpBrokerDd");
    if(dd && dd.open && !dd.contains(e.target)) dd.open = false;
    if(rpAcOpen && !$("#rpSrch").contains(e.target)) rpSetAc(false);
  });
}

function rpInit(){
  rpLoadState();
  var VALID = ["date","name","broker","rating","target","price","gap","n","avg","max","min",
               "industry","stocks","buy","up","last"];
  if(VALID.indexOf(RP.sortKey) < 0) RP.sortKey = "date";
  if(RP.sortDir !== "asc" && RP.sortDir !== "desc") RP.sortDir = "desc";
  if(RP_VIEWS.indexOf(RP.view) < 0) RP.view = "reports";
  if(RP.heatColor !== "buy") RP.heatColor = "gap";
  ["ratings","changes","brokers","sectors","codes"].forEach(function(k){
    if(!Array.isArray(RP[k])) RP[k] = [];
  });
  if(typeof RP.industry !== "string") RP.industry = "";
  if(typeof RP.q !== "string") RP.q = "";
  RP.codes = RP.codes.filter(function(c){ return typeof c === "string" && c; });
  // 업종별 탭은 처음엔 다 펼쳐 둔다 (접은 상태는 저장하지 않는다)
  RP_SECTORS.concat([RP_UNCL]).forEach(function(s){ rpOpenSec[s] = true; });

  rpBind();
  rpLoad();
}
