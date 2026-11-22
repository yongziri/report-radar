/* =========================================================================
   홈 화면 — app/mobile/m_home.js (+ m_home.css, 뿌리 #m-home)
   폴리시: PC 표 대신 폰 전용 렌더러를 쓴다. 데이터는 PC 렌더러가 읽는 전역 그대로
   (SCREEN·SCAN_AT·RPT·rpByCode·QUOTES·RSS.cache …), 다시 그리는 시점은 PC 렌더 함수를
   감싸서 맞춘다 (공유 파일은 고치지 않는다). PC 패널은 #m-home 안에 숨겨 둔다(id 유지).
   구성(위→아래): 시장 카드 · 내 종목 리포트 · 오늘의 리포트 · 시장 움직임(세그먼트) ·
                 업종 등락 · 뉴스 · 공시 · [접힘] 시가총액 지도 · [접힘] 경제 캘린더
   다시 그리는 시점:
   - 시장 카드: renderIndex(지수) · renderMarket(장 상태·갱신 시각, refreshAll 끝) · renderGauge(스캔)
   - 내 종목 리포트: mrRender (myRepOnData·renderWatchlist 래퍼가 부른다)
   - 오늘의 리포트: rpRenderToday · rpShowNotice(적재 실패)
   - 시장 움직임·업종 등락: renderSignals · renderSectorPerf (스캔 완료·복원·설정 변경)
   - 뉴스·공시: renderMarketNews · renderDisclosures (같은 RSS 캐시/요청을 받아 그린다)
   - 테마 변경: applyTheme (괴리율 배경색 다시 계산)
   ========================================================================= */
var MH = {
  idx: null,            // 마지막 지수 데이터 (renderIndex 인자)
  sig: "up",            // 시장 움직임 세그먼트: up | dn | amt
  open: {},             // 펼친 목록: sig · sec · news · dc
  justAt: 0,            // 당겨서 새로고침이 끝난 시각 ("방금 갱신")
  rpErr: false,         // 리포트 데이터 적재 실패
  calInit: null,        // 경제 캘린더 초기화 (펼칠 때 한 번)
  scroll: 0,            // 떠날 때 스크롤 위치
  el: {}
};
var MH_ROWS = 5;

function mhSafe(fn){ try{ fn(); }catch(e){ console.error("[m-home]", e); } }
/* 공유 렌더 감싸기에서 부른다: 홈이 보일 때만 그린다 (숨어 있으면 show() 의 mhRenderAll 이 그린다) */
function mhLive(fn){ if(M.cur === "home") mhSafe(fn); }
function mhSkel(n, two){
  var s = "";
  for(var i=0;i<n;i++) s += '<div class="mh-skrow"><i class="mh-sk" style="width:' + (38 + (i * 17) % 30) + '%"></i>' +
    (two ? '<i class="mh-sk sm" style="width:' + (22 + (i * 11) % 20) + '%"></i>' : "") + "</div>";
  return '<div class="mh-skel" aria-hidden="true">' + s + "</div>";
}
function mhEmpty(msg, btn, act){
  return '<div class="mh-empty"><p>' + msg + "</p>" +
    (btn ? '<button class="m-btn pri mh-btn" data-act="' + act + '">' + btn + "</button>" : "") + "</div>";
}
function mhMoreBtn(key, total, shown){
  if(total <= MH_ROWS) return "";
  var on = !!MH.open[key];
  return '<button class="m-morebtn mh-more" data-more="' + key + '" aria-expanded="' + on + '">' +
    (on ? "접기" : "더 보기 <span class=\"m-num\">" + fmt(total - shown) + "</span>") + "</button>";
}
function mhSec(id, title, extra){
  var s = document.createElement("section");
  s.className = "mh-sec"; s.id = id;
  s.innerHTML = '<div class="mh-hd"><h2>' + title + "</h2>" + (extra || "") + "</div>";
  return s;
}
function mhTime(ms){
  var d = new Date(ms), p = function(n){ return (n < 10 ? "0" : "") + n; };
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/* ---------- 1. 시장 카드 ---------- */
function mhIdxTile(name){
  var d = MH.idx && MH.idx[name];
  if(!d){
    var failed = /^갱신 /.test(($("#upd") || {}).textContent || "");   // 갱신은 끝났는데 지수가 없다
    return '<div class="mh-tile"><div class="k">' + name + "</div>" +
      (failed ? '<div class="v flat">-</div><div class="c">불러오지 못함</div>'
              : '<i class="mh-sk lg"></i><i class="mh-sk sm"></i>') + "</div>";
  }
  var down = (d.rf === "5" || d.rf === "4");
  var v = d.nv / 100, cv = down ? -Math.abs(d.cv / 100) : d.cv / 100, cr = down ? -Math.abs(d.cr) : d.cr;
  var cls = dirCls(cr), mark = cv > 0 ? "▲" : (cv < 0 ? "▼" : "");
  return '<div class="mh-tile"><div class="k">' + name + "</div>" +
    '<div class="v m-num ' + cls + '">' + fmt(v, 2) + "</div>" +
    '<div class="c m-num ' + cls + '">' + mark + fmt(Math.abs(cv), 2) + " <span>" + fmtPct(cr) + "</span></div></div>";
}
function mhMarket(){
  var E = MH.el;
  E.idx.innerHTML = mhIdxTile("KOSPI") + mhIdxTile("KOSDAQ");
  /* 시장 폭 (스캔 캐시) */
  var note = "";
  if(!SCREEN.length){
    E.breadth.innerHTML = scanning
      ? '<div class="mh-gbar"><i class="mh-sk" style="width:100%;height:100%;margin:0"></i></div>' +
        '<div class="mh-glab"><span class="flat">전체 종목 스캔 중…</span></div>'
      : '<button class="mh-link" data-act="scr">상승·하락 종목 수는 스크리너 전체 스캔 후 표시됩니다 ›</button>';
  }else{
    var rows = SCREEN.filter(statFilter);
    if(!rows.length) rows = SCREEN;
    var u = 0, dn = 0, f = 0;
    rows.forEach(function(q){ if(q.pct > 0) u++; else if(q.pct < 0) dn++; else f++; });
    var t = rows.length;
    E.breadth.innerHTML =
      '<div class="mh-glab m-num"><span class="up">상승 <b>' + fmt(u) + "</b></span>" +
      '<span class="flat">보합 ' + fmt(f) + "</span>" +
      '<span class="down">하락 <b>' + fmt(dn) + "</b></span></div>" +
      '<div class="mh-gbar" role="img" aria-label="상승 ' + u + ", 보합 " + f + ", 하락 " + dn + '">' +
      '<i class="gu" style="width:' + (u / t * 100) + '%"></i><i class="gf" style="width:' + (f / t * 100) + '%"></i>' +
      '<i class="gd" style="width:' + (dn / t * 100) + '%"></i></div>';
    note = (scanning ? "스캔 중…" : "스캔 " + (SCAN_AT_MS ? mhTime(SCAN_AT_MS) : (SCAN_AT || "-"))) +
      " · " + statScopeTag() + " " + fmt(t) + "종목";
  }
  /* 시세 갱신 시각: #upd 문구가 바뀐 순간을 잰다 (refreshAll 끝 → renderMarket) */
  var upd = ($("#upd") || {}).textContent || "";
  if(/^갱신 /.test(upd) && upd !== MH.updTxt){ MH.updTxt = upd; MH.updAt = Date.now(); }
  var right = navigator.onLine === false ? "오프라인 · 마지막 시세"
    : (MH.justAt && Date.now() - MH.justAt < 60000) ? "방금 갱신"
    : (MH.updAt ? "시세 " + mhTime(MH.updAt).split(" ")[1] : "");
  E.note.innerHTML = '<span class="l">' + esc(note) + '</span><span class="r m-num">' + esc(right) + "</span>";
}

/* ---------- 2. 내 종목 리포트 ---------- */
function mhRepRow(r, isNew){
  var g = rpGapOf(r);
  return '<button class="m-row mh-rep" data-code="' + esc(r.code) + '" data-name="' + esc(rpName(r.code, r.name)) + '">' +
    '<span class="mh-l1"><span class="nm">' + esc(rpName(r.code, r.name)) + "</span>" + rpBadgeOf(r) +
      (isNew ? '<span class="mrdot">NEW</span>' : "") +
      '<span class="tg m-num">' + rpTargetCell(r) + "</span></span>" +
    '<span class="mh-l2"><span class="s">' + esc(r.broker || "-") + " · " + esc((r.date || "").slice(5).replace("-", "/")) + "</span>" +
      '<span class="gp m-num">' + (g === null ? "" : "괴리 ") + rpGapCell(g) + "</span></span></button>";
}
function mhMyRep(){
  var E = MH.el, n = mrLoadSeen().unread.length;
  E.myBadge.textContent = n > 99 ? "99+" : String(n);
  E.myBadge.classList.toggle("m-off", !n);
  E.myAll.classList.add("m-off");
  if(!RP_READY){
    E.mySub.textContent = "관심·보유 종목 · 최근 " + MR_DAYS + "일";
    E.myBody.innerHTML = MH.rpErr ? mhEmpty("리포트 데이터를 불러오지 못했습니다. 위로 당겨 다시 시도하세요.") : mhSkel(3, true);
    return;
  }
  var codes = Object.keys(mrCodes());
  if(!codes.length){
    E.mySub.textContent = "관심·보유 종목 · 최근 " + MR_DAYS + "일";
    E.myBody.innerHTML = mhEmpty("관심종목이나 보유 종목을 추가하면 그 종목의 리포트가 여기에 모입니다.", "종목 추가하러 가기", "assets");
    return;
  }
  var floor = rpShiftISO(rpBaseISO(), -(MR_DAYS - 1)), rows = [];
  codes.forEach(function(c){ (rpByCode[c] || []).forEach(function(r){ if((r.date || "") >= floor) rows.push(r); }); });
  rows.sort(function(a, b){
    return String(b.date || "").localeCompare(String(a.date || "")) || (mrFresh[b.id] ? 1 : 0) - (mrFresh[a.id] ? 1 : 0);
  });
  E.mySub.textContent = codes.length + "종목 · 최근 " + MR_DAYS + "일 " + fmt(rows.length) + "건";
  if(!rows.length){
    E.myBody.innerHTML = mhEmpty("최근 " + MR_DAYS + "일 동안 내 종목(" + codes.length + "종목)에 나온 리포트가 없습니다.");
    return;
  }
  var unread = {};
  mrLoadSeen().unread.forEach(function(i){ unread[i] = 1; });
  E.myAll.classList.remove("m-off");
  E.myAll.innerHTML = "모두 보기" + (rows.length > MH_ROWS ? ' <span class="m-num">' + fmt(rows.length) + "</span>" : "");
  E.myBody.innerHTML = '<div class="m-list">' + rows.slice(0, MH_ROWS).map(function(r){
    return mhRepRow(r, unread[r.id] || mrFresh[r.id]);
  }).join("") + "</div>";
}

/* ---------- 3. 오늘의 리포트 ---------- */
function mhStat(k, v, cls, c){
  return '<div class="mh-stat"><div class="k">' + k + '</div><div class="v m-num ' + (cls || "") + '">' + v + "</div>" +
    '<div class="c m-num">' + (c || "&nbsp;") + "</div></div>";
}
function mhToday(){
  var E = MH.el;
  if(!RP_READY || !RPT.length){
    E.todaySub.textContent = "";
    if(MH.rpErr) E.todayBody.innerHTML = mhEmpty("리포트 데이터를 불러오지 못했습니다.");
    else if(RP_READY) E.todayBody.innerHTML = mhEmpty("수집된 리포트가 없습니다.");
    else E.todayBody.innerHTML = '<div class="mh-stats">' + [0,1,2,3].map(function(){
      return '<div class="mh-stat"><i class="mh-sk sm"></i><i class="mh-sk lg"></i></div>'; }).join("") + "</div>" + mhSkel(3, true);
    return;
  }
  var day = "";
  for(var i=0;i<RPT.length;i++){ if((RPT[i].date || "") > day) day = RPT[i].date || ""; }
  var rows = RPT.filter(function(r){ return r.date === day; });
  var a = rpAgg(rows);
  var ups = rows.filter(function(r){ return r.target_change === "up" && rpStatOk(r); })
    .sort(function(x, y){ return (rpGapOf(y) || 0) - (rpGapOf(x) || 0); });
  E.todaySub.textContent = day.slice(5).replace("-", "/") + (day === rpTodayISO() ? " 오늘" : " 최근 영업일");
  var stats = '<div class="mh-stats">' +
    mhStat("리포트 수", fmt(rows.length) + '<small>건</small>', "", a.sus ? "확인 필요 " + a.sus + "건 제외" : "") +
    mhStat("BUY 비율", (a.n ? Math.round(a.BUY / a.n * 100) : 0) + '<small>%</small>', "", "BUY " + fmt(a.BUY) + "건 / " + fmt(a.n) + "건") +
    mhStat("목표가 상향 / 하향", '<span class="up">▲' + fmt(a.up) + '</span> <span class="down">▼' + fmt(a.down) + "</span>", "", "") +
    mhStat("괴리율 중앙값", a.medGap === null ? "-" : fmtPct(a.medGap), dirCls(a.medGap), a.gapN ? fmt(a.gapN) + "건 기준" : "") +
    "</div>";
  var list = ups.length
    ? '<div class="mh-subh">목표가 상향 종목 <span class="m-num">' + fmt(ups.length) + '</span></div><div class="m-list">' +
      ups.slice(0, MH_ROWS).map(function(r){
        var g = rpGapOf(r);
        return '<button class="m-row mh-rep" data-code="' + esc(r.code) + '" data-name="' + esc(rpName(r.code, r.name)) + '">' +
          '<span class="mh-l1"><span class="nm">' + esc(rpName(r.code, r.name)) + "</span>" +
          '<span class="tg m-num">' + rpTargetCell(r) + "</span></span>" +
          '<span class="mh-l2"><span class="s">' + esc(r.broker || "-") +
          (typeof r.prev_target === "number" ? " · 직전 " + fmt(r.prev_target) : "") + "</span>" +
          '<span class="gp m-num">' + (g === null ? "" : "괴리 ") + rpGapCell(g) + "</span></span></button>";
      }).join("") + "</div>"
    : mhEmpty("이 날 목표가를 올린 리포트가 없습니다.");
  E.todayBody.innerHTML = stats + list;
}

/* ---------- 4. 시장 움직임 ---------- */
function mhSignals(){
  var E = MH.el;
  E.sigSeg.mSet(MH.sig);
  if(!SCREEN.length){
    E.sigList.innerHTML = scanning ? mhSkel(MH_ROWS, true)
      : mhEmpty("상승·하락·거래대금 순위는 스크리너 전체 스캔 후 표시됩니다.", "스크리너 열기", "scr");
    E.sigSub.textContent = scanning ? "스캔 중…" : "";
    return;
  }
  var amt = MH.sig === "amt", dir = MH.sig === "dn" ? 1 : -1;
  var all = SCREEN.filter(statFilter).sort(function(x, y){
    return amt ? (y.amt - x.amt) : (x.pct - y.pct) * dir;
  });
  var total = Math.min(all.length, 30), shown = MH.open.sig ? total : Math.min(MH_ROWS, total);
  E.sigSub.textContent = statScopeTag();
  E.sigList.innerHTML = '<div class="m-list mh-mvlist">' + all.slice(0, shown).map(function(q, i){
    return '<button class="m-row mh-mv" data-code="' + esc(q.code) + '" data-name="' + esc(q.name) + '">' +
      '<span class="rk m-num">' + (i + 1) + "</span>" +
      '<span class="m-row-t"><span class="nm">' + esc(q.name) + "</span>" +
      '<span class="m-row-s m-num">' + (amt ? "거래대금 " + fmtBig(q.amt) : "거래량 " + fmtBig(q.vol)) + "</span></span>" +
      '<span class="pr m-num">' + fmt(q.price) + "</span>" +
      '<span class="m-pill m-num ' + dirCls(q.pct) + '">' + fmtPct(q.pct) + "</span></button>";
  }).join("") + "</div>" + mhMoreBtn("sig", total, shown);
}

/* ---------- 5. 업종 등락 ---------- */
function mhSectors(){
  var E = MH.el;
  if(!SCREEN.length){
    E.secSub.textContent = "";
    E.secBody.innerHTML = scanning ? mhSkel(4) : mhEmpty("업종별 등락은 스크리너 전체 스캔 후 표시됩니다.");
    return;
  }
  var by = {}, srows = SCREEN.filter(statFilter);
  srows.forEach(function(q){
    var s = q.sector || "기타";
    var g = by[s] || (by[s] = { cap:0, wsum:0, n:0, up:0 });
    var w = q.capW || 0;
    g.cap += w; g.wsum += w * (q.pct || 0); g.n++;
    if(q.pct > 0) g.up++;
  });
  var rows = Object.keys(by).map(function(s){
    var g = by[s];
    return { s:s, pct:(g.cap > 0 ? g.wsum / g.cap : 0), n:g.n, up:g.up };
  }).sort(function(a, b){ return b.pct - a.pct; });
  var mx = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.pct); })) || 1;
  var shown = MH.open.sec ? rows.length : Math.min(8, rows.length);
  E.secSub.textContent = "시총가중 · " + rows.length + "개 업종";
  E.secBody.innerHTML = '<div class="m-list">' + rows.slice(0, shown).map(function(r){
    var half = Math.min(50, Math.abs(r.pct) / mx * 50);
    var bar = r.pct >= 0
      ? '<i class="pu" style="left:50%;width:' + half + '%"></i>'
      : '<i class="pd" style="right:50%;width:' + half + '%"></i>';
    return '<button class="m-row mh-secrow" data-sec="' + esc(r.s) + '">' +
      '<span class="m-row-t"><span class="nm">' + esc(r.s) + "</span>" +
      '<span class="m-row-s m-num">상승 ' + r.up + "/" + r.n + "</span></span>" +
      '<span class="mh-bar" aria-hidden="true">' + bar + "<b></b></span>" +
      '<span class="pv m-num ' + dirCls(r.pct) + '">' + fmtPct(r.pct) + "</span></button>";
  }).join("") + "</div>" +
    (rows.length > 8 ? '<button class="m-morebtn mh-more" data-more="sec" aria-expanded="' + !!MH.open.sec + '">' +
      (MH.open.sec ? "접기" : "전체 업종 보기 <span class=\"m-num\">" + rows.length + "</span>") + "</button>" : "");
}
function mhOpenSector(s){
  FS = { sector:s };
  scrSort = { key:"pct", dir:-1 };
  syncFilterUI(); applyFilter(); showTab("scr");
  toast(s + " 업종 필터를 적용했습니다.", "ok");
}

/* ---------- 6. 뉴스 · 공시 ---------- */
function mhStamp(r){
  return (r.stale ? '<span class="stalebadge">갱신 실패 · 이전 결과</span> ' : "") +
    new Date(r.at).toLocaleTimeString("ko-KR", { hour12:false, hour:"2-digit", minute:"2-digit" });
}
function mhNews(r){
  var E = MH.el, items = r.items || [];
  E.newsSub.innerHTML = mhStamp(r);
  if(!items.length){ E.newsBody.innerHTML = mhEmpty("표시할 뉴스가 없습니다."); return; }
  var total = Math.min(items.length, 15), shown = MH.open.news ? total : Math.min(MH_ROWS, total);
  E.newsBody.innerHTML = '<div class="m-list">' + items.slice(0, shown).map(function(it){
    var s = splitHeadline(it.title), src = s.src || it.author || "";
    return '<a class="m-row mh-feed" href="' + esc(it.link) + '" target="_blank" rel="noopener">' +
      '<span class="m-row-t"><span class="tt">' + esc(s.head) + "</span>" +
      '<span class="m-row-s">' + esc(src) + (src ? " · " : "") + esc(relTime(it.pubDate)) + "</span></span></a>";
  }).join("") + "</div>" + mhMoreBtn("news", total, shown);
}
function mhNewsErr(e){
  MH.el.newsSub.innerHTML = '<span class="stalebadge">불러오기 실패</span>';
  MH.el.newsBody.innerHTML = mhEmpty("뉴스를 불러오지 못했습니다 (" + esc(e && e.message || e) + ").") +
    '<a class="m-morebtn mh-more" href="' + gnewsLink(MKT_Q) + '" target="_blank" rel="noopener">구글 뉴스에서 보기 ↗</a>';
}
function mhDart(r){
  var E = MH.el, mine = $("#dcMine").checked, names = myNames();
  var rows = (r.items || []).map(parseDart);
  var isMine = function(d){ return names.some(function(n){ return d.comp.indexOf(n) >= 0 || d.rpt.indexOf(n) >= 0; }); };
  var list = rows;
  if(mine) list = list.filter(isMine);
  if(dcFilter) list = list.filter(function(d){ return d.type === dcFilter; });
  E.dcSub.innerHTML = mhStamp(r);
  if(!list.length){
    E.dcBody.innerHTML = mhEmpty(rows.length ? "조건에 맞는 공시가 없습니다."
      : "오늘 접수된 공시가 없습니다. DART는 당일 공시만 제공해 주말·공휴일·장 시작 전에는 비어 있을 수 있습니다.");
    return;
  }
  var total = Math.min(list.length, 40), shown = MH.open.dc ? total : Math.min(MH_ROWS, total);
  E.dcBody.innerHTML = '<div class="m-list">' + list.slice(0, shown).map(function(d){
    return '<a class="m-row mh-feed' + (isMine(d) ? " mine" : "") + '" href="' + esc(d.link) + '" target="_blank" rel="noopener">' +
      '<span class="m-row-t"><span class="tt">' + esc(d.rpt) + "</span>" +
      '<span class="m-row-s"><b>' + esc(d.comp || "-") + "</b> · " + esc(relTime(d.at)) + "</span></span></a>";
  }).join("") + "</div>" + mhMoreBtn("dc", total, shown);
}
function mhDartErr(e){
  MH.el.dcSub.innerHTML = '<span class="stalebadge">불러오기 실패</span>';
  MH.el.dcBody.innerHTML = mhEmpty("공시를 불러오지 못했습니다 (" + esc(e && e.message || e) + ").") +
    '<a class="m-morebtn mh-more" href="https://dart.fss.or.kr" target="_blank" rel="noopener">DART 바로가기 ↗</a>';
}
function mhNewsLoad(force){
  if(!RSS.cache.mkt) MH.el.newsBody.innerHTML = mhSkel(MH_ROWS, true);
  RSS.get("mkt", gnewsRss(MKT_Q), force).then(function(r){ mhSafe(function(){ mhNews(r); }); }, mhNewsErr);
}
function mhDartLoad(force){
  if(!RSS.cache.dart) MH.el.dcBody.innerHTML = mhSkel(MH_ROWS, true);
  RSS.get("dart", DART_RSS, force).then(function(r){ MH.dartR = r; mhSafe(function(){ mhDart(r); }); }, mhDartErr);
}

/* ---------- 7. 시가총액 지도: 타일 탭 → 상세 시트 ---------- */
function mhTileSheet(code){
  var u = UNI_BY_KEY["KR:" + code], q = QUOTES["KR:" + code];
  if(!u) return;
  var row = function(k, v){ return '<div class="mh-kv"><span>' + k + '</span><span class="m-num">' + v + "</span></div>"; };
  var html = '<div class="mh-tsheet">' +
    '<div class="mh-tsh"><b>' + esc(u.name) + '</b><span class="m-num">' + esc(u.code) + "</span></div>" +
    (q ? '<div class="mh-tsp m-num"><span class="' + dirCls(q.pct) + '">' + fmt(q.price) + "</span> " +
         '<span class="' + dirCls(q.pct) + '">' + fmtSigned(q.chg) + " (" + fmtPct(q.pct) + ")</span></div>" : "") +
    row("업종", esc(u.industry || u.sector || "-")) +
    (tmapPeriod !== "1d" ? row(tmapPeriod === "1w" ? "1주 등락" : "1개월 등락", fmtPct(tmapPct(code))) : "") +
    (q ? row("거래대금", fmtBig(q.amt)) : row("시세", "없음")) +
    row("시가총액", fmtBig(u.cap * 1e8)) +
    '<button class="m-btn pri m-wide" data-tcode="' + esc(u.code) + '">종목 보기</button></div>';
  var sh = mSheet({ id:"tmapTile", title:"시가총액 지도", content:html, cls:"mh-sheet" });
  $("[data-tcode]", sh.el).onclick = function(){ mOpenStock({ mk:"KR", code:u.code, name:u.name }); };
}

/* ---------- 접는 구역 ---------- */
function mhFold(id, title, sub, body, onOpen){
  var s = document.createElement("section");
  s.className = "mh-sec mh-fold"; s.id = id;
  s.innerHTML = '<button class="mh-foldhd" aria-expanded="false"><span class="t">' + title + '</span><span class="s">' + sub +
    '</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>';
  var bd = document.createElement("div");
  bd.className = "mh-foldbd m-card";
  bd.appendChild(body);
  s.appendChild(bd);
  var hd = s.firstChild;
  hd.onclick = function(){
    var open = !s.classList.contains("open");
    s.classList.toggle("open", open);
    hd.setAttribute("aria-expanded", open);
    if(open){
      onOpen();
      setTimeout(function(){ hd.scrollIntoView({ block:"start", behavior:"smooth" }); }, 60);
    }
  };
  return s;
}
function mhTmapOpen(){
  setTimeout(function(){ if(TMAP_LOADED) renderTreemap(); else loadTreemap(); }, 30);
}

function mhRenderAll(){
  [mhMarket, mhMyRep, mhToday, mhSignals, mhSectors].forEach(mhSafe);
  if(MH.dartR) mhSafe(function(){ mhDart(MH.dartR); });
}

mScreen("home", {
  title: "홈",
  mount: function(root){
    var E = MH.el;
    var ov = mPanelOf("#ovKospi"),
        myRep = $("#myRepPanel"),
        today = mPanelOf("#rpToday"),
        sig = $("#sigPanels"),
        sec = mPanelOf("#secPerf"),
        feeds = mPanelOf("#mktNews", ".grid2"),
        tmap = mPanelOf("#tmap"),
        cal = mPanelOf("#calWrap");

    /* 1. 시장 카드 */
    var mkt = mhSec("mhMarket", "시장");
    mkt.firstChild.appendChild($("#mkKr"));              // 장 상태 칩 (renderMarket 이 그대로 갱신)
    var card = document.createElement("div");
    card.className = "m-card mh-mkt";
    card.innerHTML = '<div class="mh-idx"></div><div class="mh-breadth"></div><div class="mh-note"></div>';
    mkt.appendChild(card);
    E.idx = $(".mh-idx", card); E.breadth = $(".mh-breadth", card); E.note = $(".mh-note", card);
    root.appendChild(mkt);

    /* 2. 내 종목 리포트 — PC 패널(#myRepPanel)을 그릇으로 쓴다: 읽음 처리(IntersectionObserver)가 이 패널을 본다 */
    var my = mhSec("mhMyRep", "내 종목 리포트",
      '<span class="nbadge m-off" title="마지막으로 본 뒤 새로 들어온 리포트"></span><span class="sub"></span>' +
      '<button class="mh-act m-off" data-act="myall"></button>');
    E.myBadge = $(".nbadge", my); E.mySub = $(".sub", my); E.myAll = $(".mh-act", my);
    E.myBody = document.createElement("div");
    my.appendChild(E.myBody);
    if(myRep){ myRep.appendChild(my); root.appendChild(myRep); } else root.appendChild(my);

    /* 3. 오늘의 리포트 */
    var td = mhSec("mhToday", "오늘의 리포트", '<span class="sub"></span><button class="mh-act" data-act="rep">더 보기</button>');
    E.todaySub = $(".sub", td);
    E.todayBody = document.createElement("div");
    E.todayBody.className = "m-card mh-pad";
    td.appendChild(E.todayBody);
    root.appendChild(td);

    /* 4. 시장 움직임 */
    var mv = mhSec("mhMovers", "시장 움직임", '<span class="sub"></span>');
    E.sigSub = $(".sub", mv);
    E.sigSeg = mSegBar([["up", "상승"], ["dn", "하락"], ["amt", "거래대금"]], function(v){
      MH.sig = v; MH.open.sig = false; mhSafe(mhSignals);
    });
    E.sigList = document.createElement("div");
    mv.appendChild(E.sigSeg); mv.appendChild(E.sigList);
    root.appendChild(mv);

    /* 5. 업종 등락 */
    var sc = mhSec("mhSectors", "업종 등락", '<span class="sub"></span>');
    E.secSub = $(".sub", sc);
    E.secBody = document.createElement("div");
    sc.appendChild(E.secBody);
    root.appendChild(sc);

    /* 6. 뉴스 · 공시 (공시 유형 칩·"내 종목만" 은 PC 요소를 옮겨 쓴다 — 07 의 핸들러가 renderDisclosures 를 부른다) */
    var nw = mhSec("mhNews", "시장 뉴스", '<span class="sub"></span>');
    E.newsSub = $(".sub", nw);
    E.newsBody = document.createElement("div");
    nw.appendChild(E.newsBody);
    root.appendChild(nw);
    var dc = mhSec("mhDart", "공시", '<span class="sub"></span>');
    E.dcSub = $(".sub", dc);
    var dcBar = document.createElement("div");
    dcBar.className = "mh-dcbar";
    var types = $("#dcTypes"), mineLb = $("#dcMine") && $("#dcMine").closest("label");
    if(types){ types.classList.add("m-chips"); dcBar.appendChild(types); }
    if(mineLb){
      mineLb.classList.add("mh-mine"); dcBar.appendChild(mineLb);
      var mineIn = $("input", mineLb); mineIn.classList.add("m-sw"); mineIn.setAttribute("role", "switch");
      mineLb.insertBefore(mineIn, null);                 // 글자 다음에 스위치
    }
    dc.appendChild(dcBar);
    E.dcBody = document.createElement("div");
    dc.appendChild(E.dcBody);
    root.appendChild(dc);

    /* 7. 접는 구역: 시가총액 지도 · 경제 캘린더 */
    if(tmap){
      tmap.classList.add("mh-tmapp");
      root.appendChild(mhFold("mhTmap", "시가총액 지도", "상위 150종목", tmap, mhTmapOpen));
      /* 터치: 호버 툴팁 대신 탭 → 상세 시트 (04 initTmapEvents 의 클릭·mousemove 보다 먼저 가로챈다) */
      var box = $("#tmap");
      box.addEventListener("click", function(e){
        var el = e.target.closest(".tile"); if(!el) return;
        e.stopPropagation();
        $("#ttip").style.display = "none";
        mhTileSheet(el.dataset.cd);
      }, true);
      box.addEventListener("mousemove", function(e){ if(isTouch) e.stopPropagation(); }, true);
    }
    var cw = $("#calWrap");
    if(cw){
      cw.classList.remove("hide");
      root.appendChild(mhFold("mhCal", "경제 캘린더", "TradingView · 한국/미국", cw, function(){ if(MH.calInit) MH.calInit(); }));
    }

    /* PC 패널: 숨긴 채 #m-home 안에 둔다 (공유 코드가 id 로 계속 쓴다) */
    [ov, today, sig, sec, feeds, cal].forEach(function(el){ if(el){ el.classList.add("mh-desk"); root.appendChild(el); } });

    /* 이벤트 (한 곳에서 위임) */
    root.addEventListener("click", function(e){
      var b;
      if((b = e.target.closest("[data-more]"))){
        var k = b.dataset.more;
        MH.open[k] = !MH.open[k];
        if(k === "sig") mhSafe(mhSignals);
        else if(k === "sec") mhSafe(mhSectors);
        else if(k === "news") mhNewsLoad(false);
        else if(k === "dc" && MH.dartR) mhSafe(function(){ mhDart(MH.dartR); });
        return;
      }
      if((b = e.target.closest(".mh-rep, .mh-mv"))){
        e.stopPropagation();
        mOpenStock({ mk:"KR", code:b.dataset.code, name:b.dataset.name });
        return;
      }
      if((b = e.target.closest(".mh-secrow"))){ mhOpenSector(b.dataset.sec); return; }
      if((b = e.target.closest("[data-act]"))){
        var a = b.dataset.act;
        e.stopPropagation();
        if(a === "myall") mrGotoReports();
        else if(a === "rep") showTab("rep");
        else if(a === "scr") showTab("scr");
        else if(a === "assets") mGo("assets", { seg:"wl" });
      }
    });

    /* PC 렌더 함수 감싸기 — 같은 시점에 폰 렌더러도 다시 그린다.
       홈이 숨어 있으면 폰 렌더는 건너뛴다(mhLive) — show() 가 mhRenderAll 로 모두 다시 그린다 */
    var w_ri = renderIndex;
    renderIndex = function(idx){
      var r = w_ri.apply(this, arguments);
      if(idx) MH.idx = Object.assign({}, MH.idx || {}, idx);
      mhLive(mhMarket);
      return r;
    };
    var w_rm = renderMarket;
    renderMarket = function(){ var r = w_rm.apply(this, arguments); mhLive(mhMarket); return r; };
    var w_rg = renderGauge;
    renderGauge = function(){ var r = w_rg.apply(this, arguments); mhLive(mhMarket); return r; };
    var w_rs = renderSignals;
    renderSignals = function(){ var r = w_rs.apply(this, arguments); mhLive(mhSignals); return r; };
    var w_sp = renderSectorPerf;
    renderSectorPerf = function(){ var r = w_sp.apply(this, arguments); mhLive(mhSectors); return r; };
    var w_td = rpRenderToday;
    rpRenderToday = function(){ var r = w_td.apply(this, arguments); mhLive(mhToday); return r; };
    /* mrRender 는 한 번의 시세 갱신에서 두 번 불린다(11 의 renderWatchlist·renderPortfolio 감싸기).
       같은 틱의 호출을 하나로 묶는다 — PC 표(#myRep, 앱에서는 숨김)와 mrSync 상태 갱신은 그대로 한 번 돈다 */
    var w_mr = mrRender, mrQ = false;
    mrRender = function(){
      if(mrQ) return;
      mrQ = true;
      Promise.resolve().then(function(){
        mrQ = false;
        try{ w_mr(); }catch(e){ console.error("[m-home] mrRender", e); }
        mhLive(mhMyRep);
      });
    };
    var w_mb = mrBadges;
    mrBadges = function(){ var r = w_mb.apply(this, arguments); var n = mrLoadSeen().unread.length;
      if(E.myBadge){ E.myBadge.textContent = n > 99 ? "99+" : String(n); E.myBadge.classList.toggle("m-off", !n); } return r; };
    var w_sn = rpShowNotice;
    rpShowNotice = function(html){
      var r = w_sn.apply(this, arguments);
      MH.rpErr = !!html && !RP_READY;
      if(MH.rpErr){ mhLive(mhToday); mhLive(mhMyRep); }
      return r;
    };
    var w_mn = renderMarketNews;
    renderMarketNews = function(force){ var r = w_mn.apply(this, arguments); if(M.cur === "home") mhNewsLoad(force); return r; };
    var w_dc = renderDisclosures;
    renderDisclosures = function(force){ var r = w_dc.apply(this, arguments); if(M.cur === "home") mhDartLoad(force); return r; };
    var w_th = applyTheme;
    applyTheme = function(){ var r = w_th.apply(this, arguments); if(M.cur === "home") mhRenderAll(); return r; };
    /* 경제 캘린더: 07 init 이 부르는 초기화(iframe src 지정)를 펼칠 때로 미룬다 */
    var w_cal = initCalendar;
    initCalendar = function(){};
    MH.calInit = function(){ MH.calInit = null; w_cal(); };

    mPullToRefresh(root, function(){
      return mRefresh().then(function(){
        MH.justAt = Date.now();
        mhSafe(mhMarket);
        setTimeout(function(){ mhSafe(mhMarket); }, 61000);
      });
    });
  },
  show: function(){
    mDesk("dash");                 // 트리맵·뉴스·공시 갱신, 내 종목 리포트 읽음 처리 기준
    var root = mRoot("home");
    if(MH.scroll && !root.scrollTop) root.scrollTop = MH.scroll;
    mhRenderAll();
  },
  hide: function(){
    MH.scroll = mRoot("home").scrollTop;
  },
  /* 앱 바 새로고침·당겨서 새로고침: 시세(mRefresh 가 refreshAll)와 함께 뉴스·공시도 다시 받는다 */
  refresh: function(){
    renderMarketNews(true); renderDisclosures(true);
    return Promise.resolve();
  }
});
