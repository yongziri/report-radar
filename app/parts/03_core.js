/* =========================================================================
   주식 대시보드 (Finviz 스타일, 국내 전용) — 코어
   데이터: 네이버 금융(JSONP, 코스피·코스닥 전용) / 구글뉴스·DART(rss2json 또는 프록시)
   ========================================================================= */

/* 국내 행 포맷: code|name|시총(억)|대분류idx|업종idx , 행 구분 ';'  (tools/build.py 생성) */
const KR_KOSPI_RAW = "__KR_KOSPI__";
const KR_KOSDAQ_RAW = "__KR_KOSDAQ__";
const SECTORS = "__SECTORS__".split(";");
const INDUSTRIES = "__INDUSTRIES__".split(";");
function parseKR(raw, market){
  if(!raw || raw.indexOf("__") === 0) return [];
  return raw.split(";").map(function(s){
    var f = s.split("|");
    if(f.length < 5) return null;
    var k = f[5] || "";                        // "" 주식 / E ETF / N ETN
    return { market:market, code:f[0], name:f[1], cap:+f[2],
             sector:SECTORS[+f[3]] || "기타", industry:INDUSTRIES[+f[4]] || "기타",
             fund:(k === "E" ? "ETF" : (k === "N" ? "ETN" : "")) };
  }).filter(Boolean);
}
const KR_UNIVERSE = parseKR(KR_KOSPI_RAW, "KOSPI").concat(parseKR(KR_KOSDAQ_RAW, "KOSDAQ"));
const UNIVERSE = KR_UNIVERSE;                      // 코스피·코스닥 전용
const UNI_BY_KEY = {};
UNIVERSE.forEach(function(u){ UNI_BY_KEY[keyOf(u.market, u.code)] = u; });
/* ETF·ETN 여부 (네이버 공식 ETF/ETN 목록 기준) */
const FUND_BY_CODE = {};
KR_UNIVERSE.forEach(function(u){ if(u.fund) FUND_BY_CODE[u.code] = u.fund; });
function isFund(code){ return !!FUND_BY_CODE[code]; }
/* 통계·시그널용 필터. 기본은 주식만(ETF·ETN 제외) — 설정으로 포함 전환 */
function statFilter(x){ return S.inclEtf ? true : !isFund(x.code); }
function statScopeTag(){ return S.inclEtf ? "ETF·ETN 포함" : "주식만"; }
/* 대시보드 트리맵 대상: 현재 설정 기준 시총 상위 150 */
function topCaps(n){
  return KR_UNIVERSE.filter(statFilter).sort(function(a,b){ return b.cap - a.cap; }).slice(0, n || 150);
}

function keyOf(mk, code){ return "KR:" + code; }

/* ===================== 상태 ===================== */
const LS_KEY = "stockHelper.v1";
const LS_SCAN = "stockHelper.scan";
const DEFAULTS = {
  v:4,
  theme:"dark", auto:true,
  settings:{ iv:60, cc:"global", proxy:"" },
  /* 멀티 관심종목 그룹 (v2) */
  wlGroups:[ { name:"기본", items:[ { mk:"KR", code:"005930", name:"삼성전자" },
                                    { mk:"KR", code:"000660", name:"SK하이닉스" } ] } ],
  wlActive:0,
  /* 계좌별 보유 기록 (v4). S.portfolio 는 전 계좌 합산 뷰(읽기 전용)로 남는다. */
  accounts:[ { id:"acc1", name:"종합 주식 계좌", items:[] } ],
  acctSel:"acc1",
  alerts:[], alertLog:[],
  screens:[],                 // 저장된 스크린 [{name, fs, sort, cols}]
  cols:null,                  // 표시 컬럼 (null = 기본)
  autoScan:true,              // 시작 시 자동 스캔 + 장중 주기 재스캔
  scanScope:"top500",         // "top500" | "all"
  inclEtf:false               // 통계·시그널에 ETF·ETN 포함 여부 (검색·보유는 항상 지원)
};
const SCAN_TOP_N = 500;
const SCAN_FRESH_MS = 10*60*1000;   // 이 시간 안에 스캔했으면 자동 스캔 생략
let MIGRATE_MSG = "";        // 마이그레이션 안내 (init 에서 1회 토스트)
let S = load();
bindPortfolioView(S);

/* 계좌 목록 / 현재 선택 계좌 */
function newAcctId(){ return "acc" + Date.now().toString(36) + Math.floor(Math.random()*1296).toString(36); }
function ACCTS(){
  if(!Array.isArray(S.accounts) || !S.accounts.length)
    S.accounts = [{ id:newAcctId(), name:"종합 주식 계좌", items:[] }];
  S.accounts.forEach(function(a){ if(!Array.isArray(a.items)) a.items = []; });
  return S.accounts;
}
function curAcct(){
  var l = ACCTS(), a = null;
  for(var i=0;i<l.length;i++){ if(l[i].id === S.acctSel){ a = l[i]; break; } }
  if(!a){ a = l[0]; S.acctSel = a.id; }
  return a;
}
/* 전 계좌 보유 합산 뷰 — 같은 종목은 수량 합산·가중평균. 읽기 전용이다. */
function mergedHoldings(){
  var order = [], by = {};
  ACCTS().forEach(function(a){
    a.items.forEach(function(it){
      if(!it || !it.code) return;
      var k = keyOf(it.mk, it.code), m = by[k];
      if(!m){
        m = by[k] = { mk:it.mk || "KR", code:it.code, name:it.name || it.code,
                      qty:0, avg:0, buy:0, accts:[], acctIds:[] };
        order.push(m);
      }
      var qty = Number(it.qty) || 0, avg = Number(it.avg) || 0;
      m.qty += qty; m.buy += qty*avg;
      if(m.acctIds.indexOf(a.id) < 0){ m.acctIds.push(a.id); m.accts.push(a.name); }
    });
  });
  order.forEach(function(m){ m.avg = m.qty > 0 ? m.buy/m.qty : 0; });
  return order;
}
/* 기존 코드(관심종목·알림·시세추적·가져오기)가 참조하는 S.portfolio 호환 뷰.
   열거 불가 속성이라 JSON.stringify(S) 에는 저장되지 않는다. */
function bindPortfolioView(o){
  try{
    delete o.portfolio;
    Object.defineProperty(o, "portfolio", { get:mergedHoldings, enumerable:false, configurable:true });
  }catch(e){ console.warn("포트폴리오 뷰 바인딩 실패", e); }
}

/* 활성 관심종목 그룹 / 전체 그룹 종목 */
function WL(){
  if(!S.wlGroups || !S.wlGroups.length) S.wlGroups = [{ name:"기본", items:[] }];
  if(!(S.wlActive >= 0) || S.wlActive >= S.wlGroups.length) S.wlActive = 0;
  var g = S.wlGroups[S.wlActive];
  if(!g.items) g.items = [];
  return g.items;
}
function allWL(){
  var o = [];
  (S.wlGroups||[]).forEach(function(g){ o = o.concat(g.items||[]); });
  return o;
}

function load(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(!raw) return JSON.parse(JSON.stringify(DEFAULTS));
    var o = JSON.parse(raw), d = JSON.parse(JSON.stringify(DEFAULTS));
    /* v1 -> v2 마이그레이션: 단일 watchlist 를 "기본" 그룹으로 옮긴다 */
    if(!o.wlGroups){
      o.wlGroups = [{ name:"기본", items:Array.isArray(o.watchlist) ? o.watchlist : [] }];
      o.wlActive = 0;
      delete o.watchlist;
      o.v = 2;
      console.info("관심종목을 그룹 스키마(v2)로 마이그레이션했습니다.");
    }
    /* v2 -> v3: 미국 주식 지원 종료. 남아 있는 미국 종목·설정을 제거하고 1회만 안내한다. */
    if(!(o.v >= 3)){
      var removed = 0;
      var isUS = function(x){ return x && (x.mk === "US" || !/^\d{6}$/.test(String(x.code || ""))); };
      (o.wlGroups || []).forEach(function(g){
        var before = (g.items || []).length;
        g.items = (g.items || []).filter(function(x){ return !isUS(x); });
        removed += before - g.items.length;
      });
      ["portfolio", "alerts"].forEach(function(k){
        var before = (o[k] || []).length;
        o[k] = (o[k] || []).filter(function(x){ return !isUS(x); });
        removed += before - o[k].length;
      });
      o.settings = o.settings || {};
      ["td", "fh", "fx"].forEach(function(k){ delete o.settings[k]; });
      o.v = 3;
      if(removed) MIGRATE_MSG = "미국 주식 지원이 종료되어 " + removed + "종목이 제거되었습니다.";
    }
    /* v3 -> v4: 단일 포트폴리오를 "종합 주식 계좌" 로 옮긴다 (계좌별 보유 기록) */
    if(!Array.isArray(o.accounts) || !o.accounts.length){
      var pf = Array.isArray(o.portfolio) ? o.portfolio : [];
      o.accounts = [{ id:"acc1", name:"종합 주식 계좌", items:pf.map(function(x){
        return { mk:x.mk || "KR", code:x.code, name:x.name,
                 qty:Number(x.qty) || 0, avg:Number(x.avg) || 0, memo:"" };
      }) }];
      o.acctSel = "acc1";
      if(pf.length) console.info("보유 " + pf.length + "종목을 “종합 주식 계좌”로 옮겼습니다(v4).");
    }
    delete o.portfolio;                        // 합산 뷰(게터)로 대체됨
    o.v = 4;
    Object.keys(d).forEach(function(k){ if(o[k] === undefined) o[k] = d[k]; });
    o.settings = o.settings || {};
    Object.keys(d.settings).forEach(function(k){
      if(o.settings[k] === undefined) o.settings[k] = d.settings[k];
    });
    return o;
  }catch(e){
    console.warn("상태 복원 실패, 기본값 사용", e);
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}
function save(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  catch(e){ toast("저장 실패: 브라우저 저장공간을 확인하세요", "err"); }
}

const QUOTES = {};     // key -> quote
const SPARK = {};      // key -> number[]
const DEEP = {};       // code -> 심층지표 (세션 캐시)
let SCREEN = [];       // 스크리너 스캔 결과
let SCAN_AT = null;    // 스캔 시각(표시용 문자열)
let SCAN_AT_MS = 0;    // 스캔 시각(epoch) — 신선도 판단
let SCAN_SCOPE = "";   // 스캔 범위 ("top500" | "all")
let SCAN_LABEL = "";   // 소비처 라벨 ("전체 3,922종목 기준" 등)
let TMAP_LOADED = false;
let curTab = "dash";

/* ===================== 유틸 ===================== */
const $ = function(s, r){ return (r||document).querySelector(s); };
const $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };

function fmt(n, dec){
  if(n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("ko-KR", { minimumFractionDigits:dec||0, maximumFractionDigits:dec||0 });
}
function fmtPrice(v, mk){ return mk === "IDX" ? fmt(v, 2) : fmt(v, 0); }
function fmtSigned(v, dec){
  if(v === null || v === undefined || isNaN(v)) return "-";
  return (v > 0 ? "+" : "") + fmt(v, dec||0);
}
function fmtPct(v){
  if(v === null || v === undefined || isNaN(v)) return "-";
  return (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
}
function fmtBig(v){
  if(v === null || v === undefined || isNaN(v)) return "-";
  v = Number(v);
  var s = v < 0 ? "-" : ""; v = Math.abs(v);
  if(v >= 1e12) return s + (v/1e12).toFixed(2) + "조";
  if(v >= 1e8)  return s + (v/1e8).toFixed(0) + "억";
  if(v >= 1e4)  return s + (v/1e4).toFixed(0) + "만";
  return s + fmt(v);
}
function dirCls(v){ return v > 0 ? "up" : (v < 0 ? "down" : "flat"); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function todayStr(d){
  d = d || new Date();
  var p = function(n){ return (n<10?"0":"") + n; };
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate());
}
function ymdShift(months){ var d = new Date(); d.setMonth(d.getMonth()-months); return todayStr(d); }
function nowTime(){ return new Date().toLocaleTimeString("ko-KR", { hour12:false }); }
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function toast(msg, kind){
  var el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(function(){
    el.style.transition = "opacity .3s"; el.style.opacity = "0";
    setTimeout(function(){ el.remove(); }, 320);
  }, 4200);
}
function kstNow(){ var n = new Date(); return new Date(n.getTime() + n.getTimezoneOffset()*60000 + 9*3600000); }
function marketOpen(){
  var k = kstNow(), day = k.getDay(), hm = k.getHours()*60 + k.getMinutes();
  return { kr: day >= 1 && day <= 5 && hm >= 540 && hm <= 930 };   // 09:00~15:30 KST
}
/* kstNow() 로 만든 '가짜 KST 로컬' Date 를 실제 epoch 로 되돌린다 */
function kstToEpoch(d){
  return d.getTime() - new Date().getTimezoneOffset()*60000 - 9*3600000;
}
/* 가장 최근 정규장 마감(평일 15:30 KST) 시각의 epoch */
function lastMarketCloseEpoch(){
  var now = kstNow(), d = kstNow();
  d.setHours(15, 30, 0, 0);
  if(now < d) d.setDate(d.getDate() - 1);
  while(d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return kstToEpoch(d);
}

/* ===================== JSONP (네이버) =====================
   큐 + 요청 간 150ms + 8초 타임아웃. 응답은 EUC-KR.            */
const JSONP = (function(){
  var seq = 0, queue = [], busy = false, lastAt = 0;
  var GAP = 150, TIMEOUT = 8000;
  function run(){
    if(busy || !queue.length) return;
    var wait = Math.max(0, GAP - (Date.now() - lastAt));
    busy = true;
    setTimeout(function(){
      var job = queue.shift(); lastAt = Date.now();
      exec(job, function(){ busy = false; run(); });
    }, wait);
  }
  function exec(job, done){
    var name = "__jsonp_cb_" + (++seq) + "_" + (Date.now() % 100000);
    var script = document.createElement("script");
    var timer = null, finished = false;
    function cleanup(){
      if(timer) clearTimeout(timer);
      try{ delete window[name]; }catch(e){ window[name] = undefined; }
      if(script.parentNode) script.parentNode.removeChild(script);
    }
    function finish(err, data){
      if(finished) return;
      finished = true; cleanup(); done();
      if(err) job.reject(err); else job.resolve(data);
    }
    window[name] = function(data){ finish(null, data); };
    script.src = job.url + (job.url.indexOf("?") < 0 ? "?" : "&") + "_callback=" + name;
    script.charset = "EUC-KR";
    script.onerror = function(){ finish(new Error("JSONP 요청 실패")); };
    timer = setTimeout(function(){ finish(new Error("JSONP 타임아웃")); }, TIMEOUT);
    document.head.appendChild(script);
  }
  return function(url){
    return new Promise(function(resolve, reject){
      queue.push({ url:url, resolve:resolve, reject:reject }); run();
    });
  };
})();

let failStreak = 0;
function noteOk(){ failStreak = 0; }
function noteFail(){
  failStreak++;
  if(failStreak >= 3 && S.auto){
    S.auto = false; save(); syncAutoBtn(); stopTimer();
    toast("네트워크 오류가 반복되어 자동갱신을 일시 중지했습니다.", "err");
  }
}

/* ===================== 네이버 API ===================== */
/* 영역 구분자는 세미콜론이 아니라 파이프(|) 입니다 — 세미콜론은 첫 종목만 반환됩니다. */
function naverRealtime(codes, withIndex){
  var parts = [];
  if(codes && codes.length) parts.push("SERVICE_ITEM:" + codes.join(","));
  if(withIndex) parts.push("SERVICE_INDEX:KOSPI,KOSDAQ");
  if(!parts.length) return Promise.resolve({ items:{}, index:{} });
  var url = "https://polling.finance.naver.com/api/realtime?query=" + encodeURIComponent(parts.join("|"));
  return JSONP(url).then(function(res){
    if(!res || !res.result || !res.result.areas) throw new Error("응답 형식 오류");
    var out = { items:{}, index:{} };
    res.result.areas.forEach(function(a){
      (a.datas||[]).forEach(function(d){
        if(a.name === "SERVICE_INDEX") out.index[d.cd] = d; else out.items[d.cd] = d;
      });
    });
    return out;
  });
}
function naverHistory(code, timeframe, startYmd, endYmd){
  var url = "https://api.finance.naver.com/siseJson.naver?symbol=" + code +
            "&requestType=1&startTime=" + startYmd + "&endTime=" + endYmd + "&timeframe=" + timeframe;
  return JSONP(url).then(function(rows){
    if(!rows || !rows.length) return [];
    return rows.slice(1).filter(function(r){ return r && r.length >= 6; }).map(function(r){
      return { d:String(r[0]), o:+r[1], h:+r[2], l:+r[3], c:+r[4], v:+r[5] };
    }).filter(function(b){ return b.c > 0; });
  });
}

/* 네이버 벌크 필드 -> 공통 quote (파생 지표 포함) */
function krQuote(d){
  var down = (d.rf === "5" || d.rf === "4");
  var u = UNI_BY_KEY["KR:" + d.cd];
  var nv = d.nv, sv = d.sv, range = d.hv - d.lv;
  var capW = (d.countOfListedStock > 0) ? nv * d.countOfListedStock : (u ? u.cap*1e8 : 0);
  var q = {
    mk:"KR", code:d.cd, name:d.nm,
    price:nv, prev:sv,
    chg: down ? -Math.abs(d.cv) : d.cv,
    pct: down ? -Math.abs(d.cr) : d.cr,
    open:d.ov, high:d.hv, low:d.lv, vol:d.aq, amt:d.aa,
    eps:d.eps, bps:d.bps, dv:d.dv, cnsEps:d.cnsEps, ul:d.ul, ll:d.ll,
    shares:d.countOfListedStock, state:d.ms,
    market:(u ? u.market : "KOSPI"), sector:(u ? u.sector : ""), industry:(u ? u.industry : ""),
    /* 파생 (벌크 필드만으로 즉시 계산) */
    capW:capW, capE:capW/1e8, amtE:(d.aa||0)/1e8,
    per:(d.eps > 0 ? nv/d.eps : null),
    fper:(d.cnsEps > 0 ? nv/d.cnsEps : null),
    pbr:(d.bps > 0 ? nv/d.bps : null),
    divy:(d.dv > 0 && nv > 0 ? d.dv/nv*100 : null),
    gap:(sv > 0 && d.ov > 0 ? (d.ov - sv)/sv*100 : null),
    range:(sv > 0 ? range/sv*100 : null),
    pos:(range > 0 ? (nv - d.lv)/range*100 : null),
    ulNear:(d.ul > 0 ? nv/d.ul*100 : null),
    turn:(capW > 0 ? (d.aa||0)/capW*100 : null),
    ok:true, at:Date.now()
  };
  var dp = DEEP[d.cd];
  if(dp) Object.keys(dp).forEach(function(k){ q[k] = dp[k]; });
  return q;
}


/* ===================== RSS (rss2json) =====================
   구글뉴스 / DART RSS 를 JSON 으로 변환해 읽는다. CORS 개방 확인됨.
   rss2json 은 간헐적으로 "Cannot download this RSS feed" 를 반환하므로
   (동일 URL 이 실패 후 재시도 시 성공) 10분 캐시 + 1회 재시도 + 스테일 폴백을 둔다. */
const RSS_TTL = 10*60*1000;

/* 커스텀 프록시(Cloudflare Worker)가 설정되면 rss2json 을 우회해 원본 XML 을 직접 파싱한다.
   워커 규약: {worker}/?url=<encodeURIComponent(원본 URL)>  */
function proxyBase(){ return (S.settings.proxy || "").trim().replace(/\/+$/, ""); }
function viaProxy(target){
  var p = proxyBase();
  return p ? (p + "/?url=" + encodeURIComponent(target)) : null;
}
/* 의존성 없는 RSS XML 파서 (DOMParser 미사용 — file:// 포함 어디서나 동일 동작) */
function decodeEnt(s){
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}
function parseRssXml(xml){
  var items = [], re = /<item[\s>]([\s\S]*?)<\/item>/g, m;
  function tag(s, n){
    var r = new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + n + ">");
    var x = r.exec(s);
    return x ? decodeEnt(x[1].trim()) : "";
  }
  while((m = re.exec(xml))){
    var s = m[1], cats = [], cre = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/g, c;
    while((c = cre.exec(s))) cats.push(decodeEnt(c[1].trim()));
    items.push({
      title:tag(s,"title"), link:tag(s,"link"), pubDate:tag(s,"pubDate"),
      author:tag(s,"dc:creator") || tag(s,"author"), categories:cats
    });
  }
  return items;
}

const RSS = (function(){
  var cache = {}, inflight = {}, calls = 0, pcalls = 0;
  function api(rssUrl){
    var px = viaProxy(rssUrl);
    if(px){                                   // 프록시 모드: 원본 XML 직접 파싱
      pcalls++;
      return fetch(px).then(function(r){
        if(!r.ok) throw new Error("프록시 HTTP " + r.status);
        return r.text();
      }).then(function(t){
        var items = parseRssXml(t);
        if(!items.length && t.indexOf("<item") < 0 && t.indexOf("<rss") < 0)
          throw new Error("프록시 응답이 RSS 가 아닙니다");
        return { items:items };
      });
    }
    calls++;
    return fetch("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(rssUrl))
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j || j.status !== "ok") throw new Error((j && j.message) || "RSS 변환 실패");
        return { items:j.items || [] };
      });
  }
  function get(key, rssUrl, force){
    var c = cache[key];
    if(!force && c && Date.now() - c.at < RSS_TTL){
      return Promise.resolve({ items:c.items, cached:true, stale:false, at:c.at });
    }
    if(inflight[key]) return inflight[key];
    var p = api(rssUrl)
      .catch(function(){                       // 간헐 실패 → 1.5초 후 1회 재시도
        return new Promise(function(r){ setTimeout(r, 1500); }).then(function(){ return api(rssUrl); });
      })
      .then(function(j){
        cache[key] = { at:Date.now(), items:j.items || [] };
        delete inflight[key];
        return { items:cache[key].items, cached:false, stale:false, at:cache[key].at };
      })

      .catch(function(e){
        delete inflight[key];
        if(c) return { items:c.items, cached:true, stale:true, at:c.at, err:e.message };
        throw e;
      });
    inflight[key] = p;
    return p;
  }
  return { get:get, cache:cache,
           calls:function(){ return calls; },          // rss2json 호출 수
           proxyCalls:function(){ return pcalls; },    // 프록시 호출 수
           mode:function(){ return proxyBase() ? "proxy" : "rss2json"; } };
})();

function gnewsRss(q){
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=ko&gl=KR&ceid=KR:ko";
}
function gnewsLink(q){
  return "https://news.google.com/search?q=" + encodeURIComponent(q) + "&hl=ko&gl=KR&ceid=KR:ko";
}
const DART_RSS = "https://dart.fss.or.kr/api/todayRSS.xml";
function dartSearchUrl(name){
  return "https://dart.fss.or.kr/dsab007/main.do?textCrpNm=" + encodeURIComponent(name);
}

/* ===================== 종목 이력 캐시 =====================
   스파크라인·기간수익률·호버 미니차트·차트그리드·트리맵(1주/1개월)·심층분석이 공유한다.
   JSONP 큐가 요청 간 150ms 를 보장하므로 여기서는 중복 요청만 막는다. */
const HIST = {};          // code -> {bars, months, at}
const histQ = {};         // code -> Promise (진행 중)
function loadHist(code, months){
  months = months || 6;
  var h = HIST[code];
  if(h && h.months >= months) return Promise.resolve(h.bars);
  if(histQ[code]) return histQ[code];
  var p = naverHistory(code, "day", ymdShift(months), todayStr()).then(function(bars){
    HIST[code] = { bars:bars, months:months, at:Date.now() };
    delete histQ[code];
    return bars;
  }).catch(function(e){ delete histQ[code]; throw e; });
  histQ[code] = p;
  return p;
}
/* n 거래일 전 대비 수익률 */
function perfDays(bars, days){
  if(!bars || bars.length < 2) return null;
  var last = bars[bars.length-1].c;
  var i = Math.max(0, bars.length-1-days);
  var base = bars[i].c;
  return base ? (last-base)/base*100 : null;
}
function perfYTD(bars){
  if(!bars || !bars.length) return null;
  var y = String(new Date().getFullYear()), first = null;
  for(var i=0;i<bars.length;i++){
    if(String(bars[i].d).slice(0,4) === y){ first = bars[i]; break; }
  }
  if(!first) return null;
  var last = bars[bars.length-1].c;
  return first.c ? (last-first.c)/first.c*100 : null;
}
function calcATR(bars, p){
  p = p || 14;
  if(!bars || bars.length < p+1) return null;
  var trs = [];
  for(var i=1;i<bars.length;i++){
    var b = bars[i], pv = bars[i-1].c;
    trs.push(Math.max(b.h-b.l, Math.abs(b.h-pv), Math.abs(b.l-pv)));
  }
  var a = trs.slice(0,p).reduce(function(s,v){ return s+v; }, 0)/p;
  for(var j=p;j<trs.length;j++) a = (a*(p-1) + trs[j])/p;
  return a;
}
/* 20일 로그수익률 표준편차 연율화(%) */
function calcVol(bars, n){
  n = n || 20;
  if(!bars || bars.length < n+1) return null;
  var r = [];
  for(var i=Math.max(1, bars.length-n); i<bars.length; i++) r.push(Math.log(bars[i].c/bars[i-1].c));
  if(r.length < 2) return null;
  var m = r.reduce(function(s,v){ return s+v; }, 0)/r.length;
  var v = r.reduce(function(s,x){ return s+(x-m)*(x-m); }, 0)/r.length;
  return Math.sqrt(v)*Math.sqrt(252)*100;
}

/* ===================== 공시 유형 분류 =====================
   보고서명에 전각 중점(ㆍ)·공백 변형이 섞여 있어 정규화 후 부분일치로 판정한다. */
const DC_TYPES = [
  { k:"stake", t:"지분변동", kw:["임원ㆍ주요주주특정증권등소유상황보고서","주식등의대량보유상황보고서",
      "최대주주등소유주식변동신고서","임원ㆍ주요주주특정증권등거래계획보고서","특정증권등소유상황"] },
  { k:"earn",  t:"실적",     kw:["사업보고서","분기보고서","반기보고서","영업(잠정)실적","잠정실적",
      "감사보고서","결산실적","매출액또는손익구조"] },
  { k:"major", t:"주요사항", kw:["주요사항보고서"] }
];
function normDc(s){ return String(s||"").replace(/[ㆍ·・·‧\s]/g, ""); }
function dcType(rpt){
  var n = normDc(rpt);
  for(var i=0;i<DC_TYPES.length;i++){
    for(var j=0;j<DC_TYPES[i].kw.length;j++){
      if(n.indexOf(normDc(DC_TYPES[i].kw[j])) >= 0) return DC_TYPES[i].k;
    }
  }
  return "etc";
}

/* rss2json pubDate: "2026-08-02 01:46:06" (UTC) */
function relTime(s){
  if(!s) return "";
  var t = new Date(String(s).replace(" ", "T") + "Z");
  if(isNaN(t)) t = new Date(s);
  if(isNaN(t)) return "";
  var d = (Date.now() - t.getTime())/1000;
  if(d < 60) return "방금";
  if(d < 3600) return Math.floor(d/60) + "분 전";
  if(d < 86400) return Math.floor(d/3600) + "시간 전";
  if(d < 86400*7) return Math.floor(d/86400) + "일 전";
  return t.toLocaleDateString("ko-KR");
}
/* 구글뉴스 제목은 "제목 - 출처" 형태 */
function splitHeadline(t){
  t = t || "";
  var i = t.lastIndexOf(" - ");
  return i > 0 ? { head:t.slice(0,i), src:t.slice(i+3) } : { head:t, src:"" };
}
function newsListHtml(items, n){
  if(!items.length) return '<div style="color:var(--tx3)">표시할 뉴스가 없습니다.</div>';
  return "<ul>" + items.slice(0, n).map(function(it){
    var s = splitHeadline(it.title);
    return "<li><a href='" + esc(it.link) + "' target='_blank' rel='noopener'>" + esc(s.head) + "</a>" +
      '<div class="dt"><span class="src">' + esc(s.src || it.author || "") + "</span>" +
      (s.src || it.author ? " · " : "") + esc(relTime(it.pubDate)) + "</div></li>";
  }).join("") + "</ul>";
}
/* DART RSS 항목 파싱.
   실측 형태: title="(유가)현대퓨처넷 - 연결재무제표기준영업(잠정)실적(공정공시)"
              author(dc:creator)="현대퓨처넷", categories=["유가"] */
function parseDart(it){
  var t = (it.title || "").trim();
  var comp = (it.author || "").trim();
  var mkt = (it.categories && it.categories[0]) || "";
  var m0 = t.match(/^\(([^)]*)\)\s*(.*)$/);          // 앞머리 (유가)/(코스닥) 제거
  if(m0){ if(!mkt) mkt = m0[1]; t = m0[2]; }
  var rpt = t, i = t.indexOf(" - ");
  if(i > 0){ if(!comp) comp = t.slice(0, i); rpt = t.slice(i+3); }
  else if(!comp){                                     // "[회사] 보고서" 변형 대비
    var m1 = t.match(/^\[([^\]]+)\]\s*(.+)$/);
    if(m1){ comp = m1[1]; rpt = m1[2]; }
  }
  return { comp:comp, rpt:rpt, mkt:mkt, link:it.link, at:it.pubDate, type:dcType(rpt) };
}
/* 내 종목(전체 관심그룹 + 보유) 이름 목록 */
function myNames(){
  var m = {};
  allWL().concat(S.portfolio).forEach(function(x){ m[x.name] = true; });
  return Object.keys(m);
}

/* ===================== 지표 ===================== */
function calcMA(closes, p){
  var out = new Array(closes.length).fill(null), s = 0;
  for(var i=0;i<closes.length;i++){
    s += closes[i];
    if(i >= p) s -= closes[i-p];
    if(i >= p-1) out[i] = s/p;
  }
  return out;
}
function calcRSI(closes, period){
  period = period || 14;
  var out = new Array(closes.length).fill(null);
  if(closes.length <= period) return out;
  var gain = 0, loss = 0, i;
  for(i=1;i<=period;i++){
    var ch = closes[i]-closes[i-1];
    if(ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100/(1 + gain/loss);
  for(i=period+1;i<closes.length;i++){
    var c = closes[i]-closes[i-1];
    gain = (gain*(period-1) + (c > 0 ? c : 0))/period;
    loss = (loss*(period-1) + (c < 0 ? -c : 0))/period;
    out[i] = loss === 0 ? 100 : 100 - 100/(1 + gain/loss);
  }
  return out;
}
function lastOf(arr){
  for(var i=arr.length-1;i>=0;i--){ if(arr[i] !== null && arr[i] !== undefined) return arr[i]; }
  return null;
}

/* 과거 봉에서 심층 지표 산출 */
function deepMetrics(bars, todayVol){
  var closes = bars.map(function(b){ return b.c; });
  var cur = closes[closes.length-1];
  if(!cur) return null;
  var ma20 = calcMA(closes,20), ma60 = calcMA(closes,60), ma120 = calcMA(closes,120);
  var m20 = lastOf(ma20), m60 = lastOf(ma60), m120 = lastOf(ma120);
  var win = bars.slice(-252);
  var hi52 = Math.max.apply(null, win.map(function(b){ return b.h; }));
  var lo52 = Math.min.apply(null, win.map(function(b){ return b.l; }));
  /* 20일 평균 거래량 (당일 제외) 대비 배율 */
  var v20 = bars.slice(-21, -1).map(function(b){ return b.v; });
  var avgV = v20.length ? v20.reduce(function(s,v){ return s+v; },0)/v20.length : 0;
  /* 골든크로스: 현재 MA20>MA60 이고 최근 10봉 내 교차 발생 */
  var gc = 0;
  if(m20 !== null && m60 !== null && m20 > m60){
    for(var i=Math.max(1, ma20.length-10); i<ma20.length; i++){
      if(ma20[i-1] !== null && ma60[i-1] !== null && ma20[i-1] <= ma60[i-1] && ma20[i] > ma60[i]){ gc = 1; break; }
    }
  }
  var atr = calcATR(bars, 14);
  return {
    rsi: lastOf(calcRSI(closes,14)),
    sep20: m20 ? (cur-m20)/m20*100 : null,
    sep60: m60 ? (cur-m60)/m60*100 : null,
    sep120: m120 ? (cur-m120)/m120*100 : null,
    pos52: (hi52 > lo52) ? (cur-lo52)/(hi52-lo52)*100 : null,
    hi52:hi52, lo52:lo52,
    /* 52주 고/저 근접도(%): 0 에 가까울수록 신고가/신저가에 붙어 있음 */
    nearHi: hi52 ? (hi52-cur)/hi52*100 : null,
    nearLo: lo52 ? (cur-lo52)/lo52*100 : null,
    pw: perfDays(bars, 5), pm: perfDays(bars, 21), pytd: perfYTD(bars),
    atr: atr, atrp: (atr && cur) ? atr/cur*100 : null,
    vol20: calcVol(bars, 20),
    volx: (avgV > 0 && todayVol) ? todayVol/avgV : null,
    gc: gc
  };
}
