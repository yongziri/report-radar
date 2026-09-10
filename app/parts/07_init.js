/* =========================================================================
   알림 / 탭 / 테마 / 설정 / 초기화
   ========================================================================= */
const COND_LABEL = { ge:"현재가 이상", le:"현재가 이하", rge:"등락률 이상", rle:"등락률 이하" };
let alPick = null;

function renderAlerts(){
  var tb = $("#alBody"); tb.innerHTML = "";
  $("#alEmpty").style.display = S.alerts.length ? "none" : "block";
  S.alerts.forEach(function(a, i){
    var q = QUOTES[keyOf(a.mk, a.code)];
    var isRate = a.cond === "rge" || a.cond === "rle";
    var cur = q ? (isRate ? q.pct : q.price) : null;
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="c">' + (a.on ? '<span class="pill u">감시중</span>' : '<span style="color:var(--tx3)">중지</span>') + '</td>' +
      '<td class="l"><span class="tk">' + esc(a.name) + '</span></td>' +
      '<td class="l">' + COND_LABEL[a.cond] + '</td>' +
      '<td class="num">' + (isRate ? fmtPct(a.val) : fmtPrice(a.val, a.mk)) + '</td>' +
      '<td class="num">' + (cur !== null ? (isRate ? fmtPct(cur) : fmtPrice(cur, a.mk)) : "-") + '</td>' +
      '<td class="l" style="color:var(--tx3);white-space:normal">' + esc(a.memo||"") + '</td>' +
      '<td class="c"></td>';
    var td = tr.lastChild;
    var t = document.createElement("button");
    t.className = "btn xs"; t.textContent = a.on ? "중지" : "재활성";
    t.onclick = function(){ a.on = !a.on; save(); renderAlerts(); };
    var d = document.createElement("button");
    d.className = "btn xs"; d.textContent = "×"; d.style.marginLeft = "3px";
    d.onclick = function(){ S.alerts.splice(i,1); save(); renderAlerts(); };
    td.appendChild(t); td.appendChild(d);
    tb.appendChild(tr);
  });
  renderAlertLog();
}
function renderAlertLog(){
  var box = $("#alLog");
  if(!S.alertLog.length){ box.innerHTML = '<div style="color:var(--tx3)">발동 기록이 없습니다.</div>'; return; }
  box.innerHTML = S.alertLog.slice(0,60).map(function(l){
    return '<div class="it"><div>' + esc(l.msg) + '</div><div class="t">' + esc(l.at) + '</div></div>';
  }).join("");
}
function evalAlerts(){
  var fired = [];
  S.alerts.forEach(function(a){
    if(!a.on) return;
    var q = QUOTES[keyOf(a.mk, a.code)];
    if(!q || !q.ok) return;
    var hit = false, cur;
    if(a.cond === "ge"){ cur = q.price; hit = cur >= a.val; }
    else if(a.cond === "le"){ cur = q.price; hit = cur <= a.val; }
    else if(a.cond === "rge"){ cur = q.pct; hit = cur >= a.val; }
    else if(a.cond === "rle"){ cur = q.pct; hit = cur <= a.val; }
    if(!hit) return;
    a.on = false;
    var isRate = a.cond === "rge" || a.cond === "rle";
    var msg = a.name + " " + COND_LABEL[a.cond] + " " +
              (isRate ? fmtPct(a.val) : fmtPrice(a.val, a.mk)) + " 도달 — 현재 " +
              (isRate ? fmtPct(cur) : fmtPrice(cur, a.mk)) + (a.memo ? " · " + a.memo : "");
    fired.push(msg);
    S.alertLog.unshift({ msg:msg, at:new Date().toLocaleString("ko-KR") });
  });
  if(!fired.length) return;
  S.alertLog = S.alertLog.slice(0, 200);
  save(); renderAlerts(); beep();
  fired.forEach(function(m){ toast("알림: " + m, "ok"); notify("주식 알림", m); });
}
function notify(title, body){
  try{
    if(typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body:body });
  }catch(e){}
}
function beep(){
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    var ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.34);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.36);
    setTimeout(function(){ try{ ac.close(); }catch(e){} }, 700);
  }catch(e){}
}
function syncNotiState(){
  var el = $("#notiState");
  if(typeof Notification === "undefined"){ el.textContent = " 이 브라우저는 알림 API를 지원하지 않습니다."; return; }
  var p = Notification.permission;
  el.textContent = p === "granted" ? " 브라우저 알림 권한: 허용됨."
    : (p === "denied" ? " 알림 권한이 거부되어 앱 내 알림과 소리만 동작합니다."
    : " 알림 권한이 아직 설정되지 않았습니다.");
}

/* =========================================================================
   포트폴리오 잔고 가져오기 (UI)
   파싱 로직은 08_import.js(순수 함수)에 있고 여기서는 화면만 담당한다.
   ========================================================================= */
const IMP = { text:"", parsed:null, force:{}, fix:{}, mode:"merge", encoding:"", acct:"" };
const IMP_FIELDS = [["", "무시"], ["code","종목코드"], ["name","종목명"], ["qty","수량"], ["avg","평단가"]];

/* 종목명 -> {code, mk} 역매핑 (내장 유니버스 + 관심종목 + 기존 포트폴리오) */
function buildNameLookup(){
  var exact = {}, norm = {};
  function add(name, code, mk){
    if(!name || !code) return;
    var s = String(name).trim();
    if(exact[s] === undefined) exact[s] = { code:code, mk:mk };
    var n = s.replace(/\s/g, "");
    if(norm[n] === undefined) norm[n] = { code:code, mk:mk };
  }
  UNIVERSE.forEach(function(u){ add(u.name, u.code, u.market === "US" ? "US" : "KR"); });
  allWL().concat(S.portfolio).forEach(function(x){ add(x.name, x.code, x.mk); });
  return function(name){
    if(!name) return null;
    var s = String(name).trim();
    return exact[s] || norm[s.replace(/\s/g, "")] || null;
  };
}

/* CSV 를 반영할 계좌 (모달에서 선택) */
function impTarget(){
  var l = ACCTS();
  for(var i=0;i<l.length;i++){ if(l[i].id === IMP.acct) return l[i]; }
  return curAcct();
}

function openImport(){
  IMP.text = ""; IMP.parsed = null; IMP.force = {}; IMP.fix = {}; IMP.mode = "merge"; IMP.encoding = "";
  IMP.acct = curAcct().id;
  $("#impAcct").innerHTML = ACCTS().map(function(a){
    return '<option value="' + esc(a.id) + '"' + (a.id === IMP.acct ? " selected" : "") + '>' +
           esc(a.name) + " (" + a.items.length + "종목)</option>";
  }).join("");
  $("#impText").value = "";
  $("#impFile").value = "";
  $("#impFileInfo").textContent = "";
  $("#impStep2").classList.add("hide");
  $("#impApply").disabled = true;
  $$("#impMode button").forEach(function(b){ b.classList.toggle("act", b.dataset.m === "merge"); });
  $("#impMask").classList.add("open");
}
function closeImport(){ $("#impMask").classList.remove("open"); }

function runImportParse(){
  if(!IMP.text.trim()){ $("#impStep2").classList.add("hide"); $("#impApply").disabled = true; return; }
  IMP.parsed = parseHoldings(IMP.text, buildNameLookup(), IMP.force);
  renderImportPreview();
}

function renderImportPreview(){
  var p = IMP.parsed;
  $("#impStep2").classList.remove("hide");

  var dn = p.delim === "\t" ? "탭" : (p.delim === "," ? "쉼표" : p.delim);
  $("#impMeta").textContent = "구분자 " + dn + " · " +
    (p.headerIdx >= 0 ? "헤더 " + (p.headerIdx + 1) + "행" : "헤더 없음(내용 추정)") +
    (IMP.encoding ? " · " + IMP.encoding : "");

  /* 원본 표 + 열 매핑 드롭다운 */
  var inv = {};
  Object.keys(p.map).forEach(function(k){ inv[p.map[k]] = k; });
  var head = '<tr>' ;
  for(var c=0;c<p.cols;c++){
    head += '<th><select data-col="' + c + '">' + IMP_FIELDS.map(function(f){
      return '<option value="' + f[0] + '"' + (inv[c] === f[0] || (!inv[c] && !f[0]) ? " selected" : "") +
             '>' + f[1] + '</option>';
    }).join("") + '</select></th>';
  }
  head += '</tr>';
  if(p.header){
    head += '<tr>' ;
    for(var h=0;h<p.cols;h++)
      head += '<th class="' + (inv[h] ? "mapped" : "") + '">' + esc(p.header[h] || "") + '</th>';
    head += '</tr>';
  }

  var body = p.rows.slice(0, 40).map(function(r){
    var cells = "";
    for(var c2=0;c2<p.cols;c2++) cells += "<td>" + esc(r.raw[c2] === undefined ? "" : r.raw[c2]) + "</td>";
    return '<tr class="' + (r.matched || IMP.fix[r.name] ? "" : "unmatched") + '">' + cells + "</tr>";
  }).join("");
  var skipped = p.skipped.slice(0, 10).map(function(s){
    var cells = "";
    for(var c3=0;c3<p.cols;c3++) cells += "<td>" + esc(s.raw[c3] === undefined ? "" : s.raw[c3]) + "</td>";
    return '<tr class="skip">' + cells + "</tr>";
  }).join("");
  $("#impPrev").innerHTML = head + body + skipped;

  $$("#impPrev select").forEach(function(sel){
    sel.onchange = function(){
      var col = +sel.dataset.col, field = sel.value;
      /* 같은 필드가 다른 열에 있으면 해제하고 이 열로 옮긴다 */
      Object.keys(IMP.force).forEach(function(k){ if(IMP.force[k] === col) IMP.force[k] = null; });
      ["code","name","qty","avg"].forEach(function(k){
        if(p.map[k] === col && k !== field) IMP.force[k] = null;
      });
      if(field) IMP.force[field] = col;
      runImportParse();
    };
  });

  /* 미매칭 행 직접 입력 */
  var un = p.rows.filter(function(r){ return !r.matched && !IMP.fix[r.name]; });
  $("#impFixWrap").classList.toggle("hide", !un.length);
  $("#impFix").innerHTML = un.slice(0, 20).map(function(r){
    return '<div class="impfix"><span class="nm">' + esc(r.name || "(이름없음)") + '</span>' +
      '<input type="text" data-nm="' + esc(r.name) + '" placeholder="005930 또는 AAPL"></div>';
  }).join("");
  $$("#impFix input").forEach(function(inp){
    inp.onchange = function(){
      var v = inp.value.trim();
      if(v) IMP.fix[inp.dataset.nm] = v; else delete IMP.fix[inp.dataset.nm];
      renderImportPreview();
    };
  });

  renderImportSummary();
}

/* 미매칭 보정을 반영한 최종 반영 대상 */
function importResolved(){
  if(!IMP.parsed) return [];
  return IMP.parsed.rows.map(function(r){
    var code = r.code, mk = r.mk;
    var f = IMP.fix[r.name];
    if(!code && f){
      if(/^[Aa]?\d{6}$/.test(f)){ code = f.replace(/^[Aa]/, ""); mk = "KR"; }
      else { code = f.toUpperCase(); mk = "US"; }
    }
    return code ? { mk:mk, code:code, name:r.name || code, qty:r.qty, avg:r.avg } : null;
  }).filter(Boolean);
}

function renderImportSummary(){
  var p = IMP.parsed, list = importResolved(), acc = impTarget();
  var un = p.rows.length - list.length;
  var exist = {};
  acc.items.forEach(function(x){ exist[keyOf(x.mk, x.code)] = true; });
  var dup = list.filter(function(x){ return exist[keyOf(x.mk, x.code)]; }).length;
  var isNew = list.length - dup;

  var eff = "“" + acc.name + "” 계좌에 · ";
  if(IMP.mode === "replace") eff += "기존 " + acc.items.length + "종목을 모두 지우고 " + list.length + "종목으로 교체";
  else if(IMP.mode === "addnew") eff += "새 종목 " + isNew + "종목만 추가 (기존 " + dup + "종목은 그대로)";
  else eff += "기존 " + dup + "종목 수량·평단 덮어쓰기 + 새 종목 " + isNew + "종목 추가";

  $("#impSummary").innerHTML =
    "<b>" + list.length + "종목 인식</b>" +
    (un ? ' · <span class="down">' + un + "종목 미매칭(제외됨)</span>" : "") +
    (p.skipped.length ? ' · <span style="color:var(--tx3)">' + p.skipped.length + "행 제외(합계·빈행)</span>" : "") +
    "<br>" + eff;
  $("#impApply").disabled = !list.length;
}

function applyImport(){
  var list = importResolved();
  if(!list.length){ toast("반영할 종목이 없습니다.", "err"); return; }
  var acc = impTarget(), before = acc.items.length;
  if(IMP.mode === "replace"){
    acc.items = list.map(function(x){
      return { mk:x.mk, code:x.code, name:x.name, qty:x.qty, avg:x.avg, memo:"" };
    });
  }else{
    var idx = {};
    acc.items.forEach(function(x, i){ idx[keyOf(x.mk, x.code)] = i; });
    list.forEach(function(x){
      var k = keyOf(x.mk, x.code);
      if(idx[k] !== undefined){
        if(IMP.mode === "merge"){
          acc.items[idx[k]].qty = x.qty;
          acc.items[idx[k]].avg = x.avg;
        }
      }else{
        acc.items.push({ mk:x.mk, code:x.code, name:x.name, qty:x.qty, avg:x.avg, memo:"" });
        idx[k] = acc.items.length - 1;
      }
    });
  }
  S.acctSel = acc.id;
  save(); renderAccounts(); renderPortfolio(); refreshAll(); closeImport();
  toast("“" + acc.name + "” 반영 완료 — " + before + "종목 → " + acc.items.length + "종목", "ok");
}

function initImport(){
  $("#acImport").onclick = openImport;
  $("#impClose").onclick = closeImport;
  $("#impCancel").onclick = closeImport;
  $("#impMask").onclick = function(e){ if(e.target === $("#impMask")) closeImport(); };
  $("#impText").addEventListener("input", function(){
    IMP.text = this.value; IMP.force = {}; IMP.fix = {}; IMP.encoding = "";
    runImportParse();
  });
  $("#impFile").onchange = function(){
    var f = this.files[0];
    if(!f) return;
    var fr = new FileReader();
    fr.onload = function(){
      var dec = decodeHoldingsBytes(fr.result);
      IMP.text = dec.text; IMP.force = {}; IMP.fix = {};
      IMP.encoding = dec.encoding.toUpperCase() + " 인식";
      $("#impText").value = dec.text;
      $("#impFileInfo").textContent = f.name + " · " + Math.round(f.size/1024*10)/10 + "KB · " + dec.encoding;
      runImportParse();
    };
    fr.onerror = function(){ toast("파일을 읽지 못했습니다.", "err"); };
    fr.readAsArrayBuffer(f);
  };
  $("#impAcct").onchange = function(){
    IMP.acct = this.value;
    if(IMP.parsed) renderImportSummary();
  };
  $("#impMode").onclick = function(e){
    var b = e.target.closest("button[data-m]"); if(!b) return;
    IMP.mode = b.dataset.m;
    $$("#impMode button").forEach(function(x){ x.classList.toggle("act", x === b); });
    renderImportSummary();
  };
  $("#impApply").onclick = applyImport;
}

/* ---------- 탭 / 테마 / 타이머 ---------- */
function showTab(id){
  curTab = id;
  $$("nav.tabs button").forEach(function(b){ b.classList.toggle("act", b.dataset.tab === id); });
  $$(".tab").forEach(function(t){ t.classList.toggle("act", t.id === "tab-" + id); });
  if(id === "anal" && AN.sel) setTimeout(drawChart, 20);
  if(id === "dash") setTimeout(function(){
    if(!TMAP_LOADED) loadTreemap(); else renderTreemap();
    renderWatchlist();
    renderMarketNews(); renderDisclosures();     // 10분 캐시라 탭 전환마다 재호출되지 않음
  }, 20);
  if(id === "acct") setTimeout(function(){ renderAccounts(); refreshAll(); }, 20);
  if(id === "cmp" && !CMP.sel && AN.sel) selectCompany(AN.sel);
  if(id === "scr" && scrView === "tree") setTimeout(function(){ renderScrTree(lastList); }, 20);
  if(id === "rep") setTimeout(function(){ rpRender(true); refreshAll(); }, 20);
}
function applyTheme(){
  document.documentElement.setAttribute("data-theme", S.theme);
  document.documentElement.setAttribute("data-cc", S.settings.cc || "global");
  $("#btnTheme").textContent = S.theme === "dark" ? "🌙" : "☀️";
  renderLegend();
  renderWatchlist();
  if(TMAP_LOADED) renderTreemap();
  if(scrView === "tree") renderScrTree(lastList);
  else if(scrView === "chart") renderScrChart(lastList);
  if(RP_READY) rpRender(true);                   // 리포트 히트맵·괴리율 배경색 재계산
  if(AN.sel) drawChart();
  var cf = $("#calFrame");                       // 캘린더 위젯도 테마를 따라간다
  if(cf && cf.src) cf.src = calendarUrl();
}
function renderLegend(){
  [-3,-1.5,0,1.5,3].forEach(function(p, i){
    var el = $("#lg" + (i+1));
    if(el) el.style.background = heatColor(p);
  });
}
let timer = null;
function startTimer(){
  stopTimer();
  timer = setInterval(function(){ refreshAll(); renderMarket(); },
                      Math.max(20, Number(S.settings.iv) || 60)*1000);
}
function stopTimer(){ if(timer){ clearInterval(timer); timer = null; } }
function syncAutoBtn(){
  var b = $("#btnAuto");
  b.classList.toggle("on", !!S.auto);
  b.textContent = S.auto ? "자동갱신 ON" : "자동갱신 OFF";
}

/* ---------- 설정 ---------- */
function openSettings(){
  $("#sIv").value = S.settings.iv;
  $("#sProxy").value = S.settings.proxy || "";
  $("#proxyMode").textContent = RSS.mode() === "proxy"
    ? "커스텀 프록시 (공시 50건 · rss2json 미사용)"
    : "rss2json (기본 · 공시 10건 제한)";
  $$("#segCC button").forEach(function(b){ b.classList.toggle("act", b.dataset.cc === (S.settings.cc||"global")); });
  $("#mask").classList.add("open");
}
function closeSettings(){ $("#mask").classList.remove("open"); }
function exportJson(){
  var blob = new Blob([JSON.stringify(S, null, 2)], { type:"application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stock-helper-" + todayStr() + ".json";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  toast("설정을 JSON으로 내보냈습니다.", "ok");
}
function importJson(file){
  var fr = new FileReader();
  fr.onload = function(){
    try{
      var o = JSON.parse(fr.result);
      if(!o || typeof o !== "object") throw new Error("형식 오류");
      S = o;
      Object.keys(DEFAULTS).forEach(function(k){ if(S[k] === undefined) S[k] = DEFAULTS[k]; });
      bindPortfolioView(S);
      save(); location.reload();
    }catch(e){ toast("가져오기 실패: " + e.message, "err"); }
  };
  fr.readAsText(file);
}

/* ---------- 초기화 ---------- */
function init(){
  applyTheme(); syncAutoBtn(); renderMaLegend(); renderMarket();
  buildFilterUI(); buildPresetBtns(); buildColPicker(); renderScreens();
  renderWatchlist(); renderPortfolio(); renderAccounts(); renderAlerts(); syncNotiState();

  initTmapEvents($("#tmap"));
  initTmapEvents($("#scrTmap"));
  initChartEvents();
  initCmp();
  initCalendar();
  initHover();
  initImport();
  initAccounts();
  rpInit();                                       // 증권사 리포트 (데이터는 백그라운드 적재)
  setupSearch("#srchCmp", function(it){ selectCompany(it); });

  /* 헤더 지수 클릭 → 지수 차트 */
  [["#tKospi","KOSPI"],["#tKosdaq","KOSDAQ"],["#ovKospi","KOSPI"],["#ovKosdaq","KOSDAQ"]]
    .forEach(function(p){
      var el = $(p[0]);
      el.style.cursor = "pointer";
      el.title = p[1] + " 차트 보기";
      el.onclick = function(){ selectIndex(p[1]); };
    });

  /* 관심종목 그룹 */
  $("#wlTabs").onclick = function(e){
    var b = e.target.closest("button[data-g]"); if(!b) return;
    S.wlActive = +b.dataset.g; save(); renderWatchlist(); refreshAll(); loadSparklines();
  };
  $("#wlAddGrp").onclick = function(){
    var n = prompt("새 관심종목 그룹 이름", "그룹 " + (S.wlGroups.length + 1));
    if(!n || !n.trim()) return;
    S.wlGroups.push({ name:n.trim(), items:[] });
    S.wlActive = S.wlGroups.length - 1;
    save(); renderWatchlist();
    toast("그룹이 추가되었습니다: " + n.trim(), "ok");
  };
  $("#wlRenGrp").onclick = function(){
    var g = S.wlGroups[S.wlActive];
    var n = prompt("그룹 이름 변경", g.name);
    if(!n || !n.trim()) return;
    g.name = n.trim(); save(); renderWatchlist();
  };
  $("#wlDelGrp").onclick = function(){
    if(S.wlGroups.length <= 1){ toast("마지막 그룹은 삭제할 수 없습니다.", "err"); return; }
    var g = S.wlGroups[S.wlActive];
    if(!confirm("“" + g.name + "” 그룹과 그 안의 " + g.items.length + "종목을 삭제할까요?")) return;
    S.wlGroups.splice(S.wlActive, 1);
    S.wlActive = 0; save(); renderWatchlist(); refreshAll();
  };

  /* 업종 퍼포먼스 → 스크리너 업종 필터 */
  $("#secPerf").onclick = function(e){
    var row = e.target.closest("[data-sec]"); if(!row) return;
    FS = { sector:row.dataset.sec };
    scrSort = { key:"pct", dir:-1 };
    syncFilterUI(); applyFilter(); showTab("scr");
    toast(row.dataset.sec + " 업종 필터를 적용했습니다.", "ok");
  };

  /* 트리맵 기간 */
  $("#segTmap").onclick = function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    setTmapPeriod(b.dataset.p);
  };

  /* 공시 유형 탭 */
  $("#dcTypes").onclick = function(e){
    var b = e.target.closest("button[data-t]"); if(!b) return;
    dcFilter = b.dataset.t || "";
    renderDisclosures();
  };

  /* 마지막 스캔 결과 복원 */
  if(restoreScan()){
    $("#scrMsg").textContent = "이전 스캔 결과를 불러왔습니다 (" + SCAN_AT + "). '전체 스캔'으로 갱신하세요.";
  }
  renderGauge(); renderSignals(); renderSectorPerf(); applyFilter(); renderTmScope();
  if(MIGRATE_MSG){ save(); toast(MIGRATE_MSG, "err"); MIGRATE_MSG = ""; }
  syncAutoScan();

  $$("nav.tabs button").forEach(function(b){ b.onclick = function(){ showTab(b.dataset.tab); }; });

  $("#btnRefresh").onclick = function(){ failStreak = 0; refreshAll(); };
  $("#btnAuto").onclick = function(){
    S.auto = !S.auto; save(); syncAutoBtn();
    if(S.auto){ failStreak = 0; startTimer(); refreshAll(); } else stopTimer();
  };
  $("#btnTheme").onclick = function(){ S.theme = S.theme === "dark" ? "light" : "dark"; save(); applyTheme(); };
  $("#btnSet").onclick = openSettings;
  $("#tmapReload").onclick = function(){ loadTreemap(); };
  $("#sigPanels").addEventListener("click", onSignalClick);

  setupSearch("#srchWl", addWatch);
  setupSearch("#srchAn", function(it){ selectStock(it); });
  setupSearch("#srchAl", function(it){ alPick = it; $("#srchAl input").value = it.name; });

  $("#anAddWl").onclick = function(){
    if(!AN.sel){ toast("먼저 종목을 선택하세요."); return; }
    addWatch({ mk:AN.sel.mk, code:AN.sel.code, name:AN.sel.name });
  };
  $("#anCmp").onclick = function(){
    if(!AN.sel){ toast("먼저 종목을 선택하세요.", "err"); return; }
    selectCompany(AN.sel); showTab("cmp");
  };
  $("#anNewsReload").onclick = function(){ renderNews(true); };
  $("#mnReload").onclick = function(){ renderMarketNews(true); };
  $("#dcReload").onclick = function(){ renderDisclosures(true); };
  $("#dcMine").onchange = function(){ renderDisclosures(); };
  $("#segPeriod").onclick = function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    AN.period = b.dataset.p;
    $$("button", $("#segPeriod")).forEach(function(x){ x.classList.toggle("act", x === b); });
    loadBars();
  };
  $("#segTf").onclick = function(e){
    var b = e.target.closest("button[data-t]"); if(!b) return;
    AN.tf = b.dataset.t;
    $$("button", $("#segTf")).forEach(function(x){ x.classList.toggle("act", x === b); });
    loadBars();
  };
  $("#maLeg").onclick = function(e){
    var b = e.target.closest("button[data-ma]"); if(!b) return;
    AN.ma[b.dataset.ma] = !AN.ma[b.dataset.ma];
    renderMaLegend(); drawChart();
  };

  /* 스크리너 */
  $("#scrScan").onclick = runScan;
  $("#scrApply").onclick = applyFilter;
  $("#scrReset").onclick = function(){
    FS = {}; scrSort = { key:"pct", dir:-1 };
    syncFilterUI(); applyFilter();
  };
  $("#scrDeep").onclick = runDeep;
  $("#scrCsv").onclick = exportCsv;
  $("#scrCols").onclick = function(){ $("#colpick").classList.toggle("hide"); };
  $("#scrAddSel").onclick = function(){
    var codes = Object.keys(scrSelected);
    if(!codes.length){ toast("체크박스로 종목을 선택하세요.", "err"); return; }
    var n = 0;
    codes.forEach(function(cd){
      var q = QUOTES["KR:" + cd] || UNI_BY_KEY["KR:" + cd];
      if(q && addWatch({ mk:"KR", code:cd, name:q.name }, true)) n++;
    });
    scrSelected = {}; applyFilter(); refreshAll();
    toast(n + "종목을 관심종목에 추가했습니다.", "ok");
  };
  $("#segView").onclick = function(e){
    var b = e.target.closest("button[data-v]"); if(!b) return;
    setView(b.dataset.v);
  };
  $("#segColView").onclick = function(e){
    var b = e.target.closest("button[data-cv]"); if(!b) return;
    setColView(b.dataset.cv);
  };
  $("#presets").onclick = function(e){
    var b = e.target.closest("button[data-b]"); if(!b) return;
    $$("#presets button").forEach(function(x){ x.classList.toggle("act", x === b); });
    var v = b.dataset.b;
    if(!v){ FS = {}; scrSort = { key:"pct", dir:-1 }; syncFilterUI(); applyFilter(); return; }
    loadScreen(v);
  };
  $("#savedScreens").onchange = function(){ loadScreen(this.value); };
  $("#scrSave").onclick = saveScreen;
  $("#scrDel").onclick = deleteScreen;
  $("#autoScan").onchange = function(){
    S.autoScan = this.checked; save(); syncAutoScan();
    if(S.autoScan) maybeAutoScan();
  };
  $("#inclEtf").onchange = function(){
    S.inclEtf = this.checked; save();
    renderGauge(); renderSignals(); renderSectorPerf(); applyFilter();
    renderTmScope();
    if(TMAP_LOADED) loadTreemap();        // 상위 150 구성이 바뀌므로 재수집
    toast(S.inclEtf ? "통계·시그널에 ETF·ETN을 포함합니다." : "통계·시그널은 주식만 집계합니다.", "ok");
  };
  $("#segScope").onclick = function(e){
    var b = e.target.closest("button[data-s]"); if(!b) return;
    if(scanning){ toast("스캔이 진행 중입니다. 끝난 뒤 변경하세요.", "err"); return; }
    S.scanScope = b.dataset.s; save(); syncAutoScan();
    var d = maybeAutoScan();
    if(!d.go) toast("스캔 범위를 바꿨습니다. '다시 스캔'을 누르면 적용됩니다.");
  };
  $("#scrHead").addEventListener("click", function(e){
    var th = e.target.closest("th.srt"); if(!th) return;
    var k = th.dataset.s;
    if(scrSort.key === k) scrSort.dir *= -1;
    else scrSort = { key:k, dir:(COL_BY_K[k] && COL_BY_K[k].type === "s" ? 1 : -1) };
    applyFilter();
  });

  /* 알림 */
  $("#alAdd").onclick = function(){
    if(!alPick){ toast("종목을 먼저 선택하세요.", "err"); return; }
    var v = Number($("#alVal").value);
    if(!$("#alVal").value || isNaN(v)){ toast("기준값을 입력하세요.", "err"); return; }
    S.alerts.push({ mk:alPick.mk, code:alPick.code, name:alPick.name,
      cond:$("#alCond").value, val:v, memo:$("#alMemo").value.trim(), on:true });
    save(); renderAlerts(); refreshAll();
    $("#alVal").value = ""; $("#alMemo").value = ""; $("#srchAl input").value = "";
    toast("알림 규칙이 추가되었습니다.", "ok");
  };
  $("#btnNoti").onclick = function(){
    if(typeof Notification === "undefined"){ toast("이 브라우저는 알림을 지원하지 않습니다.", "err"); return; }
    Notification.requestPermission().then(function(p){
      syncNotiState();
      toast(p === "granted" ? "알림 권한이 허용되었습니다." : "알림 권한이 허용되지 않았습니다.", p === "granted" ? "ok" : "err");
    }).catch(function(){ toast("권한 요청 실패 (file:// 에서는 동작하지 않습니다)", "err"); });
  };
  $("#btnBeep").onclick = beep;
  $("#alLogClr").onclick = function(){ S.alertLog = []; save(); renderAlertLog(); };

  /* 설정 */
  $("#setClose").onclick = closeSettings;
  $("#setCancel").onclick = closeSettings;
  $("#mask").onclick = function(e){ if(e.target === $("#mask")) closeSettings(); };
  $("#segCC").onclick = function(e){
    var b = e.target.closest("button[data-cc]"); if(!b) return;
    $$("#segCC button").forEach(function(x){ x.classList.toggle("act", x === b); });
  };
  $("#setSave").onclick = function(){
    S.settings.iv = Math.max(20, Number($("#sIv").value) || 60);
    var cc = $("#segCC button.act");
    S.settings.cc = cc ? cc.dataset.cc : "global";
    var oldProxy = S.settings.proxy || "";
    S.settings.proxy = $("#sProxy").value.trim().replace(/\/+$/, "");
    save(); closeSettings(); applyTheme();
    renderMarket(); renderPortfolio(); renderAccounts(); renderSignals(); renderGauge(); renderSectorPerf(); applyFilter();
    if(S.auto) startTimer();
    if(S.settings.proxy !== oldProxy){        // 소스가 바뀌었으니 뉴스·공시 캐시 무효화
      Object.keys(RSS.cache).forEach(function(k){ delete RSS.cache[k]; });
      renderMarketNews(true); renderDisclosures(true);
      if(AN.sel && !isIdx(AN.sel)) renderNews(true);
      toast(S.settings.proxy ? "커스텀 프록시로 전환했습니다." : "rss2json 기본 모드로 되돌렸습니다.", "ok");
    }else toast("설정이 저장되었습니다.", "ok");
    refreshAll();
  };
  $("#sExp").onclick = exportJson;
  $("#sImp").onclick = function(){ $("#sFile").click(); };
  $("#sFile").onchange = function(){ if(this.files[0]) importJson(this.files[0]); };
  $("#sRst").onclick = function(){
    if(!confirm("관심종목·포트폴리오·알림·설정·저장된 스크린을 모두 삭제합니다. 계속할까요?")) return;
    localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_SCAN); location.reload();
  };

  var rt = null;
  window.addEventListener("resize", function(){
    clearTimeout(rt);
    rt = setTimeout(function(){
      if(AN.sel) drawChart();
      if(TMAP_LOADED) renderTreemap();
      if(scrView === "tree") renderScrTree(lastList);
      if(RP_READY && curTab === "rep") rpRender(true);
      renderWatchlist();
    }, 160);
  });

  refreshAll().then(function(){ maybeAutoScan(); });   // 첫 갱신 후 백그라운드 스캔
  loadTreemap();
  renderMarketNews();
  renderDisclosures();
  if(S.auto) startTimer();
  setInterval(renderMarket, 30000);
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
