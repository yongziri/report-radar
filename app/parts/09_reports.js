/* =========================================================================
   증권사 리포트 — 리포트 탭 + 대시보드·종목분석 연동
   데이터 v2 (docs/DATA-FORMAT-v2.md): data/meta.json → data/prices.json?v= ·
   data/reports/YYYY-MM.json?v= (필요한 달만) · data/summaries/YYYY-MM.json?v= (행을 펼칠 때).
   meta.json 에 months 가 없으면 v1 data/reports.json 한 파일을 읽는다.
   시세·유니버스·트리맵·테마는 앱의 기존 것을 그대로 쓴다(중복 구현 없음).
   ========================================================================= */

const RP_LS = "rr:filters:v2";                       // stock-helper 키와 분리
const RP_LS_OLD = ["rr:filters:v1"];                 // v1: 수집기 11분류(IT·통신·미디어…) 시절 — 읽어서 옮긴 뒤 지운다
const RP_RATINGS = ["BUY","HOLD","SELL","NR"];
const RP_UNCL = "미분류";
const RP_PAGE = 500;                                 // 표를 한 번에 그리는 행 수
const RP_VIEWS = ["reports","stocks","sectors","heat","changes","score","industry"];   // score·industry: 11_repx.js
const RP_MARGIN_DAYS = 35;                           // 시작 시 기간 필터보다 더 받아 둘 날 수
const RP_IDLE_DAYS = 100;                            // 첫 렌더 뒤 한가할 때 넓힐 범위 (종목분석 3개월)
const RP_SUSPECT_TIP = {
  target_range:"목표가가 기준가의 0.3~3.5배 범위 밖",
  name_is_broker:"종목명이 증권사 이름과 같음 (종목 매핑 오류 의심)"
};
const RP_DATA_IV = 300000;                           // 리포트 갱신 확인 주기 (5분)
const RP_LIVE_MAX = 120;                             // 한 번에 시세를 붙이는 종목 수 상한
/* 대분류: 스크리너·트리맵과 같은 12분류(build.py BROAD, 같은 순서). 수집기의 record.sector 는 쓰지 않고
   record.industry(네이버 세부 업종) -> IND_BROAD, 없으면 유니버스의 종목 대분류, 그래도 없으면 미분류 */
const RP_SECTORS = SECTORS.slice();
function rpBroadOf(r){
  var b = r.industry ? IND_BROAD[r.industry] : "";
  if(b) return b;
  var u = r.code ? UNI_BY_KEY["KR:" + r.code] : null;
  return (u && u.sector && RP_SECTORS.indexOf(u.sector) >= 0) ? u.sector : "";
}

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

/* v2 로더 상태 */
let RP_V2 = false;               // meta.json 에 months 가 있으면 true
let RP_PRICES = {};              // code -> {p, d} (data/prices.json)
let rpMonthData = {};            // "YYYY-MM" -> { v, rows }
let rpMonthPending = {};         // "YYYY-MM" -> Promise (중복 요청 방지)
let rpMonthFail = {};            // "YYYY-MM" -> 오류 메시지
let rpLoadProg = null;           // { done, total } 여러 달을 받는 중
let rpBootP = null;              // 첫 적재 Promise
let rpSumCache = {};             // "YYYY-MM" -> { id: 요약 }
let rpSumState = {};             // "YYYY-MM" -> "loading" | "ok" | "error"
let rpUpdFail = "";              // 마지막 갱신 확인 실패 시각 (HH:MM)

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
  heatColor:"gap",   // gap | buy
  suspect:""         // "" 전체 | hide 확인 필요 숨김 | only 확인 필요만
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
    var raw = localStorage.getItem(RP_LS), migrated = false;
    if(!raw){
      for(var i=0;i<RP_LS_OLD.length && !raw;i++) raw = localStorage.getItem(RP_LS_OLD[i]);
      migrated = !!raw;
    }
    RP_LS_OLD.forEach(function(k){ localStorage.removeItem(k); });
    if(!raw) return;
    var o = JSON.parse(raw);
    if(!o || typeof o !== "object") return;
    for(var k in RP){ if(Object.prototype.hasOwnProperty.call(o, k)) RP[k] = o[k]; }
    /* 지금 대분류 이름이 아닌 값(옛 IT·통신·미디어·기타 등)은 버린다 — 남으면 목록이 말없이 비게 된다 */
    if(Array.isArray(RP.sectors))
      RP.sectors = RP.sectors.filter(function(s){ return RP_SECTORS.indexOf(s) >= 0 || s === RP_UNCL; });
    if(migrated) rpSave();
  }catch(e){}
}

/* ---------- 시세: 앱의 QUOTES(naverRealtime) 를 그대로 쓴다 ---------- */
function rpQuote(code){ return code ? QUOTES["KR:" + code] : null; }
/* 종목 현재가: 실시간 시세 → data/prices.json → (v1 레코드의 price) */
function rpCodePrice(code){
  var q = rpQuote(code);
  if(q && q.ok && q.price > 0) return q.price;
  var p = code ? RP_PRICES[code] : null;
  return (p && p.p > 0) ? p.p : null;
}
function rpPrice(r){
  return rpCodePrice(r.code) || (r.price > 0 ? r.price : null);
}
function rpLive(r){
  var q = rpQuote(r.code);
  return (q && q.ok && q.price > 0) ? q : null;
}
/* 괴리율 계산은 여기 한 곳에서만 한다: (목표가 − 가격) / 가격 × 100, 소수 둘째 자리 */
function rpGapPct(target, price){
  if(typeof target !== "number" || !(price > 0)) return null;
  return Math.round((target - price) / price * 10000) / 100;
}
/* 목표가 대비 현재 괴리율 */
function rpGapOf(r){
  if(typeof r.target !== "number") return null;
  var p = rpPrice(r);
  if(!p) return (typeof r.gap === "number") ? r.gap : null;     // v1 레코드의 저장값
  return rpGapPct(r.target, p);
}
/* 발간 시점 괴리율 (price_at_write 가 있을 때) */
function rpGapAtWrite(r){ return rpGapPct(r.target, r.price_at_write); }
/* 통계에 넣을 레코드인지 (suspect 는 목록에만 남기고 모든 통계에서 뺀다) */
function rpStatOk(r){ return !r.suspect; }
function rpMedian(v){
  if(!v.length) return null;
  var s = v.slice().sort(function(a,b){ return a - b; });
  var m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2) * 100) / 100;
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
/* noStore: meta.json·v1 reports.json 처럼 주소가 같은 채 내용이 바뀌는 파일에만 쓴다.
   ?v= 가 붙은 파일은 브라우저·서비스 워커 캐시를 그대로 쓴다. */
function rpFetchJson(path, noStore){
  return fetch(path, noStore ? { cache:"no-store" } : undefined).then(function(r){
    if(!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  });
}
function rpIsV2Meta(m){ return !!(m && Array.isArray(m.months) && m.months.length); }
function rpMetaMonths(){ return (RP_V2 && RMETA && RMETA.months) ? RMETA.months : []; }
function rpMonthInfo(month){
  var ms = rpMetaMonths();
  for(var i=0;i<ms.length;i++) if(ms[i].month === month) return ms[i];
  return null;
}
function rpBaseISO(){
  var base = (RMETA && RMETA.latest_date) ? RMETA.latest_date : rpTodayISO();
  var today = rpTodayISO();
  return base > today ? today : base;
}
/* days 만큼 덮으려면 몇 일부터 있어야 하는지. days 가 없거나 Infinity 면 null(전체) */
function rpFloorForDays(days){
  if(!days || !isFinite(days)) return null;
  return rpShiftISO(rpBaseISO(), -(Math.max(1, Math.ceil(days)) - 1));
}
/* 메모리에 연속으로 올라온 범위의 시작일. 전부 올라왔으면 null, 하나도 없으면 "9999-12-31" */
function rpLoadedFloor(){
  if(!RP_V2) return null;
  var ms = rpMetaMonths(), last = null;
  for(var i=0;i<ms.length;i++){
    if(!rpMonthData[ms[i].month]) return last ? last + "-01" : "9999-12-31";
    last = ms[i].month;
  }
  return null;
}
function rpCovers(floor){
  var lf = rpLoadedFloor();
  if(lf === null) return true;
  return floor !== null && floor !== undefined && lf <= floor;
}
function rpIsPartial(){ return rpLoadedFloor() !== null; }
function rpTotalCount(){
  return (RP_V2 && RMETA && typeof RMETA.count === "number") ? RMETA.count : RPT.length;
}

/* 한 달치 리포트 파일. v 가 바뀌었으면 다시 받는다 */
function rpFetchMonth(mo){
  var key = mo.month + "@" + mo.v;
  if(rpMonthPending[key]) return rpMonthPending[key];
  var p = rpFetchJson("data/reports/" + mo.month + ".json?v=" + encodeURIComponent(mo.v))
    .then(function(rows){
      rpMonthData[mo.month] = { v:mo.v, rows:Array.isArray(rows) ? rows : [] };
      delete rpMonthFail[mo.month];
    }, function(err){
      rpMonthFail[mo.month] = (err && err.message) ? err.message : String(err);
      throw err;
    })
    .then(function(){ delete rpMonthPending[key]; }, function(err){ delete rpMonthPending[key]; throw err; });
  rpMonthPending[key] = p;
  return p;
}
/* 올라온 달들을 최신순으로 이어 RPT 를 새 배열로 만든다 (차트는 배열 동일성으로 변화를 감지) */
function rpMerge(){
  var out = [];
  rpMetaMonths().forEach(function(mo){
    var d = rpMonthData[mo.month];
    if(d) for(var i=0;i<d.rows.length;i++) out.push(d.rows[i]);
  });
  RPT = out;
}
/* 여러 달을 병렬로 받는다. 진행 상황은 rpLoadProg 로 보인다 */
function rpLoadMonths(list){
  if(!list.length) return Promise.resolve(0);
  var prog = rpLoadProg || (rpLoadProg = { done:0, total:0 });
  var jobs = list.map(function(mo){
    var fresh = !rpMonthPending[mo.month + "@" + mo.v];     // 이미 받는 중인 달은 진행률에 두 번 세지 않는다
    if(fresh) prog.total++;
    return rpFetchMonth(mo).then(function(){ return 1; }, function(){ return 0; })
      .then(function(ok){ if(fresh){ prog.done++; rpRenderLoadNote(); } return ok; });
  });
  rpRenderLoadNote();
  return Promise.all(jobs).then(function(res){
    if(rpLoadProg === prog && prog.done >= prog.total) rpLoadProg = null;
    rpRenderLoadNote();
    return res.reduce(function(s, v){ return s + v; }, 0);
  });
}
function rpMissingMonths(floor){
  var fm = floor ? floor.slice(0, 7) : "";
  return rpMetaMonths().filter(function(mo){
    var d = rpMonthData[mo.month];
    return (!fm || mo.month >= fm) && !(d && d.v === mo.v);
  });
}
function rpLoadPrices(){
  if(!RMETA || !RMETA.prices_v) return Promise.resolve();
  return rpFetchJson("data/prices.json?v=" + encodeURIComponent(RMETA.prices_v)).then(function(j){
    RP_PRICES = (j && j.prices) ? j.prices : {};
  }).catch(function(err){
    console.warn("prices.json 적재 실패:", err && err.message ? err.message : err);
  });
}

/* 적어도 days 일치 리포트가 메모리에 올라오면 resolve. v1 이거나 이미 있으면 바로 resolve.
   days 를 생략하거나 Infinity 면 전체. 종목분석 차트(05)·컨센서스 패널이 부른다. */
function rpEnsureHistory(days){
  if(!rpBootP) return Promise.resolve();
  return rpBootP.then(function(){
    if(!RP_V2 || !RP_READY) return;
    var floor = rpFloorForDays(days);
    if(rpCovers(floor)) return;
    var miss = rpMissingMonths(floor).filter(function(mo){ return !rpMonthData[mo.month]; });
    if(!miss.length) return;
    return rpLoadMonths(miss).then(function(n){
      if(n){ rpMerge(); rpDataChanged(false); }
    });
  });
}

function rpLoadV1(meta){
  return rpFetchJson("data/reports.json", true).then(function(list){
    RP_V2 = false;
    RMETA = meta;
    RPT = Array.isArray(list) ? list : [];
  });
}
function rpLoadV2(meta){
  RP_V2 = true;
  RMETA = meta;
  var floor = (RP.period === "all") ? null
    : rpFloorForDays((parseInt(RP.period, 10) || 1) + RP_MARGIN_DAYS);
  var need = rpMissingMonths(floor);
  if(!need.length) need = [meta.months[0]];
  return Promise.all([rpLoadPrices(), rpLoadMonths(need)]).then(function(res){
    if(!res[1]) throw new Error("data/reports/" + need[0].month + ".json 을 읽을 수 없습니다");
    rpMerge();
  });
}
function rpLoad(){
  rpBootP = rpFetchJson("data/meta.json", true).catch(function(){ return null; }).then(function(m){
    return rpIsV2Meta(m) ? rpLoadV2(m) : rpLoadV1(m);
  }).then(function(){
    RP_READY = true;
    rpRebuild();
    rpShowNotice("");
    if(!rpDataTimer) rpDataTimer = setInterval(rpCheckUpdate, RP_DATA_IV);
    if(!RPT.length){
      rpShowNotice("수집된 리포트가 없습니다. <code>python scraper/collect.py --days 45</code> 를 먼저 실행하세요.");
      return;
    }
    rpBuildControls();
    myRepOnData();                             // 내 종목 리포트: 기준선·새 리포트 알림·패널 (11_repx.js)
    rpRender();
    rpRenderToday();
    rpRenderAnal();                            // 종목분석 패널·차트 (지수·미선택이면 알아서 감춘다)
    if(SCREEN.length) applyFilter();          // 스크리너 리포트 컬럼 채우기
    /* 한가할 때 종목분석 컨센서스(3개월)에 필요한 범위까지 넓힌다 */
    if(RP_V2){
      var idle = window.requestIdleCallback || function(fn){ return setTimeout(fn, 1500); };
      idle(function(){ rpEnsureHistory(RP_IDLE_DAYS); }, { timeout:4000 });
    }
  }).catch(function(err){
    RP_READY = false;
    var isFile = location.protocol === "file:";
    rpShowNotice(
      "<b>리포트 데이터를 불러오지 못했습니다.</b><br>" +
      (isFile
        ? "<code>file://</code> 로 열면 보안 정책 때문에 JSON을 읽을 수 없습니다. " +
          "프로젝트 폴더에서 <code>python -m http.server 3491</code> 을 실행한 뒤 " +
          "<code>http://localhost:3491</code> 로 접속하세요."
        : "<code>data/</code> 의 리포트 파일을 읽을 수 없습니다. 수집을 먼저 실행했는지 확인하세요.<br>" +
          "<code>python scraper/collect.py --days 45</code>") +
      '<br><span style="color:var(--tx3)">' + esc(err && err.message ? err.message : err) + "</span>");
    console.warn("리포트 데이터 적재 실패:", err);
  });
  return rpBootP;
}

/* 데이터가 바뀐 뒤 다시 그리기. 숨은 탭은 rpRender 래퍼(07)가 보류한다 */
function rpDataChanged(full){
  rpRebuild();
  rpBuildControls();
  myRepOnData();                               // 새로 들어온 내 종목 리포트 알림 (11_repx.js)
  rpRender(true);
  rpRenderToday();
  rpRenderAnal();
  if(full && SCREEN.length) applyFilter();
}

/* 5분마다 meta 만 확인하고, v 가 바뀐 달·prices 만 다시 받는다 */
function rpCheckUpdate(){
  if(document.hidden) return;
  rpFetchJson("data/meta.json", true).then(function(m){
    if(!m || !m.updated_at) throw new Error("meta.json 형식 오류");
    var wasFail = !!rpUpdFail;
    rpUpdFail = "";
    if(!rpIsV2Meta(m) || !RP_V2){
      /* v1 (또는 v1↔v2 전환): 바뀐 경우에만 처음부터 다시 적재 */
      if(RMETA && RMETA.updated_at === m.updated_at && rpIsV2Meta(m) === RP_V2){ if(wasFail) rpUpdated(); return; }
      if(rpIsV2Meta(m)){ rpMonthData = {}; rpSumCache = {}; rpSumState = {}; }
      return (rpIsV2Meta(m) ? rpLoadV2(m) : rpLoadV1(m)).then(function(){ rpDataChanged(true); });
    }
    var old = RMETA, lf = rpLoadedFloor();
    var lfm = lf === null ? "" : lf.slice(0, 7);
    var keep = {};
    m.months.forEach(function(mo){ keep[mo.month] = mo; });
    /* 보관 기간이 지나 meta 에서 빠진 달은 메모리에서도 지운다 */
    Object.keys(rpMonthData).forEach(function(k){ if(!keep[k]) delete rpMonthData[k]; });
    /* 요약: sv 가 바뀐 달은 캐시를 버린다 (펼친 행이 있으면 다시 받는다) */
    Object.keys(rpSumCache).concat(Object.keys(rpSumState)).forEach(function(k){
      var oi = null;
      (old.months || []).forEach(function(mo){ if(mo.month === k) oi = mo; });
      if(!keep[k] || !oi || oi.sv !== keep[k].sv){ delete rpSumCache[k]; delete rpSumState[k]; }
    });
    var pricesChanged = !old || old.prices_v !== m.prices_v;
    RMETA = m;
    /* 올라와 있던 달 중 v 가 바뀐 것 + 올라온 범위 안의 새 달(새 달은 항상 최신) */
    var reload = m.months.filter(function(mo){
      var d = rpMonthData[mo.month];
      if(d) return d.v !== mo.v;
      return lfm === "" || mo.month >= lfm;
    });
    var jobs = [];
    if(pricesChanged) jobs.push(rpLoadPrices());
    if(reload.length) jobs.push(rpLoadMonths(reload));
    if(!jobs.length){
      if(old.updated_at !== m.updated_at || wasFail){ rpRender(true); rpUpdated(); }
      return;
    }
    return Promise.all(jobs).then(function(){
      rpMerge();
      rpDataChanged(true);
    });
  }).catch(function(err){
    var d = new Date();
    rpUpdFail = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    rpUpdated();
    console.warn("리포트 갱신 확인 실패:", err && err.message ? err.message : err);
  });
}

/* ---------- 요약 (v2: 달별 파일을 행을 처음 펼칠 때 받는다) ---------- */
function rpHasSum(r){ return !!((r.summary && r.summary.length) || r.has_summary); }
function rpSumMonth(r){ return String(r.date || "").slice(0, 7); }
function rpSumText(r){
  if(r.summary) return r.summary;
  var c = rpSumCache[rpSumMonth(r)];
  return c ? (c[r.id] || "") : "";
}
function rpLoadSummary(month){
  if(rpSumState[month] === "loading" || rpSumState[month] === "ok") return;
  var mi = rpMonthInfo(month);
  if(!mi){ rpSumState[month] = "error"; return; }
  rpSumState[month] = "loading";
  var url = "data/summaries/" + month + ".json" + (mi.sv ? "?v=" + encodeURIComponent(mi.sv) : "");
  rpFetchJson(url, !mi.sv).then(function(j){
    rpSumCache[month] = (j && typeof j === "object") ? j : {};
    rpSumState[month] = "ok";
  }, function(err){
    rpSumState[month] = "error";
    console.warn("요약 적재 실패:", err && err.message ? err.message : err);
  }).then(function(){ rpRender(true); });
}
/* 펼친 요약 행의 본문 HTML (불러오는 중·실패 상태 포함) */
function rpSumHtml(r){
  var t = rpSumText(r);
  if(t) return esc(t);
  if(!RP_V2) return '<span class="flat">요약 없음</span>';
  var mo = rpSumMonth(r), st = rpSumState[mo];
  if(!st){ rpLoadSummary(mo); st = rpSumState[mo]; }
  if(st === "loading") return '<span class="flat">요약을 불러오는 중…</span>';
  if(st === "error")
    return '<span class="down">요약을 불러오지 못했습니다.</span> ' +
           '<button class="btn xs" data-sumretry="' + esc(mo) + '">다시 시도</button>';
  return '<span class="flat">요약 없음</span>';
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

  /* 대분류: record.sector(수집기 분류)를 앱의 12분류로 덮어쓴다 — 이후 모든 집계·표시는 r.sector 를 본다 */
  RP_SECLIST = RP_SECTORS.slice();
  var uncl = false;
  for(var i=0;i<RPT.length;i++){
    var rr = RPT[i];
    if(rr._sec === undefined){ rr._sec = rpBroadOf(rr); rr.sector = rr._sec; }
    if(!rr.sector) uncl = true;
  }
  if(uncl) RP_SECLIST.push(RP_UNCL);
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
  var sus = RP.suspect;
  var out = [];
  for(var i=0;i<RPT.length;i++){
    var r = RPT[i];
    if(cd.length && cd.indexOf(r.code) < 0) continue;
    if(sus === "hide" && r.suspect) continue;
    if(sus === "only" && !r.suspect) continue;
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
/* inferred: rating_inferred — 원문에 의견이 없어 직전 의견을 이어받은 것 (점선 테두리) */
function rpBadge(rating, raw, inferred){
  var v = rating || "NR";
  var tip = inferred ? "원문에 의견 없음 — 직전 의견 유지로 추정" : (raw || "");
  return '<span class="rbadge ' + esc(v) + (inferred ? " inf" : "") + '" title="' + esc(tip) + '">' +
         esc(v) + "</span>";
}
function rpBadgeOf(r){ return rpBadge(r.rating, r.rating_raw, !!r.rating_inferred); }
/* suspect 레코드 표시 */
function rpSuspectTag(r){
  if(!r.suspect) return "";
  var why = RP_SUSPECT_TIP[r.suspect] || r.suspect;
  return '<span class="rsus" title="' + esc("확인 필요: " + why + " — 통계에서 제외") + '">확인 필요</span>';
}
/* 리포트 한 건의 괴리율 셀: 현재 괴리율 + 발간 시 괴리율(작은 글씨) */
function rpRecGapCell(r){
  var w = rpGapAtWrite(r);
  return rpGapCell(rpGapOf(r)) +
    (w === null ? "" : '<span class="rsub gw" title="발간일 기준가 ' + fmt(r.price_at_write) +
                       '원 대비">발간 시 ' + fmtPct(w) + "</span>");
}

/* ---------- 개요 ---------- */
function rpOvi(k, v, cls, c){
  return '<div class="ovi sm"><div class="k">' + k + '</div><div class="v ' + (cls||"") + '">' + v + "</div>" +
         (c ? '<div class="c">' + c + "</div>" : "") + "</div>";
}
/* 통계 요약. suspect 레코드는 세지 않고 a.sus 로만 센다. a.n = 통계에 들어간 건수 */
function rpAgg(rows){
  var a = { BUY:0, HOLD:0, SELL:0, NR:0, up:0, down:0, n:0, sus:0 }, gaps = [];
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    if(!rpStatOk(r)){ a.sus++; continue; }
    a.n++;
    if(a[r.rating] !== undefined) a[r.rating]++;
    if(r.target_change === "up") a.up++;
    else if(r.target_change === "down") a.down++;
    var g = rpGapOf(r);
    if(typeof g === "number") gaps.push(g);
  }
  a.gapN = gaps.length;
  a.medGap = rpMedian(gaps);
  return a;
}
function rpPeriodLabel(){
  return { "1":"오늘", "3":"최근 3일", "7":"최근 1주", "30":"최근 1개월", "all":"전체 기간" }[RP.period] || "";
}

/* ---------- 소스별 최신일 ---------- */
/* 소스 하나가 조용히 멈춰도 총 건수만 보면 눈치채기 어렵다. 개요 소제목 옆에
   소스별 최신 리포트 날짜를 적고, 영업일 기준으로 밀린 소스는 경고색으로 둔다.
   (실제 경보는 scraper/check_sources.py 가 Actions 에서 낸다) */
/* meta.source_status 의 키를 전부 보인다. 아래 순서가 앞, 모르는 키는 뒤에 원래 이름으로 */
const RP_SRC_ORDER = ["naver", "hankyung", "kb", "nh", "kis", "samsung", "im", "hmc", "wise"];
const RP_SRC_LABEL = { naver:"네이버", hankyung:"한경", kb:"KB", nh:"NH", kis:"한투", wise:"와이즈",
                       samsung:"삼성", im:"iM", hmc:"현대차" };
const RP_SRC_COMPACT = 5;    // 이보다 많으면 가장 오래된 것만 보이고 나머지는 툴팁·펼침으로
const RP_SRC_STALE_BD = 2;   // 이만큼 영업일이 비면 경고색

function rpBizDaysSince(from, to){
  /* from 다음날부터 to 까지의 영업일 수 (주말 제외) */
  var n = 0, d = new Date(from.getTime());
  d.setDate(d.getDate() + 1);
  while(d <= to){
    var w = d.getDay();
    if(w >= 1 && w <= 5) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function rpSourceStatusHtml(){
  var st = RMETA && RMETA.source_status;
  if(!st || typeof st !== "object") return "";
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var keys = Object.keys(st).sort(function(a, b){
    var ia = RP_SRC_ORDER.indexOf(a), ib = RP_SRC_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  var items = [];
  keys.forEach(function(k){
    var s = st[k];
    if(!s || typeof s !== "object") return;
    var ld = s.last_date || s.fetched_last_date || "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ld));
    var stale = m ? rpBizDaysSince(new Date(+m[1], +m[2] - 1, +m[3]), today) >= RP_SRC_STALE_BD : true;
    items.push({ k:k, label:RP_SRC_LABEL[k] || k, date:m ? m[0] : "", stale:stale, total:s.total || 0 });
  });
  if(!items.length) return "";
  function one(it){
    return '<span class="' + (it.stale ? "down" : "") + '" title="' +
           esc(it.label + " 최신 " + (it.date || "없음") + " · 보관 " + fmt(it.total) + "건") + '">' +
           esc(it.label) + " " + esc(it.date ? it.date.slice(5) : "-") + "</span>";
  }
  if(items.length <= RP_SRC_COMPACT)
    return '<span class="src">' + items.map(one).join(" · ") + "</span>";
  /* 소스가 많으면: 가장 오래된 최신일(멈춘 소스 신호)만 앞에 두고 전체는 툴팁·펼침에 */
  var oldest = items.slice().sort(function(a, b){ return (a.date || "0").localeCompare(b.date || "0"); })[0];
  var nStale = items.filter(function(it){ return it.stale; }).length;
  var tip = items.map(function(it){ return it.label + " " + (it.date || "-"); }).join(" · ");
  return '<details class="src srcdd"><summary title="' + esc(tip) + '">소스 ' + items.length + "곳 · 가장 늦은 " +
         one(oldest) + (nStale ? ' <span class="down">(지연 ' + nStale + ")</span>" : "") + "</summary>" +
         '<span class="srclist">' + items.map(one).join(" · ") + "</span></details>";
}
function rpRenderStats(rows){
  var a = rpAgg(rows), n = a.n || 1;
  var html = rpOvi("리포트", fmt(rows.length), "",
                   "전체 " + fmt(rpTotalCount()) + "건" +
                   (a.sus ? ' · <span title="확인 필요 레코드는 아래 통계에서 제외">확인 필요 ' + fmt(a.sus) + "</span>" : ""));
  RP_RATINGS.forEach(function(k){
    html += rpOvi(k, fmt(a[k]), k === "BUY" ? "up" : (k === "SELL" ? "down" : ""),
                  Math.round(a[k] / n * 100) + "%");
  });
  html += rpOvi("목표가 상향", fmt(a.up), "up");
  html += rpOvi("하향", fmt(a.down), "down");
  html += rpOvi("괴리율 중앙값", a.medGap === null ? "-" : fmtPct(a.medGap), dirCls(a.medGap),
                a.gapN ? fmt(a.gapN) + "건 기준" : "");
  $("#rpStats").innerHTML = html;
  $("#rpOvSub").innerHTML = esc(rpPeriodLabel()) + rpSourceStatusHtml();
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
  { key:"gap",    label:"괴리율",   get:function(r){ return rpGapOf(r); } },
  { key:"views",  label:"조회",     get:function(r){ return typeof r.views === "number" ? r.views : null; } }
];

/* 좁은 화면(≤768px)에서는 리포트·목표가 변경 목록을 카드로 그린다 */
function rpIsMobile(){ return !!(window.matchMedia && window.matchMedia("(max-width:768px)").matches); }
function rpMoreBtn(total, lim){
  return '<button class="btn" id="rpMore">더 보기 (+' + fmt(RP_PAGE) + ") · 남은 " + fmt(total - lim) + "건</button>";
}
/* 리포트 제목: PDF 우선, 없으면 url(와이즈는 종목 리포트 목록 페이지 — 출처 표시), 둘 다 없으면 글자만 */
function rpTitleLink(r){
  var t = esc(r.title || ""), link = r.pdf || r.url || "";
  if(!link) return '<span class="rtitle nolink">' + t + "</span>";
  var wise = !r.pdf && r.source === "wise";
  return '<a class="rtitle" href="' + esc(link) + '" target="_blank" rel="noopener"' +
         (wise ? ' title="WiseReport 종목 리포트 목록 (원문 PDF 없음)"' : (r.pdf ? "" : ' title="원문 페이지"')) + ">" + t + "</a>" +
         (wise ? ' <span class="rsrc">와이즈</span>' : "");
}
/* 카드 한 장. head: 첫 줄 오른쪽(목표가·괴리율 등) HTML */
function rpCardHtml(r, head){
  var hasSum = rpHasSum(r), open = hasSum && rpOpenSum[r.id];
  return '<div class="rcard' + (hasSum ? " hs" : "") + (open ? " open" : "") + '"' +
         (hasSum ? ' data-csum="' + esc(r.id) + '"' : "") + ">" +
    '<div class="l1"><span class="nm">' +
      (r.code ? '<a class="tk rpgo" href="#" data-go="' + esc(r.code) + '">' + esc(rpName(r.code, r.name)) + "</a>"
              : '<span class="tk">' + esc(r.name || "") + "</span>") +
      " " + rpBadgeOf(r) + rpSuspectTag(r) + rpHitTag(r) + '</span><span class="v">' + head + "</span></div>" +
    '<div class="l2">' + rpTitleLink(r) + "</div>" +
    '<div class="l3">' + esc(r.broker || "") + (r.analyst ? "(" + esc(r.analyst) + ")" : "") +
      " · " + esc((r.date || "").slice(2)) +
      (typeof r.views === "number" ? " · 조회 " + fmt(r.views) : "") +
      (hasSum ? '<span class="tg">' + (open ? "요약 접기 ▴" : "요약 ▾") + "</span>" : "") + "</div>" +
    (open ? '<div class="sum">' + rpSumHtml(r) + "</div>" : "") +
    "</div>";
}
function rpShowCards(on){
  $("#rpCards").classList.toggle("hide", !on);
  $("#rpTable").parentNode.classList.toggle("hide", on);
}

function rpRenderReports(rows){
  var keys = {};
  RP_COLS.forEach(function(c){ if(c.get) keys[c.key] = c.get; });
  rows = rpSortRows(rows, keys);
  var total = rows.length, lim = Math.min(total, RP_LIMIT), html = [];

  if(rpIsMobile()){
    for(var m=0;m<lim;m++){
      var rc = rows[m], g = rpGapOf(rc);
      html.push(rpCardHtml(rc, rpTargetCell(rc) +
        (g === null ? "" : ' <span class="' + dirCls(g) + '">' + fmtPct(g) + "</span>")));
    }
    if(total > lim) html.push('<div class="rcmore">' + rpMoreBtn(total, lim) + "</div>");
    $("#rpCards").innerHTML = html.join("");
    rpShowCards(true);
    return total;
  }
  rpShowCards(false);
  $("#rpThead").innerHTML = rpHead(RP_COLS);

  // 정렬·집계는 전체 기준으로 끝내고 그리는 행 수만 끊는다
  for(var i=0;i<lim;i++){
    var r = rows[i];
    var hasSum = rpHasSum(r);
    var open = hasSum && rpOpenSum[r.id];
    html.push("<tr>");
    html.push('<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>");
    html.push('<td class="l">' + rpStockCell(r.code, r.name, r.industry, r.sector) + "</td>");
    html.push('<td class="l wr">' + rpTitleLink(r) +
              (hasSum ? ' <button class="tgl" data-sum="' + esc(r.id) + '" aria-expanded="' +
                        (open ? "true" : "false") + '">' + (open ? "▴" : "▾") + "</button>" : "") + "</td>");
    html.push('<td class="l">' + esc(r.broker || "") +
              (r.analyst ? '<span class="rsub">' + esc(r.analyst) + "</span>" : "") + "</td>");
    html.push('<td class="c">' + rpBadgeOf(r) + "</td>");
    html.push("<td>" + rpTargetCell(r) + rpSuspectTag(r) + rpHitTag(r) + "</td>");
    html.push("<td>" + rpPriceCell(r) + "</td>");
    html.push("<td>" + rpRecGapCell(r) + "</td>");
    html.push('<td class="dt">' + (typeof r.views === "number" ? fmt(r.views) : "") + "</td>");
    html.push("</tr>");
    if(open){
      html.push('<tr class="sumrow"><td class="l wr" colspan="' + RP_COLS.length + '">' +
                rpSumHtml(r) + "</td></tr>");
    }
  }
  if(total > lim){
    html.push('<tr class="morerow"><td class="c" colspan="' + RP_COLS.length + '">' +
              rpMoreBtn(total, lim) + "</td></tr>");
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
    if(!r.code || !rpStatOk(r)) continue;     // 확인 필요 레코드는 종목 통계에서 뺀다
    var g = map[r.code];
    if(!g){
      g = map[r.code] = { code:r.code, name:rpName(r.code, r.name), industry:null, sector:null, n:0,
                          targets:[], price:null, pct:null, date:"",
                          BUY:0, HOLD:0, SELL:0, NR:0 };
    }
    g.n++;
    if(r.industry) g.industry = r.industry;
    if(r.sector && (r.industry || !g.sector)) g.sector = r.sector;   // 업종 없는 레코드도 유니버스 대분류를 쓴다
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
    s.gap = s.avg ? rpGapPct(s.avg, s.price) : null;
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
    if(!rpStatOk(r)) continue;                // 확인 필요 레코드는 업종 통계에서 뺀다
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

/* ---------- 목표가 변경 피드 ---------- */
function rpChgPct(r){
  return rpGapPct(r.target, r.prev_target);           // 같은 식: (새 − 직전) / 직전 × 100
}
const RP_CCOLS = [
  { key:"date",   label:"날짜",                al:"l", get:function(r){ return r.date; } },
  { key:"name",   label:"종목",                al:"l", get:function(r){ return r.name; } },
  { key:"broker", label:"증권사(애널리스트)",  al:"l", get:function(r){ return r.broker; } },
  { key:"target", label:"직전 → 새 목표가",    get:function(r){ return r.target; } },
  { key:"chg",    label:"변경률",              get:function(r){ return rpChgPct(r); } },
  { key:"rating", label:"의견",                al:"c", get:function(r){ return RP_RATINGS.indexOf(r.rating); } },
  { key:"price",  label:"현재가",              get:function(r){ return rpPrice(r); } },
  { key:"gap",    label:"괴리율",              get:function(r){ return rpGapOf(r); } }
];
/* 기본(날짜) 정렬: 날짜 → 같은 날은 |변경률| 큰 순 */
function rpSortChanges(rows, keys){
  if(RP.sortKey !== "date" && keys[RP.sortKey]) return rpSortRows(rows, keys);
  var dir = (RP.sortKey === "date" && RP.sortDir === "asc") ? 1 : -1;
  return rows.slice().sort(function(x, y){
    var c = String(x.date || "").localeCompare(String(y.date || "")) * dir;
    if(c) return c;
    return Math.abs(rpChgPct(y) || 0) - Math.abs(rpChgPct(x) || 0);
  });
}
/* 방향별로 리비전한 증권사 수가 많은 종목 top n (확인 필요 제외) */
function rpTopRevisers(rows, dir, n){
  var map = {};
  rows.forEach(function(r){
    if(r.target_change !== dir || !r.code || !rpStatOk(r)) return;
    var g = map[r.code] || (map[r.code] = { code:r.code, name:rpName(r.code, r.name), b:{}, k:0 });
    var bk = r.broker || "?";
    if(!g.b[bk]){ g.b[bk] = 1; g.k++; }
  });
  return Object.keys(map).map(function(c){ return map[c]; })
    .sort(function(a, b){ return b.k - a.k || a.name.localeCompare(b.name, "ko"); }).slice(0, n);
}
function rpRenderChgSum(rows){
  var up = 0, down = 0, codes = {};
  rows.forEach(function(r){
    if(!rpStatOk(r)) return;
    if(r.target_change === "up") up++; else down++;
    if(r.code) codes[r.code] = 1;
  });
  function top(list, cls){
    if(!list.length) return '<span class="flat">-</span>';
    return list.map(function(g, i){
      return '<span class="ti">' + (i + 1) + '. <a class="tk rpgo" href="#" data-go="' + esc(g.code) + '">' +
             esc(g.name) + '</a> <b class="' + cls + '">' + g.k + "곳</b></span>";
    }).join("");
  }
  $("#rpChgSum").innerHTML =
    '<div class="cnt"><span class="up">상향 <b>' + fmt(up) + '</b></span>' +
    '<span class="down">하향 <b>' + fmt(down) + "</b></span>" +
    "<span>종목 <b>" + fmt(Object.keys(codes).length) + "</b></span>" +
    '<span class="flat">확인 필요 레코드 제외</span></div>' +
    '<div class="tops"><div><span class="k">상향이 많은 종목</span>' + top(rpTopRevisers(rows, "up", 5), "up") + "</div>" +
    '<div><span class="k">하향이 많은 종목</span>' + top(rpTopRevisers(rows, "down", 5), "down") + "</div></div>";
}
function rpChgCell(r){
  return '<span class="flat">' + fmt(r.prev_target) + "</span> → <b>" + fmt(r.target) + "</b>";
}
function rpRenderChanges(rows){
  rows = rows.filter(function(r){ return r.target_change === "up" || r.target_change === "down"; });
  rpRenderChgSum(rows);
  var keys = {};
  RP_CCOLS.forEach(function(c){ if(c.get) keys[c.key] = c.get; });
  rows = rpSortChanges(rows, keys);
  var total = rows.length, lim = Math.min(total, RP_LIMIT), html = [];

  if(rpIsMobile()){
    for(var m=0;m<lim;m++){
      var rc = rows[m], pc = rpChgPct(rc);
      html.push(rpCardHtml(rc, rpChgCell(rc) +
        (pc === null ? "" : ' <span class="' + dirCls(pc) + '">' + fmtPct(pc) + "</span>")));
    }
    if(total > lim) html.push('<div class="rcmore">' + rpMoreBtn(total, lim) + "</div>");
    $("#rpCards").innerHTML = html.join("");
    rpShowCards(true);
    return total;
  }
  rpShowCards(false);
  $("#rpThead").innerHTML = rpHead(RP_CCOLS);
  for(var i=0;i<lim;i++){
    var r = rows[i], p = rpChgPct(r);
    html.push("<tr>" +
      '<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>" +
      '<td class="l">' + rpStockCell(r.code, r.name, r.industry, r.sector) + "</td>" +
      '<td class="l">' + esc(r.broker || "") +
        (r.analyst ? '<span class="rsub">' + esc(r.analyst) + "</span>" : "") + "</td>" +
      "<td>" + rpChgCell(r) + rpSuspectTag(r) + "</td>" +
      '<td><b class="' + dirCls(p) + '">' + (p === null ? "-" : fmtPct(p)) + "</b></td>" +
      '<td class="c">' + rpBadgeOf(r) + "</td>" +
      "<td>" + rpPriceCell(r) + "</td>" +
      "<td>" + rpRecGapCell(r) + "</td></tr>");
  }
  if(total > lim){
    html.push('<tr class="morerow"><td class="c" colspan="' + RP_CCOLS.length + '">' +
              rpMoreBtn(total, lim) + "</td></tr>");
  }
  $("#rpTbody").innerHTML = html.join("");
  return total;
}

/* ---------- 부분 적재 안내 ---------- */
/* 지금 보는 기간이 메모리에 다 올라오지 않았으면(또는 받는 중이면) 목록 위에 알린다 */
function rpRenderLoadNote(){
  var el = $("#rpLoadNote");
  if(!el) return;
  var html = "";
  if(RP_V2 && RP_READY && RP.view !== "industry"){
    var floor = rpViewFloor(), lf = rpLoadedFloor();
    var fails = Object.keys(rpMonthFail);
    if(rpLoadProg && !rpCovers(floor)){
      html = '<span class="spin"></span>이전 리포트를 불러오는 중… ' + rpLoadProg.done + " / " + rpLoadProg.total +
             "개월 · <b>지금 목록은 일부 데이터(" + esc(lf.slice(5)) + " 이후, " + fmt(RPT.length) + " / " +
             fmt(rpTotalCount()) + "건) 기준</b>입니다.";
    }else if(!rpCovers(floor)){
      html = "<b>일부 데이터 기준:</b> " + esc(lf) + " 이후 리포트만 불러왔습니다 (" + fmt(RPT.length) + " / " +
             fmt(rpTotalCount()) + "건)" +
             (fails.length ? ' · <span class="down">' + esc(fails.join(", ")) + " 불러오기 실패</span>" : "") +
             ' <button class="btn xs" id="rpLoadAll">전체 불러오기</button>';
    }
  }
  el.innerHTML = html;
  el.classList.toggle("hide", !html);
}

/* 지금 화면이 덮어야 할 시작일. 성적표는 전 기간(null) */
function rpViewFloor(){ return RP.view === "score" ? null : rpPeriodFloor(); }

/* ---------- 전체 렌더 ---------- */
function rpRender(keepLimit){
  if(!RP_READY) return;
  if(!keepLimit) RP_LIMIT = RP_PAGE;
  if(RP.view === "industry" && !indAvail()) RP.view = "reports";    // meta 에 industry_months 가 없으면 숨김
  /* 지금 기간이 아직 메모리에 없으면(예: "전체") 나머지 달을 병렬로 받고, 받는 동안은 안내를 띄운다 */
  var floor = rpViewFloor();
  if(RP_V2 && !rpCovers(floor)) rpEnsureHistory(floor === null ? Infinity : parseInt(RP.period, 10));
  rpRenderLoadNote();
  var partial = RP_V2 && !rpCovers(floor);
  if(RP.view === "reports" || RP.view === "changes") rpPerfEnsure();   // 목표가 "도달" 표시용 (perf_v 가 있을 때만)

  var rows = rpFiltered();
  rpRenderStats(rows);
  rpRenderSelbar();

  /* 성적표·산업·시황 (11_repx.js): 자체 컨트롤을 쓰므로 공용 필터 패널은 감춘다 */
  var ext = RP.view === "score" || RP.view === "industry";
  $("#rpScorePanel").classList.toggle("hide", RP.view !== "score");
  $("#rpIndPanel").classList.toggle("hide", RP.view !== "industry");
  $("#rpFilterPanel").classList.toggle("hide", ext);
  if(ext){
    $("#rpSelbar").classList.add("hide");
    $("#rpTablePanel").classList.add("hide");
    $("#rpHeatPanel").classList.add("hide");
    rpRenderExt();
    rpSyncControls();
    rpSave();
    rpUpdated();
    return;
  }

  var heat = RP.view === "heat", chg = RP.view === "changes";
  $("#rpTablePanel").classList.toggle("hide", heat);
  $("#rpHeatPanel").classList.toggle("hide", !heat);
  $("#rpChgSum").classList.toggle("hide", !chg);
  if(!heat && RP.view !== "reports" && !chg) rpShowCards(false);

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
  }else if(chg){
    $("#rpTableTitle").textContent = "목표가 변경";
    shown = rpRenderChanges(rows);
    count = "변경 " + fmt(shown) + "건 / 리포트 " + fmt(rows.length) + "건";
  }else{
    $("#rpTableTitle").textContent = "리포트";
    shown = rpRenderReports(rows);
    count = fmt(rows.length) + "건 / 전체 " + fmt(rpTotalCount()) + "건";
  }
  if(partial) count += " · 일부 데이터";
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
  var el = $("#rpUpd");
  if(!el) return;
  var html = (RMETA && RMETA.updated_at)
    ? "리포트 " + esc(RMETA.updated_at.replace("T", " ").slice(5, 16)) + " 기준" : "";
  if(rpUpdFail){
    html += (html ? " · " : "") + '<span class="down" title="5분 주기 갱신 확인(data/meta.json)이 실패했습니다. 화면은 마지막으로 받은 데이터입니다.">갱신 실패 ' +
            esc(rpUpdFail) + "</span>";
  }
  el.innerHTML = html;
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
  $$(".rpvseg button").forEach(function(b){ b.classList.toggle("act", b.dataset.v === RP.view); });
  $$('.rpvseg button[data-v="industry"]').forEach(function(b){ b.classList.toggle("hide", !indAvail()); });
  $$("#rpHeatSeg button").forEach(function(b){ b.classList.toggle("act", b.dataset.hc === RP.heatColor); });
  $$("[data-rrating]").forEach(function(b){ b.classList.toggle("act", RP.ratings.indexOf(b.dataset.rrating) >= 0); });
  $$("[data-rchange]").forEach(function(b){ b.classList.toggle("act", RP.changes.indexOf(b.dataset.rchange) >= 0); });
  $$("[data-rsector]").forEach(function(b){ b.classList.toggle("act", RP.sectors.indexOf(b.dataset.rsector) >= 0); });
  $$("[data-rsus]").forEach(function(b){ b.classList.toggle("act", RP.suspect === b.dataset.rsus); });
  $$("[data-rsort]").forEach(function(b){
    b.classList.toggle("act", RP.view === "reports" && RP.sortKey === b.dataset.rsort && RP.sortDir === "desc");
  });
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
  var a = rpAgg(rows);          // 확인 필요 레코드는 통계·목록에서 뺀다
  var ups = rows.filter(function(r){ return r.target_change === "up" && rpStatOk(r); })
    .sort(function(x, y){ return (rpGapOf(y) || 0) - (rpGapOf(x) || 0); }).slice(0, 8);

  var head = '<div class="ovw" style="gap:16px">' +
    rpOvi("리포트", fmt(rows.length), "", day.slice(5) + (day === rpTodayISO() ? " (오늘)" : " (최근 영업일)")) +
    rpOvi("BUY 비율", (a.n ? Math.round(a.BUY / a.n * 100) : 0) + "%", "up",
          "BUY " + a.BUY + "건") +
    rpOvi("목표가 상향", fmt(a.up), "up") +
    rpOvi("하향", fmt(a.down), "down") +
    rpOvi("괴리율 중앙값", a.medGap === null ? "-" : fmtPct(a.medGap), dirCls(a.medGap),
          a.gapN ? fmt(a.gapN) + "건 기준" : "") + "</div>";

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
  /* 컨센서스: 최근 3개월. 아직 메모리에 없으면 받아 온 뒤 다시 그린다 (전역 rpRenderAnal 을 다시 불러 차트도 갱신) */
  var floor = rpShiftISO(rpTodayISO(), -92);
  var loading = RP_V2 && !rpCovers(floor);
  if(loading && !rpRenderAnal.pending){
    rpRenderAnal.pending = true;
    rpEnsureHistory(RP_IDLE_DAYS).then(function(){
      rpRenderAnal.pending = false;
      if(rpCovers(floor)) rpRenderAnal();
    });
  }
  rpPerfEnsure();                                    // 목표가 "도달" 표시 (perf_v 가 있을 때만, 받은 뒤 다시 그린다)
  var list = rpByCode[it.code] || [];
  if(!list.length){
    var none = loading ? "리포트를 불러오는 중…" : "최근 리포트 없음";
    $("#anRepSub").textContent = none;
    $("#anRepCons").innerHTML = "";
    $("#anRepBody").innerHTML = '<tr><td class="l" colspan="7" style="color:var(--tx3)">' + none + "</td></tr>";
    return;
  }
  var recent = list.filter(function(r){ return (r.date || "") >= floor; });
  if(!recent.length) recent = list.slice(0, 10);
  var stat = recent.filter(rpStatOk);                // 확인 필요 레코드는 컨센서스에서 뺀다
  var tgRecs = stat.filter(function(r){ return typeof r.target === "number"; });
  var tg = tgRecs.map(function(r){ return r.target; });
  var tgBrokers = {};
  tgRecs.forEach(function(r){ tgBrokers[rpNorm(r.broker) || "?"] = 1; });
  var nBrokers = Object.keys(tgBrokers).length;
  var buy = stat.filter(function(r){ return r.rating === "BUY"; }).length;
  var price = rpCodePrice(it.code);
  var avg = tg.length ? Math.round(tg.reduce(function(s, v){ return s + v; }, 0) / tg.length) : null;
  var gap = avg ? rpGapPct(avg, price) : null;
  var sus = recent.length - stat.length;

  $("#anRepSub").textContent = (rpIsPartial() ? "불러온 범위 " : "전체 ") + fmt(list.length) + "건 · 최근 3개월 " +
    fmt(recent.length) + "건" + (sus ? " (확인 필요 " + sus + "건 제외)" : "") + (loading ? " · 불러오는 중…" : "");
  $("#anRepCons").innerHTML = '<div class="ovw" style="gap:16px">' +
    rpOvi("평균 목표가", avg ? fmt(avg) : "-", "", tg.length ? "증권사 " + nBrokers + "곳 · 리포트 " + tg.length + "건" : "목표가 없음") +
    rpOvi("최고", tg.length ? fmt(Math.max.apply(null, tg)) : "-") +
    rpOvi("최저", tg.length ? fmt(Math.min.apply(null, tg)) : "-") +
    rpOvi("BUY 비율", (stat.length ? Math.round(buy / stat.length * 100) : 0) + "%", "up", "BUY " + buy + "건") +
    rpOvi("현재가 대비", gap === null ? "-" : fmtPct(gap), dirCls(gap),
          price ? fmt(price) + "원 기준" : "시세 없음") + "</div>";

  $("#anRepBody").innerHTML = list.slice(0, 30).map(function(r){
    return "<tr>" +
      '<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>" +
      '<td class="l">' + esc(r.broker || "") + "</td>" +
      '<td class="l" style="color:var(--tx3)">' + esc(r.analyst || "") + "</td>" +
      '<td class="l wr">' + rpTitleLink(r) + "</td>" +
      '<td class="c">' + rpBadgeOf(r) + "</td>" +
      "<td>" + rpTargetCell(r) + rpSuspectTag(r) + rpHitTag(r) + "</td>" +
      "<td>" + rpRecGapCell(r) + "</td></tr>";
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
      if(!rpStatOk(rs[i])) continue;              // 확인 필요 레코드는 세지 않는다
      n++;
      if(typeof rs[i].target === "number"){ sum += rs[i].target; cnt++; }
    }
    q.rep1m = n;
    q.repGap = cnt ? rpGapPct(sum / cnt, q.price) : null;
  });
}

/* ---------- 이벤트 / 초기화 ---------- */
function rpBind(){
  $("#rpPeriod").onclick = function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    RP.period = b.dataset.p; rpRender();
  };
  /* 서브뷰 전환 — 히트맵 패널에도 같은 seg 를 두어 돌아올 길을 남긴다 */
  $$(".rpvseg").forEach(function(el){
    el.onclick = function(e){
      var b = e.target.closest("button[data-v]"); if(!b) return;
      RP.view = b.dataset.v; rpRender();
    };
  });
  $("#rpFilters").onclick = function(e){
    var b = e.target.closest("[data-rrating],[data-rchange],[data-rsector],[data-rsus],[data-rsort]"); if(!b) return;
    if(b.dataset.rrating) rpToggle(RP.ratings, b.dataset.rrating);
    else if(b.dataset.rchange) rpToggle(RP.changes, b.dataset.rchange);
    else if(b.dataset.rsus) RP.suspect = (RP.suspect === b.dataset.rsus) ? "" : b.dataset.rsus;
    else if(b.dataset.rsort){
      /* 빠른 정렬 칩 (많이 본 순): 다시 누르면 날짜순으로 */
      if(RP.view === "reports" && RP.sortKey === b.dataset.rsort && RP.sortDir === "desc"){
        RP.sortKey = "date"; RP.sortDir = "desc";
      }else{ RP.view = "reports"; RP.sortKey = b.dataset.rsort; RP.sortDir = "desc"; }
    }
    else rpToggle(RP.sectors, b.dataset.rsector);
    rpRender();
  };
  $("#rpIndustry").onchange = function(){ RP.industry = this.value; rpRender(); };
  $("#rpReset").onclick = function(){
    RP.ratings = []; RP.changes = []; RP.brokers = []; RP.sectors = [];
    RP.industry = ""; RP.codes = []; RP.q = ""; RP.period = "7"; RP.suspect = "";
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
  /* 요약 "다시 시도" (표·카드 공통) */
  function sumRetry(e){
    var rb = e.target.closest("button[data-sumretry]");
    if(!rb) return false;
    delete rpSumState[rb.dataset.sumretry];
    rpLoadSummary(rb.dataset.sumretry);
    rpRender(true);
    return true;
  }
  /* 모바일 카드: 종목 → 종목분석, 제목 → 원문, 그 밖을 누르면 요약 펼침 */
  $("#rpCards").addEventListener("click", function(e){
    var go = e.target.closest("[data-go]");
    if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); return; }
    if(e.target.closest("#rpMore")){ RP_LIMIT += RP_PAGE; rpRenderKeep(); return; }
    if(sumRetry(e)) return;
    if(e.target.closest("a")) return;
    var c = e.target.closest("[data-csum]");
    if(!c || e.target.closest(".sum")) return;
    var id = c.dataset.csum;
    if(rpOpenSum[id]) delete rpOpenSum[id]; else rpOpenSum[id] = true;
    rpRenderKeep();
  });
  $("#rpChgSum").addEventListener("click", function(e){
    var go = e.target.closest("[data-go]");
    if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); }
  });
  $("#rpLoadNote").addEventListener("click", function(e){
    if(!e.target.closest("#rpLoadAll")) return;
    rpMonthFail = {};
    rpEnsureHistory(Infinity);
    rpRenderLoadNote();
  });
  $("#rpTbody").addEventListener("click", function(e){
    var go = e.target.closest("[data-go]");
    if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); return; }
    if(e.target.closest("#rpMore")){ RP_LIMIT += RP_PAGE; rpRenderKeep(); return; }
    if(sumRetry(e)) return;
    var b = e.target.closest("button[data-sum]");
    if(b){
      var id = b.dataset.sum;
      if(rpOpenSum[id]) delete rpOpenSum[id]; else rpOpenSum[id] = true;
      rpRenderKeep();
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
               "industry","stocks","buy","up","last","views","chg"];
  if(VALID.indexOf(RP.sortKey) < 0) RP.sortKey = "date";
  if(RP.sortDir !== "asc" && RP.sortDir !== "desc") RP.sortDir = "desc";
  if(RP_VIEWS.indexOf(RP.view) < 0) RP.view = "reports";
  if(RP.heatColor !== "buy") RP.heatColor = "gap";
  if(RP.suspect !== "hide" && RP.suspect !== "only") RP.suspect = "";
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
