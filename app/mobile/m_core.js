/* =========================================================================
   앱(모바일) 코어 — app/mobile/m_core.js
   화면 등록 · 화면 전환 · 히스토리(뒤로가기) · 바텀 시트 · 당겨서 새로고침 · 앱 바 · 종목 검색
   공유 JS(03~11, 07)와 같은 <script> 안에서 그 뒤에 붙는다 → curTab·AN·S 같은 전역을 그대로 쓴다.
   실행 순서: (스크립트 평가) 화면 모듈 등록 → mBoot() [본문 패널을 화면으로 옮김, 전역 감싸기]
             → DOMContentLoaded: 07 의 init() → mStart() [첫 화면 표시]
   API 안내: docs/MOBILE-APP-SPEC.md §7
   ========================================================================= */
const M = {
  order: ["home", "reports", "stock", "assets", "more"],
  screens: {},          // name -> 화면 정의 {title, mount, show, hide, refresh}
  cur: null,            // 지금 화면
  params: {},           // 지금 화면 파라미터
  last: {},             // 화면별 마지막 파라미터 (탭 바로 돌아올 때 복원)
  depth: 0,             // 히스토리 깊이 (0 = 홈 뿌리 항목)
  sheets: [],           // 열린 시트 [{id, kind:"sheet"|"mask", el, close}]
  started: false
};
let mDeskShowTab = null;    // PC showTab 원본 (mBoot 가 잡아 둔다)

/* ---------- 화면 등록 ---------- */
/* def: { title: "문자열" | function(params), mount(root), show(params, prevScreen), hide(), refresh() → Promise }
   mount 는 부팅 때 한 번(07 init 보다 먼저), show 는 화면이 보일 때·파라미터가 바뀔 때마다 */
function mScreen(name, def){
  def.name = name;
  M.screens[name] = def;
}
function mRoot(name){ return document.getElementById("m-" + name); }

/* PC 탭 상태 맞추기: 공유 코드는 curTab 으로 지연 렌더·갱신 범위를 정한다.
   PC 에 없는 탭 이름("wl", "more" 등)은 curTab 만 바꾼다. */
function mDesk(id){
  if(document.getElementById("tab-" + id) && mDeskShowTab) mDeskShowTab(id);
  else curTab = id;
}

/* ---------- 화면 전환 / 히스토리 ----------
   항목 상태: {m:1, screen, params, depth, sheet?}
   - 홈으로 갈 때는 뿌리 항목(depth 0)까지 되감는다 → 홈에서 뒤로 = 앱 나가기
   - 다른 화면으로는 push, 같은 화면의 파라미터 변경은 replace (opts.push 로 강제 push)
   - 시트가 열린 채 이동하면 시트 항목을 새 화면으로 바꿔 쓴다 */
function mSame(a, b){ return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
function mState(){ var s = history.state; return s && s.m ? s : null; }
function mGo(screen, params, opts){
  opts = opts || {}; params = params || {};
  if(!M.screens[screen]) return;
  var st = mState(), depth = st ? st.depth : M.depth;
  var hadSheet = M.sheets.length > 0;
  if(hadSheet) mDropSheets();
  if(screen === "home" && depth > 0 && !opts.replace){
    history.go(-depth);                       // popstate 가 홈을 그린다
    return;
  }
  var same = screen === M.cur && mSame(params, M.params);
  var nst = { m:1, screen:screen, params:params, depth:depth };
  if(hadSheet || opts.replace || same || (screen === M.cur && !opts.push)){
    history.replaceState(nst, "", "#" + screen);
  }else{
    nst.depth = depth + 1;
    history.pushState(nst, "", "#" + screen);
  }
  M.depth = nst.depth;
  mApply(screen, params);
}
function mBack(){ history.back(); }

function mApply(screen, params){
  var def = M.screens[screen], prev = M.cur;
  if(prev && prev !== screen){
    var pd = M.screens[prev];
    try{ if(pd.hide) pd.hide(); }catch(e){ console.error("[m] hide " + prev, e); }
    mRoot(prev).classList.remove("act");
  }
  M.cur = screen; M.params = params || {}; M.last[screen] = M.params;
  mRoot(screen).classList.add("act");
  $$("#mTabs button").forEach(function(b){
    var on = b.dataset.screen === screen;
    b.classList.toggle("act", on);
    if(on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  mSetBack(false);
  mSetTitle(typeof def.title === "function" ? def.title(M.params) : (def.title || ""));
  try{ if(def.show) def.show(M.params, prev); }catch(e){ console.error("[m] show " + screen, e); }
}

window.addEventListener("popstate", function(e){
  var st = e.state && e.state.m ? e.state : null;
  if(!st) return;
  /* 상태에 없는 시트는 닫는다 (뒤로가기 = 시트 닫기) */
  while(M.sheets.length && M.sheets[M.sheets.length - 1].id !== st.sheet){
    mCloseSheetDom(M.sheets.pop());
  }
  M.depth = st.depth;
  if(st.screen !== M.cur || !mSame(st.params, M.params)) mApply(st.screen, st.params);
});

/* ---------- 앱 바 ---------- */
function mSetTitle(t){ $("#mTitle").textContent = t || ""; }
function mSetBack(on){
  $("#mBack").classList.toggle("m-off", !on);
  $("#mBar").classList.toggle("has-back", !!on);
}

/* 새로고침: 시세 + 지금 화면의 refresh() */
let mRefreshing = false;
function mRefresh(){
  if(mRefreshing) return Promise.resolve();
  mRefreshing = true;
  var btn = $("#mRefreshBtn");
  btn.classList.add("busy");
  failStreak = 0;
  var jobs = [refreshAll()];
  try{ renderMarket(); }catch(e){}
  var def = M.screens[M.cur];
  if(def && def.refresh){
    try{ jobs.push(Promise.resolve(def.refresh())); }catch(e){ console.error("[m] refresh", e); }
  }
  return Promise.all(jobs).catch(function(e){ console.warn("[m] 새로고침 실패", e); })
    .then(function(){ mRefreshing = false; btn.classList.remove("busy"); });
}

/* ---------- 바텀 시트 ----------
   mSheet({ id, title, content: Node|HTML 문자열, onClose }) → { el, body, close() }
   열면 히스토리 항목을 하나 쌓는다 → 안드로이드 뒤로가기가 시트를 닫는다 */
let mSheetSeq = 0;
function mSheet(opts){
  opts = opts || {};
  var id = opts.id || ("sheet" + (++mSheetSeq));
  var host = $("#mSheetHost");
  var back = document.createElement("div");
  back.className = "msheet-back";
  var el = document.createElement("div");
  el.className = "msheet" + (opts.cls ? " " + opts.cls : "");
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = '<div class="msheet-grab"></div><div class="msheet-hd"><span class="msheet-tt"></span>' +
    '<button class="mbar-btn msheet-x" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="msheet-bd"></div>';
  $(".msheet-tt", el).textContent = opts.title || "";
  var body = $(".msheet-bd", el);
  if(typeof opts.content === "string") body.innerHTML = opts.content;
  else if(opts.content) body.appendChild(opts.content);
  host.appendChild(back); host.appendChild(el);
  var ent = { id:id, kind:"sheet", el:el, back:back, onClose:opts.onClose, content:opts.content };
  var api = { el:el, body:body, close:function(){ mCloseSheet(ent); } };
  back.onclick = api.close;
  $(".msheet-x", el).onclick = api.close;
  mPushSheet(ent);
  requestAnimationFrame(function(){ back.classList.add("open"); el.classList.add("open"); });
  return api;
}
function mPushSheet(ent){
  M.sheets.push(ent);
  var st = mState() || { m:1, screen:M.cur, params:M.params, depth:M.depth };
  var nst = { m:1, screen:st.screen, params:st.params, depth:st.depth + 1, sheet:ent.id };
  history.pushState(nst, "", location.hash);
  M.depth = nst.depth;
}
/* UI 로 닫기: 히스토리 항목이 이 시트면 뒤로 (popstate 가 DOM 을 닫는다) */
function mCloseSheet(ent){
  var st = mState();
  if(st && st.sheet === ent.id){ history.back(); return; }
  var i = M.sheets.indexOf(ent);
  if(i >= 0) M.sheets.splice(i, 1);
  mCloseSheetDom(ent);
}
function mCloseSheetDom(ent){
  if(ent.closed) return;
  ent.closed = true;
  if(ent.kind === "mask"){ ent.el.classList.remove("open"); return; }
  ent.el.classList.remove("open"); ent.back.classList.remove("open");
  /* 다시 쓰는 내용 노드는 떼어 둔다 (시트 DOM 과 함께 버려지지 않게) */
  setTimeout(function(){
    if(ent.content && ent.content.nodeType && ent.content.parentNode) ent.content.parentNode.removeChild(ent.content);
    ent.el.remove(); ent.back.remove();
  }, 240);
  if(ent.onClose){ try{ ent.onClose(); }catch(e){ console.error(e); } }
}
/* 히스토리는 두고 DOM 만 닫기 (화면 이동 직전) */
function mDropSheets(){
  while(M.sheets.length) mCloseSheetDom(M.sheets.pop());
}
/* PC 모달(.mask: 설정·잔고 가져오기)도 시트처럼 뒤로가기로 닫히게 */
function mWatchMasks(){
  $$(".mask").forEach(function(mask){
    var id = "mask-" + mask.id, ent = null;
    new MutationObserver(function(){
      var open = mask.classList.contains("open");
      if(open && !ent){
        ent = { id:id, kind:"mask", el:mask };
        mPushSheet(ent);
      }else if(!open && ent){
        var e = ent; ent = null;
        if(e.closed) return;                      // popstate 가 닫았다
        e.closed = true;
        var i = M.sheets.indexOf(e);
        if(i >= 0) M.sheets.splice(i, 1);
        var st = mState();
        if(st && st.sheet === id) history.back(); // 모달 버튼으로 닫음 → 쌓인 항목 정리
      }
    }).observe(mask, { attributes:true, attributeFilter:["class"] });
  });
}

/* ---------- 당겨서 새로고침 ----------
   mPullToRefresh(scrollEl, fn) — scrollEl 이 맨 위일 때 아래로 당기면 fn() (Promise) 을 부른다. 기본 fn 은 mRefresh */
function mPullToRefresh(el, fn){
  var ind = $("#mPtr"), y0 = null, x0 = 0, d = 0, busy = false;
  function reset(){ ind.classList.remove("show", "ready", "busy"); ind.style.transform = ""; }
  el.addEventListener("touchstart", function(e){
    if(busy || el.scrollTop > 0 || e.touches.length !== 1 || M.sheets.length){ y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; d = 0;
  }, { passive:true });
  el.addEventListener("touchmove", function(e){
    if(y0 === null) return;
    var dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if(el.scrollTop > 0 || dy <= 0 || Math.abs(dx) > Math.abs(dy)){ d = 0; reset(); if(dy < 0 || Math.abs(dx) > 12) y0 = null; return; }
    d = Math.min(90, dy * 0.5);
    ind.classList.add("show");
    ind.classList.toggle("ready", d >= 56);
    ind.style.transform = "translateY(" + (d - 44) + "px) rotate(" + (d * 4) + "deg)";
  }, { passive:true });
  el.addEventListener("touchend", function(){
    if(y0 === null) return;
    y0 = null;
    if(d < 56){ reset(); return; }
    busy = true; ind.classList.add("busy"); ind.style.transform = "";
    Promise.resolve().then(function(){ return fn ? fn() : mRefresh(); }).catch(function(e){ console.warn(e); })
      .then(function(){ busy = false; reset(); });
  }, { passive:true });
}

/* ---------- 세그먼트 ----------
   mSegBar(items:[[값, 라벨], …], onPick) → <div class="m-seg">. el.mSet(값) 으로 선택 표시 */
function mSegBar(items, onPick){
  var el = document.createElement("div");
  el.className = "m-seg"; el.setAttribute("role", "tablist");
  el.innerHTML = items.map(function(it){
    return '<button role="tab" data-v="' + esc(it[0]) + '">' + esc(it[1]) + '</button>';
  }).join("");
  el.onclick = function(e){ var b = e.target.closest("button[data-v]"); if(b) onPick(b.dataset.v); };
  el.mSet = function(v){
    $$("button", el).forEach(function(b){
      var on = b.dataset.v === v;
      b.classList.toggle("act", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
  };
  return el;
}
/* PC 패널 찾기: id 를 가진 요소에서 가장 가까운 .panel (또는 지정 선택자) */
function mPanelOf(sel, up){ var el = $(sel); return el ? el.closest(up || ".panel") : null; }

/* ---------- 종목 열기 · 최근 본 종목 ---------- */
const M_RECENT_KEY = "gongdo-m-recent";
function mRecent(){
  try{ var a = JSON.parse(localStorage.getItem(M_RECENT_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch(e){ return []; }
}
function mRecentAdd(it){
  if(!it || !it.code || it.mk === "IDX") return;
  var a = mRecent().filter(function(x){ return x.code !== it.code; });
  a.unshift({ mk:it.mk || "KR", code:it.code, name:it.name || it.code });
  try{ localStorage.setItem(M_RECENT_KEY, JSON.stringify(a.slice(0, 12))); }catch(e){}
}
/* 어디서든 종목 탭을 그 종목으로 연다 */
function mOpenStock(it, seg){
  if(!it || !it.code) return;
  mGo("stock", { seg:seg || "anal", code:it.code, mk:it.mk || "KR", name:it.name || it.code }, { push:true });
}

/* 앱 바 검색 시트 (검색 상자는 한 번 만들어 setupSearch 를 한 번만 건다) */
let mSearchBox = null;
function mOpenSearch(){
  if(!mSearchBox){
    mSearchBox = document.createElement("div");
    mSearchBox.innerHTML = '<div class="srch m-srch" id="mSrch"><input type="text" placeholder="종목명 · 코드 (예: 삼성전자, 005930)" ' +
      'autocomplete="off" enterkeyhint="search" aria-label="종목 검색"><div class="sug"></div></div>' +
      '<div class="m-recent" id="mRecentBox"></div>';
    mSearchBox.addEventListener("click", function(e){
      var b = e.target.closest("[data-rc]"); if(!b) return;
      var it = mRecent().filter(function(x){ return x.code === b.dataset.rc; })[0];
      if(it) mOpenStock(it);
    });
  }
  var rc = mRecent();
  $("#mRecentBox", mSearchBox).innerHTML = rc.length
    ? '<div class="m-h">최근 본 종목</div><div class="m-list">' + rc.map(function(x){
        return '<button class="m-row" data-rc="' + esc(x.code) + '"><span class="m-row-t">' + esc(x.name) +
               '</span><span class="m-row-v m-num">' + esc(x.code) + '</span></button>';
      }).join("") + '</div>'
    : '<div class="m-empty">종목명이나 6자리 코드로 검색하세요.</div>';
  $("input", mSearchBox).value = "";
  $(".sug", mSearchBox).classList.remove("open");
  mSheet({ id:"search", title:"종목 검색", content:mSearchBox });
  /* setupSearch 는 선택자 문자열을 받으므로 문서에 붙은 뒤 한 번만 건다 */
  if(!mSearchBox.mWired){ setupSearch("#mSrch", function(it){ mOpenStock(it); }); mSearchBox.mWired = true; }
  setTimeout(function(){ var i = $("input", mSearchBox); if(i) i.focus(); }, 260);
}

/* ---------- 부팅 ---------- */
/* 스크립트 평가 중(07 init 보다 먼저) 호출된다: 본문은 이미 파싱되어 있으므로 패널을 옮길 수 있다 */
function mBoot(){
  /* 1) 화면 mount — PC 패널을 각 화면 뿌리로 옮긴다 */
  M.order.forEach(function(name){
    var def = M.screens[name];
    if(!def){ console.error("[m] 화면 모듈 없음: " + name); return; }
    try{ if(def.mount) def.mount(mRoot(name)); }catch(e){ console.error("[m] mount " + name, e); }
  });
  /* 2) 앱 바: 시세 지연 표시를 앱 바로 */
  var qs = $("#qStat");
  if(qs) $("#mBar").insertBefore(qs, $("#mSearchBtn"));

  /* 3) PC 탭 전환을 앱 화면 전환으로 바꾼다 (공유 코드의 showTab("anal") 등이 그대로 동작) */
  mDeskShowTab = showTab;
  var MAP = { dash:["home"], rep:["reports"], acct:["assets", { seg:"acct" }],
              anal:["stock", { seg:"anal" }], cmp:["stock", { seg:"cmp" }],
              scr:["more", { sub:"scr" }], alr:["more", { sub:"alr" }] };
  showTab = function(id){
    var m = MAP[id];
    if(!m) return mDeskShowTab(id);
    var p = Object.assign({}, m[1] || {});
    if(m[0] === "stock"){
      var sel = AN.sel || null;
      if(sel){ p.code = sel.code; p.mk = sel.mk; p.name = sel.name; }
    }
    if(m[0] === "more" && M.cur === "more") return mGo("more", p, { push:true });
    mGo(m[0], p);
  };
  /* 4) 종목 선택을 최근 본 종목에 기록, 종목 화면이면 히스토리 파라미터도 맞춘다 */
  var selectStockNow = selectStock;
  selectStock = function(it){
    var r = selectStockNow.apply(this, arguments);
    mRecentAdd(it);
    var st = mState();
    if(it && M.cur === "stock" && st && !st.sheet && st.screen === "stock" && st.params.code !== it.code){
      var p = Object.assign({}, st.params, { code:it.code, mk:it.mk, name:it.name });
      history.replaceState(Object.assign({}, st, { params:p }), "", location.hash);
      M.params = p; M.last.stock = p;
    }
    return r;
  };

  /* 5) 셸 이벤트 */
  $("#mTabs").addEventListener("click", function(e){
    var b = e.target.closest("button[data-screen]"); if(!b) return;
    var name = b.dataset.screen;
    if(name === M.cur){
      var def = M.screens[name];
      if(def.reselect && def.reselect() === true) return;
      mRoot(name).scrollTo({ top:0, behavior:"smooth" });
      return;
    }
    mGo(name, M.last[name] || {});
  });
  $("#mBack").onclick = mBack;
  $("#mSearchBtn").onclick = mOpenSearch;
  $("#mRefreshBtn").onclick = function(){ mRefresh(); };
  mWatchMasks();

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", mStart);
  else setTimeout(mStart, 0);
}

/* 07 init() 다음: 첫 화면. 주소 해시(#reports 등, 매니페스트 바로가기)가 있으면 홈 위에 그 화면을 쌓는다 */
function mStart(){
  if(M.started) return;
  M.started = true;
  var want = (location.hash || "").replace(/^#/, "");
  history.replaceState({ m:1, screen:"home", params:{}, depth:0 }, "", "#home");
  M.depth = 0;
  mApply("home", {});
  if(want && want !== "home" && M.screens[want]) mGo(want, {});
}
