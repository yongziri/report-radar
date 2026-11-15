/* =========================================================================
   리포트 확장 — 내 종목 리포트(대시보드 패널·알림) · 성적표 · 산업·시황
   09_reports.js 의 전역(RPT, rpByCode, RMETA, RP_READY, rpEnsureHistory …)을 그대로 쓴다.
   데이터 규약: docs/DATA-FORMAT-v2.md (data/perf.json, data/industry/YYYY-MM.json,
   meta 의 perf_v · industry_months — 없으면 해당 기능을 숨기거나 "준비 중"으로 둔다).
   ========================================================================= */

/* ---------- 내 종목 리포트 ---------- */
const MR_LS_CFG = "rr:repalert:v1";          // 알림 설정
const MR_LS_SEEN = "rr:repalert:seen:v1";    // 종목별로 이미 본 리포트 + 안 읽은 목록
const MR_DAYS = 14;                          // 패널에 보이는 기간
const MR_ROWS = 12;                          // 패널 최대 행 수
const MR_ALERT_DAYS = 7;                     // 이보다 오래된 리포트는 처음 봐도 알리지 않는다 (늦게 받은 지난 달 파일)
const MR_KEEP_DAYS = 30;                     // 본 표시를 남겨 둘 기간 (그보다 오래된 것은 알릴 일이 없다)
const MR_KEEP_PER_CODE = 120;
const MR_UNREAD_MAX = 200;
const MR_TOAST_MAX = 3;                      // 한 번에 띄우는 토스트 수 (나머지는 한 줄로 묶는다)
const MR_TYPES = [["new","새 리포트"], ["up","목표가 상향"], ["down","목표가 하향"], ["rating","투자의견 변경"]];
const MR_RATED = ["BUY","HOLD","SELL"];

let MR_CFG = { on:true, types:{ "new":true, up:true, down:true, rating:true }, beep:false };
let MR_SEEN = null;              // { v:1, codes:{ code:{ key:"YYYY-MM-DD" } }, unread:[id] }
let mrFresh = {};                // 이번 세션에 새로 들어온 리포트 id (패널에서 강조)
let mrViewTimer = null;

function mrLoadCfg(){
  try{
    var o = JSON.parse(localStorage.getItem(MR_LS_CFG) || "null");
    if(!o || typeof o !== "object") return;
    if(typeof o.on === "boolean") MR_CFG.on = o.on;
    if(typeof o.beep === "boolean") MR_CFG.beep = o.beep;
    if(o.types && typeof o.types === "object"){
      MR_TYPES.forEach(function(t){ if(typeof o.types[t[0]] === "boolean") MR_CFG.types[t[0]] = o.types[t[0]]; });
    }
  }catch(e){}
}
function mrSaveCfg(){ try{ localStorage.setItem(MR_LS_CFG, JSON.stringify(MR_CFG)); }catch(e){} }
function mrLoadSeen(){
  if(MR_SEEN) return MR_SEEN;
  var o = null;
  try{ o = JSON.parse(localStorage.getItem(MR_LS_SEEN) || "null"); }catch(e){}
  if(!o || typeof o !== "object" || !o.codes || typeof o.codes !== "object" || Array.isArray(o.codes))
    o = { v:1, codes:{}, unread:[] };
  if(!Array.isArray(o.unread)) o.unread = [];
  MR_SEEN = o;
  return o;
}
function mrSaveSeen(){ try{ localStorage.setItem(MR_LS_SEEN, JSON.stringify(MR_SEEN)); }catch(e){} }

/* 내 종목 = 관심종목(모든 그룹) ∪ 모든 계좌의 보유 종목 */
function mrCodes(){
  var set = {};
  allWL().forEach(function(x){ if(x && x.code) set[x.code] = 1; });
  ACCTS().forEach(function(a){ a.items.forEach(function(x){ if(x && x.code) set[x.code] = 1; }); });
  return set;
}
/* 같은 리포트가 소스를 바꿔(한경 → 네이버 등) id 가 달라져도 다시 알리지 않게 날짜+증권사 키도 함께 둔다 */
function mrKeys(r){ return [r.id, "k:" + (r.date || "") + "|" + rpNorm(r.broker)]; }

/* 본 표시 갱신. detect=true 면 처음 보는 최근 리포트를 돌려준다.
   처음 보는 종목(첫 실행·종목 추가)은 알리지 않고 그 시점의 리포트를 기준으로만 기록한다. */
function mrSync(detect){
  if(!RP_READY) return [];
  var seen = mrLoadSeen(), codes = mrCodes(), found = [], changed = false;
  var base = rpBaseISO();
  var keepFloor = rpShiftISO(base, -MR_KEEP_DAYS), alertFloor = rpShiftISO(base, -(MR_ALERT_DAYS - 1));
  Object.keys(seen.codes).forEach(function(c){
    if(!codes[c]){ delete seen.codes[c]; changed = true; }    // 내 종목에서 빠지면 지운다 (다시 넣으면 새 기준선)
  });
  Object.keys(codes).forEach(function(c){
    var list = (rpByCode[c] || []).filter(function(r){ return rpStatOk(r) && (r.date || "") >= keepFloor; });
    var m = seen.codes[c];
    if(!m || typeof m !== "object"){
      m = seen.codes[c] = {};
      list.forEach(function(r){ mrKeys(r).forEach(function(k){ m[k] = r.date || ""; }); });
      changed = true;
      return;
    }
    if(!detect) return;
    list.forEach(function(r){
      var ks = mrKeys(r);
      var known = ks.some(function(k){ return m[k] !== undefined; });
      if(!known && (r.date || "") >= alertFloor) found.push(r);
      ks.forEach(function(k){ if(m[k] === undefined){ m[k] = r.date || ""; changed = true; } });
    });
    /* 오래된 표시는 버리고 종목당 개수를 제한한다 */
    var ks2 = Object.keys(m);
    ks2.forEach(function(k){ if(m[k] < keepFloor){ delete m[k]; changed = true; } });
    ks2 = Object.keys(m);
    if(ks2.length > MR_KEEP_PER_CODE){
      ks2.sort(function(a, b){ return String(m[b]).localeCompare(String(m[a])); })
        .slice(MR_KEEP_PER_CODE).forEach(function(k){ delete m[k]; });
      changed = true;
    }
  });
  if(found.length){
    var ids = found.map(function(r){ return r.id; });
    seen.unread = ids.concat(seen.unread.filter(function(i){ return ids.indexOf(i) < 0; })).slice(0, MR_UNREAD_MAX);
    changed = true;
  }
  if(changed) mrSaveSeen();
  return found;
}

/* 같은 종목+증권사의 직전 리포트 (확인 필요 제외) */
function mrPrevOf(r){
  var list = rpByCode[r.code] || [], nb = rpNorm(r.broker), past = false;
  for(var i=0;i<list.length;i++){
    var x = list[i];
    if(x === r){ past = true; continue; }
    if(!past && (x.date || "") >= (r.date || "")) continue;
    if(rpStatOk(x) && rpNorm(x.broker) === nb) return x;
  }
  return null;
}
function mrTypesOf(r){
  var t = { "new":true };
  if(r.target_change === "up") t.up = true;
  else if(r.target_change === "down") t.down = true;
  var p = mrPrevOf(r);
  if(p && MR_RATED.indexOf(r.rating) >= 0 && MR_RATED.indexOf(p.rating) >= 0 && p.rating !== r.rating){
    t.rating = true; t.prevRating = p.rating;
  }
  return t;
}
function mrMsg(r, t){
  var parts = [];
  if(t.up && MR_CFG.types.up) parts.push("목표가 상향 " + fmt(r.prev_target) + " → " + fmt(r.target));
  if(t.down && MR_CFG.types.down) parts.push("목표가 하향 " + fmt(r.prev_target) + " → " + fmt(r.target));
  if(t.rating && MR_CFG.types.rating) parts.push("의견 " + t.prevRating + " → " + r.rating);
  if(!parts.length) parts.push("새 리포트" + (r.rating ? " " + r.rating : "") +
                               (typeof r.target === "number" ? " · 목표가 " + fmt(r.target) : ""));
  return "[리포트] " + rpName(r.code, r.name) + " · " + (r.broker || "") + " — " + parts.join(" · ") +
         (r.title ? " · 「" + r.title + "」" : "");
}
/* 알림: 기존 알림 탭과 같은 경로 (토스트 · 소리 · 브라우저 알림 · 알림 기록) */
function mrAlert(found){
  if(!MR_CFG.on || !found.length) return 0;
  var msgs = [];
  found.forEach(function(r){
    var t = mrTypesOf(r), hit = false;
    MR_TYPES.forEach(function(tp){ if(t[tp[0]] && MR_CFG.types[tp[0]]) hit = true; });
    if(hit) msgs.push(mrMsg(r, t));
  });
  if(!msgs.length) return 0;
  var at = new Date().toLocaleString("ko-KR");
  msgs.slice().reverse().forEach(function(m){ S.alertLog.unshift({ msg:m, at:at }); });
  S.alertLog = S.alertLog.slice(0, 200);
  save();
  if(curTab === "alr") renderAlertLog();
  if(MR_CFG.beep) beep();
  msgs.slice(0, MR_TOAST_MAX).forEach(function(m){ toast("알림: " + m, "ok"); });
  if(msgs.length > MR_TOAST_MAX) toast("내 종목 리포트 " + (msgs.length - MR_TOAST_MAX) + "건 더 — 알림 기록 참조", "ok");
  if(msgs.length <= MR_TOAST_MAX) msgs.forEach(function(m){ notify("내 종목 리포트", m); });
  else notify("내 종목 리포트", "새 리포트 " + msgs.length + "건 · " + msgs[0]);
  return msgs.length;
}

/* 09 의 rpLoad·rpDataChanged 가 데이터를 받은 직후(rpRebuild 다음) 부른다 */
function myRepOnData(){
  var found = mrSync(true);
  found.forEach(function(r){ mrFresh[r.id] = 1; });
  if(found.length) mrAlert(found);
  mrRender();
}

function mrBadges(){
  var n = mrLoadSeen().unread.length;
  var b = $("#myRepBadge");
  if(b){ b.textContent = n > 99 ? "99+" : String(n); b.classList.toggle("hide", !n); }
  var tb = $("#tabbtn-rep");
  if(tb){
    var s = tb.querySelector(".nbadge");
    if(n && !s){ s = document.createElement("span"); s.className = "nbadge"; tb.appendChild(s); }
    if(s){
      if(n){ s.textContent = n > 99 ? "99+" : String(n); s.title = "내 종목 새 리포트 " + n + "건"; }
      else s.remove();
    }
  }
}
/* 패널을 보거나 리포트 탭을 열면 안 읽은 수를 비운다 (둘이 같은 목록을 쓴다) */
function myRepMarkSeen(){
  var seen = mrLoadSeen();
  if(!seen.unread.length) return;
  seen.unread = [];
  mrSaveSeen();
  mrBadges();
}

function mrRender(){
  var box = $("#myRep");
  if(!box) return;
  mrBadges();
  if(!RP_READY){
    box.innerHTML = '<div style="color:var(--tx3)">리포트 데이터를 불러오는 중…</div>';
    return;
  }
  mrSync(false);
  var codes = Object.keys(mrCodes());
  var sub = $("#myRepSub");
  if(!codes.length){
    if(sub) sub.textContent = "관심·보유 종목 · 최근 " + MR_DAYS + "일";
    box.innerHTML = '<div style="color:var(--tx3)">관심종목이나 보유 종목이 없습니다. 아래 관심종목 검색창이나 계좌 탭에서 추가하면 그 종목의 리포트가 여기에 모입니다.</div>';
    $("#myRepMore").classList.add("hide");
    return;
  }
  var floor = rpShiftISO(rpBaseISO(), -(MR_DAYS - 1)), rows = [], withRep = 0;
  codes.forEach(function(c){
    var n0 = rows.length;
    (rpByCode[c] || []).forEach(function(r){ if((r.date || "") >= floor) rows.push(r); });
    if(rows.length > n0) withRep++;
  });
  rows.sort(function(a, b){
    return String(b.date || "").localeCompare(String(a.date || "")) || (mrFresh[b.id] ? 1 : 0) - (mrFresh[a.id] ? 1 : 0);
  });
  if(sub) sub.textContent = "관심·보유 " + codes.length + "종목 · 최근 " + MR_DAYS + "일 " + rows.length + "건" +
                            (withRep ? " (" + withRep + "종목)" : "");
  $("#myRepMore").classList.toggle("hide", !rows.length);
  if(!rows.length){
    box.innerHTML = '<div style="color:var(--tx3)">최근 ' + MR_DAYS + "일 동안 내 종목(" + codes.length +
                    "종목)에 나온 리포트가 없습니다.</div>";
    return;
  }
  var unread = {};
  mrLoadSeen().unread.forEach(function(i){ unread[i] = 1; });
  box.innerHTML = '<div class="tbw"><table class="rtbl mrtbl"><thead><tr><th class="l">날짜</th><th class="l">종목</th>' +
    '<th class="l">증권사</th><th class="c">의견</th><th>목표주가</th><th>괴리율</th></tr></thead><tbody>' +
    rows.slice(0, MR_ROWS).map(function(r){
      var link = r.pdf || r.url || "";
      var isNew = unread[r.id] || mrFresh[r.id];
      return '<tr' + (isNew ? ' class="mrnew"' : "") + '><td class="l dt">' + esc((r.date || "").slice(5)) +
        (isNew ? ' <span class="mrdot" title="새로 들어온 리포트">NEW</span>' : "") + "</td>" +
        '<td class="l"><a class="tk rpgo" href="#" data-go="' + esc(r.code) + '" title="종목분석에서 열기">' +
          esc(rpName(r.code, r.name)) + "</a>" +
          (link ? ' <a class="rnav" href="' + esc(link) + '" target="_blank" rel="noopener" title="' +
                  esc(r.title || "원문") + '">원문↗</a>' : "") + "</td>" +
        '<td class="l">' + esc(r.broker || "") + "</td>" +
        '<td class="c">' + rpBadgeOf(r) + "</td>" +
        "<td>" + rpTargetCell(r) + rpSuspectTag(r) + "</td>" +
        "<td>" + rpGapCell(rpGapOf(r)) + "</td></tr>";
    }).join("") + "</tbody></table></div>" +
    (rows.length > MR_ROWS ? '<div class="mrmore">' + fmt(rows.length - MR_ROWS) +
      '건 더 있음 · <a href="#" id="myRepMore2">리포트 탭에서 모두 보기 →</a></div>' : "");
}
/* "더 보기": 리포트 탭을 내 종목(리포트가 있는 종목)으로 거른다 */
function mrGotoReports(){
  var codes = Object.keys(mrCodes()), floor = rpShiftISO(rpBaseISO(), -(MR_DAYS - 1));
  RP.codes = codes.filter(function(c){
    return (rpByCode[c] || []).some(function(r){ return (r.date || "") >= floor; });
  });
  if(!RP.codes.length) RP.codes = codes;
  RP.view = "reports";
  RP.period = "30";
  RP.sortKey = "date"; RP.sortDir = "desc";
  showTab("rep");
  rpRender();
  window.scrollTo(0, 0);
}

/* 알림 탭: 리포트 알림 설정 */
function mrSyncCfgUI(){
  var on = $("#mrOn");
  if(!on) return;
  on.checked = MR_CFG.on;
  $$("[data-mrt]").forEach(function(el){
    el.checked = !!MR_CFG.types[el.dataset.mrt];
    el.disabled = !MR_CFG.on;
  });
  $("#mrBeep").checked = MR_CFG.beep;
  $("#mrBeep").disabled = !MR_CFG.on;
  var n = Object.keys(mrCodes()).length;
  $("#mrAlSub").textContent = "대상: 관심·보유 " + n + "종목" + (MR_CFG.on ? "" : " · 꺼짐");
}
function mrInit(){
  mrLoadCfg();
  mrSyncCfgUI();
  var box = $("#mrAlPanel");
  if(box) box.addEventListener("change", function(e){
    var el = e.target;
    if(el.id === "mrOn") MR_CFG.on = el.checked;
    else if(el.id === "mrBeep") MR_CFG.beep = el.checked;
    else if(el.dataset && el.dataset.mrt) MR_CFG.types[el.dataset.mrt] = el.checked;
    else return;
    mrSaveCfg();
    mrSyncCfgUI();
  });
  var panel = $("#myRepPanel");
  if(panel){
    panel.addEventListener("click", function(e){
      var go = e.target.closest("[data-go]");
      if(go){ e.preventDefault(); rpGotoAnal(go.dataset.go); return; }
      if(e.target.closest("#myRepMore, #myRepMore2")){ e.preventDefault(); mrGotoReports(); }
    });
    /* 패널이 화면에 2초 넘게 보이면 읽은 것으로 친다 */
    if(window.IntersectionObserver){
      new IntersectionObserver(function(ents){
        var vis = ents.some(function(en){ return en.isIntersecting; });
        clearTimeout(mrViewTimer);
        if(vis) mrViewTimer = setTimeout(function(){
          if(curTab === "dash" && !document.hidden) myRepMarkSeen();
        }, 2000);
      }, { threshold:0.4 }).observe(panel);
    }
  }
  /* 관심종목·보유 종목이 바뀌면 패널도 다시 그린다 (04 를 건드리지 않고 전역을 감싼다) */
  if(!renderWatchlist.mrWrapped){
    var rw = renderWatchlist;
    renderWatchlist = function(){ var v = rw.apply(this, arguments); mrRender(); return v; };
    renderWatchlist.mrWrapped = true;
  }
  if(!renderPortfolio.mrWrapped){
    var rpf = renderPortfolio;
    renderPortfolio = function(){ var v = rpf.apply(this, arguments); mrRender(); return v; };
    renderPortfolio.mrWrapped = true;
  }
  mrRender();
}

/* ---------- 성과 데이터 (data/perf.json) ---------- */
const RX_LS = "rr:repx:v1";                  // 성적표·산업·시황 화면 상태
const SC_AGES = [30, 60, 90];
const RX = {
  sc:{ mode:"broker", minB:10, minA:5, age:30, sortKey:"n", sortDir:"desc" },
  ind:{ kinds:[], cat:"", broker:"", period:"30", q:"" }
};
let RP_PERF = null;              // { v, updated_at, items }
let rpPerfP = null, rpPerfPv = "", rpPerfFailV = "", rpPerfErr = "";

function rxSave(){ try{ localStorage.setItem(RX_LS, JSON.stringify(RX)); }catch(e){} }
function rxLoad(){
  try{
    var o = JSON.parse(localStorage.getItem(RX_LS) || "null");
    if(!o || typeof o !== "object") return;
    ["sc", "ind"].forEach(function(g){
      if(!o[g] || typeof o[g] !== "object") return;
      for(var k in RX[g]){ if(Object.prototype.hasOwnProperty.call(o[g], k) && typeof o[g][k] === typeof RX[g][k]) RX[g][k] = o[g][k]; }
    });
  }catch(e){}
  if(RX.sc.mode !== "analyst") RX.sc.mode = "broker";
  if(SC_AGES.indexOf(RX.sc.age) < 0) RX.sc.age = 30;
  if(!(RX.sc.minB >= 1)) RX.sc.minB = 10;
  if(!(RX.sc.minA >= 1)) RX.sc.minA = 5;
  if(RX.sc.sortDir !== "asc") RX.sc.sortDir = "desc";
  if(!Array.isArray(RX.ind.kinds)) RX.ind.kinds = [];
  if(["1","3","7","30","all"].indexOf(RX.ind.period) < 0) RX.ind.period = "30";
}

function rpPerfAvail(){ return !!(RMETA && RMETA.perf_v); }
/* perf.json 을 (버전이 바뀌었으면 다시) 받는다. 받은 뒤 리포트 목록·종목분석 패널을 다시 그린다 */
function rpPerfEnsure(){
  if(!rpPerfAvail()) return;
  var v = String(RMETA.perf_v);
  if(RP_PERF && RP_PERF.v === v) return;
  if(rpPerfP && rpPerfPv === v) return;
  if(rpPerfFailV === v) return;                // 같은 버전에서 실패했으면 다시 조르지 않는다 (meta 가 바뀌면 재시도)
  rpPerfPv = v;
  rpPerfP = rpFetchJson("data/perf.json?v=" + encodeURIComponent(v)).then(function(j){
    RP_PERF = { v:v, updated_at:(j && j.updated_at) || "", items:(j && j.items && typeof j.items === "object") ? j.items : {} };
    rpPerfErr = "";
  }, function(err){
    rpPerfFailV = v;
    rpPerfErr = (err && err.message) ? err.message : String(err);
    console.warn("perf.json 적재 실패:", rpPerfErr);
  }).then(function(){
    rpPerfP = null;
    rpRender(true);
    rpRenderAnal();
  });
}
/* 목표가 도달 표시 (perf 항목에 hit 가 있을 때) */
function rpHitTag(r){
  var it = (RP_PERF && r && r.id) ? RP_PERF.items[r.id] : null;
  if(!it || !it.hit) return "";
  return '<span class="rhit" title="' + esc("목표가 도달: " + it.hit + " (발간 후 장중 고가가 목표가에 처음 닿은 날)") + '">도달 ' +
         esc(String(it.hit).slice(5)) + "</span>";
}

/* ---------- 성적표 ---------- */
function rxDays(a, b){
  var x = Date.parse(a + "T00:00:00Z"), y = Date.parse(b + "T00:00:00Z");
  return (isNaN(x) || isNaN(y)) ? null : Math.round((y - x) / 86400000);
}
function scCompute(){
  var items = RP_PERF.items, analyst = RX.sc.mode === "analyst";
  var cut = rpShiftISO(rpTodayISO(), -RX.sc.age);
  var map = {}, total = 0, first = "", last = "", start = "";
  for(var i=0;i<RPT.length;i++){
    var r = RPT[i], d = r.date || "";
    if(d && (!start || d < start)) start = d;
    if(!rpStatOk(r) || typeof r.target !== "number" || !r.broker) continue;
    if(d > cut) continue;
    var p = items[r.id];
    if(!p || !(p.paw > 0)) continue;
    if(analyst && !r.analyst) continue;
    var key = analyst ? r.broker + "\u0001" + r.analyst : r.broker;
    var g = map[key] || (map[key] = { broker:r.broker, analyst:analyst ? r.analyst : "", n:0, buy:0,
                                      gw:[], ret:[], hit:0, days:[], mx:[] });
    g.n++; total++;
    if(!first || d < first) first = d;
    if(d > last) last = d;
    if(r.rating === "BUY") g.buy++;
    g.gw.push((r.target - p.paw) / p.paw * 100);
    var cur = rpCodePrice(r.code);
    if(cur) g.ret.push((cur - p.paw) / p.paw * 100);
    if(p.hit){
      g.hit++;
      var dd = rxDays(d, String(p.hit));
      if(dd !== null) g.days.push(dd);
    }
    if(typeof p.max === "number") g.mx.push((p.max - p.paw) / p.paw * 100);
  }
  var min = analyst ? RX.sc.minA : RX.sc.minB, rows = [], below = 0;
  Object.keys(map).forEach(function(k){
    var g = map[k];
    if(g.n < min){ below++; return; }
    g.name = analyst ? g.analyst : g.broker;
    g.buyR = Math.round(g.buy / g.n * 1000) / 10;
    g.medGw = rpMedian(g.gw);
    g.medRet = rpMedian(g.ret);
    g.hitR = Math.round(g.hit / g.n * 1000) / 10;
    g.medDays = g.days.length ? Math.round(rpMedian(g.days)) : null;
    g.medMx = rpMedian(g.mx);
    rows.push(g);
  });
  return { rows:rows, total:total, first:first, last:last, start:start, cut:cut, below:below, min:min };
}
const SC_COLS = [
  { key:"name",   label:"증권사",               al:"l", get:function(g){ return g.name; } },
  { key:"n",      label:"리포트 수",            get:function(g){ return g.n; } },
  { key:"buyR",   label:"BUY 비율",             get:function(g){ return g.buyR; } },
  { key:"medGw",  label:"발간 시 괴리율",       get:function(g){ return g.medGw; },
    tip:"중앙값: (목표가 − 발간일 종가) ÷ 발간일 종가" },
  { key:"medRet", label:"발간 후 수익률",       get:function(g){ return g.medRet; },
    tip:"중앙값: (현재가 − 발간일 종가) ÷ 발간일 종가 · 배당 제외 주가 기준" },
  { key:"hitR",   label:"목표가 도달률",        get:function(g){ return g.hitR; },
    tip:"발간 후 장중 고가가 목표가에 닿은 리포트 비율" },
  { key:"medDays",label:"도달까지(일)",         get:function(g){ return g.medDays; },
    tip:"도달한 리포트의 발간일 → 도달일 달력 일수 중앙값" },
  { key:"medMx",  label:"최대 상승 실현",       get:function(g){ return g.medMx; },
    tip:"중앙값: (발간 후 최고가 − 발간일 종가) ÷ 발간일 종가" }
];
function scSort(rows){
  var col = null;
  SC_COLS.forEach(function(c){ if(c.key === RX.sc.sortKey) col = c; });
  if(!col) col = SC_COLS[1];
  var dir = RX.sc.sortDir === "asc" ? 1 : -1;
  return rows.slice().sort(function(x, y){
    var a = col.get(x), b = col.get(y);
    var an = (a === null || a === undefined), bn = (b === null || b === undefined);
    if(an !== bn) return an ? 1 : -1;
    if(!an){
      var c = (typeof a === "number") ? a - b : String(a).localeCompare(String(b), "ko");
      if(c) return c * dir;
    }
    return y.n - x.n;
  });
}
function scPct(v, colorize){
  if(v === null || v === undefined) return '<span class="flat">-</span>';
  return colorize ? '<span class="' + dirCls(v) + '">' + fmtPct(v) + "</span>" : fmtPct(v).replace(/^\+/, "");
}
function rpRenderScore(){
  $$("#scMode button").forEach(function(b){ b.classList.toggle("act", b.dataset.m === RX.sc.mode); });
  $$("#scAge button").forEach(function(b){ b.classList.toggle("act", +b.dataset.a === RX.sc.age); });
  var minEl = $("#scMin"), analyst = RX.sc.mode === "analyst";
  if(document.activeElement !== minEl) minEl.value = analyst ? RX.sc.minA : RX.sc.minB;
  var cap = $("#scCap"), thead = $("#scThead"), tbody = $("#scTbody"), em = $("#scEmpty"), ctl = $("#scCtl");
  function state(msg){
    cap.innerHTML = ""; thead.innerHTML = ""; tbody.innerHTML = "";
    em.innerHTML = msg; em.style.display = "block";
    $("#scTable").style.display = "none";
  }
  if(!rpPerfAvail()){
    ctl.classList.add("hide");
    $("#scSub").textContent = "";
    state("<b>성과 데이터 준비 중</b><br>수집기가 발간 후 주가(data/perf.json)를 만들면 증권사·애널리스트 성적표가 여기에 나옵니다.");
    return;
  }
  ctl.classList.remove("hide");
  rpEnsureHistory(Infinity);                   // 성적표는 보관 중인 전 기간을 쓴다 (받는 동안 위에 안내)
  rpPerfEnsure();
  if(!RP_PERF){
    $("#scSub").textContent = "";
    state(rpPerfErr && rpPerfFailV === String(RMETA.perf_v)
      ? '<span class="down">성과 데이터를 불러오지 못했습니다.</span> <button class="btn xs" id="scRetry">다시 시도</button>'
      : '<span class="spin"></span>성과 데이터를 불러오는 중…');
    return;
  }
  var res = scCompute(), rows = scSort(res.rows);
  var partial = rpIsPartial();
  $("#scSub").textContent = (analyst ? "애널리스트 " : "증권사 ") + rows.length + (analyst ? "명" : "곳") +
    " · 리포트 " + fmt(res.total) + "건" + (partial ? " · 일부 데이터" : "");
  cap.innerHTML =
    "대상: " + (res.first ? esc(res.first) + " ~ " + esc(res.last) : "-") + " 발간 · 발간 후 " + RX.sc.age + "일 이상 지난 리포트 (" +
    esc(res.cut) + "까지) · 확인 필요 제외, 목표가와 성과 데이터가 있는 것만 · 보관 시작 " +
    (partial ? "불러오는 중" : esc(res.start || "-")) + "<br>" +
    "수익률은 <b>배당을 뺀 주가만</b>으로 계산 · 도달 = 발간 다음 거래일 이후 장중 고가가 목표가에 닿음 · " +
    "현재가는 실시간 시세(없으면 수집 시점 종가) · 성과 " + esc(String(RP_PERF.updated_at || "").replace("T", " ").slice(0, 16)) + " 기준 · " +
    "<b>기간·업종·증권사 필터는 이 화면에 적용되지 않습니다</b>" +
    (res.below ? " · 표본 " + res.min + "건 미만 " + res.below + (analyst ? "명" : "곳") + " 숨김" : "");
  if(!rows.length){
    thead.innerHTML = ""; tbody.innerHTML = "";
    em.innerHTML = "조건(표본 " + res.min + "건 이상, 발간 후 " + RX.sc.age + "일 이상)에 맞는 " + (analyst ? "애널리스트" : "증권사") +
                   "가 없습니다. 최소 표본을 낮추거나 기간을 줄여 보세요.";
    em.style.display = "block";
    $("#scTable").style.display = "none";
    return;
  }
  em.style.display = "none";
  $("#scTable").style.display = "table";
  thead.innerHTML = "<tr>" + SC_COLS.map(function(c){
    var on = RX.sc.sortKey === c.key;
    var label = (c.key === "name" && analyst) ? "애널리스트 (증권사)" : c.label;
    return '<th class="srt' + (c.al ? " " + c.al : "") + (on ? " on" : "") + '" data-ss="' + c.key +
           '" tabindex="0" role="button"' + (c.tip ? ' title="' + esc(c.tip) + '"' : "") + ">" + esc(label) +
           (on ? (RX.sc.sortDir === "asc" ? " ▲" : " ▼") : "") + "</th>";
  }).join("") + "</tr>";
  tbody.innerHTML = rows.map(function(g){
    var label = analyst
      ? esc(g.analyst) + '<span class="rsub">' + esc(g.broker) + "</span>"
      : esc(g.broker);
    return '<tr class="scrow" data-scb="' + esc(g.broker) + '" data-sca="' + esc(g.analyst) +
           '" title="이 ' + (analyst ? "애널리스트" : "증권사") + '의 리포트 보기">' +
      '<td class="l"><b>' + label + "</b></td>" +
      "<td><b>" + fmt(g.n) + "</b></td>" +
      "<td>" + g.buyR.toFixed(1) + "%</td>" +
      "<td>" + scPct(g.medGw, true) + "</td>" +
      "<td>" + scPct(g.medRet, true) + '<span class="rsub">' + g.ret.length + "건</span></td>" +
      "<td><b>" + g.hitR.toFixed(1) + '%</b><span class="rsub">' + g.hit + " / " + g.n + "</span></td>" +
      "<td>" + (g.medDays === null ? '<span class="flat">-</span>' : fmt(g.medDays) + "일") + "</td>" +
      "<td>" + scPct(g.medMx, true) + "</td></tr>";
  }).join("");
}

/* ---------- 산업·시황 리포트 (data/industry/YYYY-MM.json) ---------- */
const IND_KIND = { industry:"산업", market:"시황" };
let INDT = [];
let indData = {}, indPend = {}, indFail = {}, indLimit = RP_PAGE;

function indMonths(){ return (RMETA && Array.isArray(RMETA.industry_months)) ? RMETA.industry_months : []; }
function indAvail(){ return indMonths().length > 0; }
function indFloor(){
  return RX.ind.period === "all" ? null : rpFloorForDays(parseInt(RX.ind.period, 10) || 1);
}
function indMerge(){
  var keep = {}, out = [];
  indMonths().forEach(function(mo){ keep[mo.month] = 1; });
  Object.keys(indData).forEach(function(k){ if(!keep[k]) delete indData[k]; });
  indMonths().forEach(function(mo){
    var d = indData[mo.month];
    if(d) for(var i=0;i<d.rows.length;i++) out.push(d.rows[i]);
  });
  INDT = out;
}
/* 기간에 필요한 달만 받는다 (v 가 바뀐 달은 다시). 받는 중이면 true */
function indEnsure(){
  var floor = indFloor(), fm = floor ? floor.slice(0, 7) : "", busy = false;
  indMonths().forEach(function(mo){
    if(fm && mo.month < fm) return;
    var key = mo.month + "@" + mo.v, d = indData[mo.month];
    if(d && d.v === mo.v) return;
    if(indPend[key]){ busy = true; return; }
    if(indFail[key]) return;
    busy = true;
    indPend[key] = rpFetchJson("data/industry/" + mo.month + ".json?v=" + encodeURIComponent(mo.v)).then(function(rows){
      indData[mo.month] = { v:mo.v, rows:Array.isArray(rows) ? rows : [] };
    }, function(err){
      indFail[key] = (err && err.message) ? err.message : String(err);
      console.warn("산업·시황 리포트 적재 실패:", indFail[key]);
    }).then(function(){
      delete indPend[key];
      indMerge();
      if(RP.view === "industry") rpRender(true);
    });
  });
  return busy;
}
function indFiltered(){
  var floor = indFloor(), f = RX.ind, q = f.q.trim().toLowerCase(), out = [];
  for(var i=0;i<INDT.length;i++){
    var r = INDT[i];
    if(floor && (r.date || "") < floor) continue;
    if(f.kinds.length && f.kinds.indexOf(r.kind) < 0) continue;
    if(f.cat && (r.category || "") !== f.cat) continue;
    if(f.broker && r.broker !== f.broker) continue;
    if(q){
      var hay = ((r.title || "") + " " + (r.broker || "") + " " + (r.category || "") + " " + (r.analyst || "")).toLowerCase();
      if(hay.indexOf(q) < 0) continue;
    }
    out.push(r);
  }
  return out;
}
function indOptions(sel, counts, all, cur){
  var names = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a] || a.localeCompare(b, "ko"); });
  if(cur && counts[cur] === undefined) names.unshift(cur);
  sel.innerHTML = '<option value="">' + all + "</option>" + names.map(function(n){
    return '<option value="' + esc(n) + '">' + esc(n) + " (" + fmt(counts[n] || 0) + ")</option>";
  }).join("");
  sel.value = cur || "";
  sel.classList.toggle("on", !!cur);
}
function indLinks(r){
  return '<a class="rtitle" href="' + esc(r.url || r.pdf || "#") + '" target="_blank" rel="noopener">' + esc(r.title || "") + "</a>" +
         (r.pdf ? ' <a class="rpdf" href="' + esc(r.pdf) + '" target="_blank" rel="noopener" title="PDF 원문">PDF</a>' : "");
}
function rpRenderIndustry(){
  var f = RX.ind;
  $$("#indPeriod button").forEach(function(b){ b.classList.toggle("act", b.dataset.p === f.period); });
  $$("[data-ikind]").forEach(function(b){ b.classList.toggle("act", f.kinds.indexOf(b.dataset.ikind) >= 0); });
  var qEl = $("#indQ");
  if(document.activeElement !== qEl) qEl.value = f.q;
  var busy = indEnsure();
  var floor = indFloor(), cats = {}, brokers = {};
  INDT.forEach(function(r){
    if(floor && (r.date || "") < floor) return;
    if(r.category) cats[r.category] = (cats[r.category] || 0) + 1;
    if(r.broker) brokers[r.broker] = (brokers[r.broker] || 0) + 1;
  });
  indOptions($("#indCat"), cats, "분류 전체", f.cat);
  indOptions($("#indBroker"), brokers, "증권사 전체", f.broker);

  var fails = Object.keys(indFail).filter(function(k){ return !indData[k.split("@")[0]]; });
  var note = $("#indNote");
  var nhtml = busy ? '<span class="spin"></span>산업·시황 리포트를 불러오는 중…' : "";
  if(fails.length) nhtml += (nhtml ? " · " : "") + '<span class="down">' + esc(fails.map(function(k){ return k.split("@")[0]; }).join(", ")) +
                            ' 불러오기 실패</span> <button class="btn xs" id="indRetry">다시 시도</button>';
  note.innerHTML = nhtml;
  note.classList.toggle("hide", !nhtml);

  var rows = indFiltered(), total = rows.length, lim = Math.min(total, indLimit), html = [];
  $("#indCount").textContent = fmt(total) + "건";
  var em = $("#indEmpty"), cards = $("#indCards"), tw = $("#indTable").parentNode;
  em.style.display = total ? "none" : "block";
  em.textContent = busy && !INDT.length ? "불러오는 중…" : "조건에 맞는 산업·시황 리포트가 없습니다.";
  var more = total > lim
    ? '<button class="btn" id="indMore">더 보기 (+' + fmt(RP_PAGE) + ") · 남은 " + fmt(total - lim) + "건</button>" : "";
  if(rpIsMobile()){
    for(var m=0;m<lim;m++){
      var c = rows[m];
      html.push('<div class="rcard"><div class="l1"><span class="nm"><span class="ikind ' + esc(c.kind) + '">' +
        esc(IND_KIND[c.kind] || c.kind || "") + "</span>" + (c.category ? " " + esc(c.category) : "") +
        '</span><span class="v">' + (typeof c.views === "number" ? "조회 " + fmt(c.views) : "") + "</span></div>" +
        '<div class="l2">' + indLinks(c) + "</div>" +
        '<div class="l3">' + esc(c.broker || "") + (c.analyst ? "(" + esc(c.analyst) + ")" : "") + " · " +
        esc((c.date || "").slice(2)) + "</div></div>");
    }
    if(more) html.push('<div class="rcmore">' + more + "</div>");
    cards.innerHTML = html.join("");
    cards.classList.toggle("hide", !total);
    tw.classList.add("hide");
    return;
  }
  cards.classList.add("hide");
  tw.classList.toggle("hide", !total);
  for(var i=0;i<lim;i++){
    var r = rows[i];
    html.push("<tr>" +
      '<td class="l dt">' + esc((r.date || "").slice(2)) + "</td>" +
      '<td class="c"><span class="ikind ' + esc(r.kind) + '">' + esc(IND_KIND[r.kind] || r.kind || "") + "</span></td>" +
      '<td class="l">' + (r.category ? esc(r.category) : '<span class="flat">-</span>') + "</td>" +
      '<td class="l wr">' + indLinks(r) + "</td>" +
      '<td class="l">' + esc(r.broker || "") + "</td>" +
      '<td class="l" style="color:var(--tx3)">' + esc(r.analyst || "") + "</td>" +
      '<td class="dt">' + (typeof r.views === "number" ? fmt(r.views) : "") + "</td></tr>");
  }
  if(more) html.push('<tr class="morerow"><td class="c" colspan="7">' + more + "</td></tr>");
  $("#indTbody").innerHTML = html.join("");
}

/* ---------- 09 의 rpRender 가 부르는 확장 뷰 진입점 ---------- */
function rpRenderExt(){
  if(RP.view === "score") rpRenderScore();
  else if(RP.view === "industry") rpRenderIndustry();
}

function rxBind(){
  $("#scMode").onclick = function(e){
    var b = e.target.closest("button[data-m]"); if(!b) return;
    RX.sc.mode = b.dataset.m;
    if(RX.sc.sortKey === "name") RX.sc.sortKey = "n";
    rxSave(); rpRender(true);
  };
  $("#scAge").onclick = function(e){
    var b = e.target.closest("button[data-a]"); if(!b) return;
    RX.sc.age = +b.dataset.a; rxSave(); rpRender(true);
  };
  $("#scMin").onchange = function(){
    var v = Math.max(1, Math.min(999, parseInt(this.value, 10) || 1));
    if(RX.sc.mode === "analyst") RX.sc.minA = v; else RX.sc.minB = v;
    rxSave(); rpRender(true);
  };
  $("#scThead").addEventListener("click", function(e){
    var th = e.target.closest("th[data-ss]"); if(!th) return;
    var k = th.dataset.ss;
    if(RX.sc.sortKey === k) RX.sc.sortDir = RX.sc.sortDir === "asc" ? "desc" : "asc";
    else{ RX.sc.sortKey = k; RX.sc.sortDir = k === "name" ? "asc" : "desc"; }
    rxSave(); rpRender(true);
  });
  $("#scThead").addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var th = e.target.closest("th[data-ss]");
    if(th){ e.preventDefault(); th.click(); }
  });
  /* 증권사(애널리스트) 행 → 리포트 목록을 그 증권사로 거른다 */
  $("#scTbody").addEventListener("click", function(e){
    var tr = e.target.closest("tr[data-scb]"); if(!tr) return;
    RP.brokers = [tr.dataset.scb];
    RP.q = tr.dataset.sca || "";
    RP.codes = [];
    RP.period = "all";
    RP.view = "reports";
    RP.sortKey = "date"; RP.sortDir = "desc";
    rpRenderBrokerList();
    rpRender();
    window.scrollTo(0, 0);
  });
  $("#rpScorePanel").addEventListener("click", function(e){
    if(!e.target.closest("#scRetry")) return;
    rpPerfFailV = ""; rpPerfErr = "";
    rpRender(true);
  });

  $("#indPeriod").onclick = function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    RX.ind.period = b.dataset.p; indLimit = RP_PAGE; rxSave(); rpRender(true);
  };
  $("#indKinds").onclick = function(e){
    var b = e.target.closest("[data-ikind]"); if(!b) return;
    rpToggle(RX.ind.kinds, b.dataset.ikind); indLimit = RP_PAGE; rxSave(); rpRender(true);
  };
  $("#indCat").onchange = function(){ RX.ind.cat = this.value; indLimit = RP_PAGE; rxSave(); rpRender(true); };
  $("#indBroker").onchange = function(){ RX.ind.broker = this.value; indLimit = RP_PAGE; rxSave(); rpRender(true); };
  var qDeb = rpDebounce(function(){ indLimit = RP_PAGE; rxSave(); rpRender(true); }, 200);
  $("#indQ").oninput = function(){ RX.ind.q = this.value; qDeb(); };
  $("#indReset").onclick = function(){
    RX.ind = { kinds:[], cat:"", broker:"", period:"30", q:"" };
    indLimit = RP_PAGE; rxSave(); rpRender(true);
  };
  $("#rpIndPanel").addEventListener("click", function(e){
    if(e.target.closest("#indMore")){
      var y = window.pageYOffset;
      indLimit += RP_PAGE; rpRender(true); window.scrollTo(0, y);
    }else if(e.target.closest("#indRetry")){
      indFail = {}; rpRender(true);
    }
  });
}

function repxInit(){
  rxLoad();
  rxBind();
  mrInit();
}
