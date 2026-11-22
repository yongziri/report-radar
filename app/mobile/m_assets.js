/* =========================================================================
   내 자산 화면 — app/mobile/m_assets.js (+ m_assets.css, 뿌리 #m-assets)
   세그먼트 [관심종목 | 계좌] (마지막 선택 기억). 파라미터: { seg:"wl"|"acct" }. 당겨서 새로고침.
   PC 패널(#wlBody 패널, #tab-acct, #pfBody 패널)은 그대로 옮겨 두고 CSS 로 숨긴다 — 공유 코드가 계속 쓴다.
   앱 화면은 아래 렌더러가 공유 상태(S, QUOTES, HIST)를 읽어 따로 그린다.
     관심종목: 그룹 칩 · 요약 줄 · 정렬(등록순/등락률/이름) · 2단 행(이름·코드 / 스파크라인 / 현재가·등락) · 편집 모드(삭제, 그룹 이름변경·삭제)
               · 종목 추가 시트(setupSearch 재사용 → addWatch)
     계좌:     계좌 칩(전체 + 계좌별 + 추가) · 요약 카드 · 보유 카드 → 상세 시트(종목 보기·수정·삭제)
               · 추가/수정 폼 시트(acctAddItem 재사용 + 수량·평단·메모) · 계좌 관리 시트 · CSV/JSON 진입점
   변경은 공유 함수로: addWatch, PC 그룹 버튼(#wlTabs/#wlAddGrp/#wlRenGrp/#wlDelGrp), acctAddItem, acctAdd/acctRename/
   acctRemove/acctMove, PC 계좌 칩(#acTabs), openImport(#acImport), acctExport, #acFile.
   prompt/confirm 을 쓰는 공유 함수는 시트에서 받은 답을 mAsAsk() 로 건네 부른다.
   다시 그리기: renderWatchlist / renderAccounts 를 감싸 같은 때(refreshAll·상태 변경 후) 앱 화면도 그린다.
   ========================================================================= */
const MAS = {
  edit:false,          // 관심종목 편집 모드
  sort:"reg",          // 관심종목 정렬 (보기 전용 — 저장 순서는 그대로)
  all:false,           // 계좌: 전체(합산) 보기
  queued:false,
  addBox:null, form:null, kbOff:null
};
const MAS_KEY = { seg:"gongdo-m-assets-seg", sort:"gongdo-m-wl-sort", all:"gongdo-m-acct-all" };
function mAsGet(k, d){ try{ var v = localStorage.getItem(MAS_KEY[k]); return v === null ? d : v; }catch(e){ return d; } }
function mAsSet(k, v){ try{ localStorage.setItem(MAS_KEY[k], v); }catch(e){} }
MAS.sort = mAsGet("sort", "reg");
MAS.all = mAsGet("all", "0") === "1";

/* prompt/confirm 을 쓰는 공유 함수에 시트에서 받은 답을 건넨다 */
function mAsAsk(ans, fn){
  var p = window.prompt, c = window.confirm;
  window.prompt = function(){ return ans; };
  window.confirm = function(){ return !!ans; };
  try{ fn(); }finally{ window.prompt = p; window.confirm = c; }
}
/* 공유 렌더 직후 한 번만 다시 그린다 (같은 틱의 여러 호출을 묶음) */
function mAsQueue(){
  if(MAS.queued) return;
  MAS.queued = true;
  Promise.resolve().then(function(){ MAS.queued = false; mAsRender(); });
}
function mAsRender(){
  try{ mAsRenderWl(); }catch(e){ console.error("[m] assets wl", e); }
  try{ mAsRenderAc(); }catch(e){ console.error("[m] assets acct", e); }
}
function mAsNumTxt(v){ return fmt(v, v % 1 ? Math.min(4, String(v).split(".")[1].length) : 0); }
function mAsParse(s){
  s = String(s || "").replace(/[,\s]/g, "");
  if(!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}
var MAS_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
var MAS_CHEV = '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/* 시트 안 내용 바꾸기 (닫고 새로 열면 history.back 과 pushState 가 엇갈린다) */
function mAsSwap(sh, title, content){
  $(".msheet-tt", sh.el).textContent = title;
  sh.body.innerHTML = "";
  if(typeof content === "string") sh.body.innerHTML = content; else sh.body.appendChild(content);
  sh.body.scrollTop = 0;
}
/* 화상 키보드: 레이아웃 뷰포트가 줄지 않는 브라우저에서도 시트가 키보드 위에 오게 */
function mAsKeyboard(sh){
  var vv = window.visualViewport;
  if(!vv) return function(){};
  function fit(){
    var off = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    sh.el.style.bottom = off ? off + "px" : "";
    sh.el.style.maxHeight = off ? Math.round(vv.height * 0.94) + "px" : "";
  }
  vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit);
  sh.el.addEventListener("focusin", function(e){
    if(!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    setTimeout(function(){ try{ e.target.scrollIntoView({ block:"nearest" }); }catch(x){} }, 320);
  });
  return function(){ vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); };
}
function mAsFormSheet(opts){
  var off = null;
  var sh = mSheet({ id:opts.id, title:opts.title, content:opts.content, cls:"mas-sheet",
                    onClose:function(){ if(off) off(); if(opts.onClose) opts.onClose(); } });
  off = mAsKeyboard(sh);
  return sh;
}
/* 이름 입력 시트 (그룹·계좌 추가/이름변경) */
function mAsNameSheet(title, label, val, onSave){
  var box = document.createElement("div");
  box.className = "mas-form";
  box.innerHTML = '<div class="mas-fld"><label for="mAsName">' + esc(label) + '</label>' +
    '<input type="text" id="mAsName" maxlength="30" autocomplete="off" enterkeyhint="done"></div>' +
    '<div class="mas-err" role="alert"></div>' +
    '<div class="mas-acts"><button type="button" class="mas-btn" data-x>취소</button>' +
    '<button type="button" class="mas-btn pri" data-ok>저장</button></div>';
  var inp = $("input", box), err = $(".mas-err", box);
  inp.value = val || "";
  var sh = mAsFormSheet({ title:title, content:box });
  function ok(){
    var n = inp.value.trim();
    if(!n){ err.textContent = "이름을 입력하세요."; inp.focus(); return; }
    sh.close(); onSave(n);
  }
  $("[data-x]", box).onclick = sh.close;
  $("[data-ok]", box).onclick = ok;
  inp.onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); ok(); } };
  setTimeout(function(){ inp.focus(); inp.select(); }, 260);
  return sh;
}
/* 확인 단계 (같은 시트 안에서) */
function mAsConfirmHtml(msg, okLabel){
  return '<div class="mas-confirm"><p>' + msg + '</p><div class="mas-acts">' +
    '<button type="button" class="mas-btn" data-cx>취소</button>' +
    '<button type="button" class="mas-btn danger" data-cok>' + esc(okLabel) + '</button></div></div>';
}

/* =============================== 관심종목 =============================== */
function mAsWlItems(){
  var wl = WL().map(function(w, i){ return { w:w, i:i, q:QUOTES[keyOf(w.mk, w.code)] }; });
  if(MAS.sort === "pct"){
    wl.sort(function(a, b){
      var pa = a.q ? a.q.pct : -Infinity, pb = b.q ? b.q.pct : -Infinity;
      return pb - pa || a.i - b.i;
    });
  }else if(MAS.sort === "name"){
    wl.sort(function(a, b){ return String((a.q && a.q.name) || a.w.name).localeCompare(String((b.q && b.q.name) || b.w.name), "ko"); });
  }
  return wl;
}
function mAsRenderWl(){
  var box = $("#mAsWlV"); if(!box) return;
  var groups = S.wlGroups || [], wl = WL(), act = S.wlActive;
  var h = '<div class="m-chips mas-chips" role="tablist" aria-label="관심종목 그룹">' + groups.map(function(g, i){
    return '<button role="tab" data-g="' + i + '" aria-selected="' + (i === act) + '"' + (i === act ? ' class="act"' : "") + '>' +
      esc(g.name) + ' <span class="n">' + (g.items || []).length + '</span></button>';
  }).join("") + '<button class="mas-chip-add" data-gadd aria-label="그룹 추가">' + MAS_PLUS + '</button></div>';

  var up = 0, dn = 0, sum = 0, nq = 0;
  wl.forEach(function(w){
    var q = QUOTES[keyOf(w.mk, w.code)];
    if(!q) return;
    nq++; sum += q.pct || 0;
    if(q.pct > 0) up++; else if(q.pct < 0) dn++;
  });
  var avg = nq ? sum/nq : null;
  if(MAS.edit){
    h += '<div class="mas-tools edit"><button class="mas-tbtn" data-gren>그룹 이름변경</button>' +
      '<button class="mas-tbtn" data-gdel>그룹 삭제</button><button class="mas-tbtn pri" data-done>완료</button></div>';
  }else{
    h += '<div class="mas-sum m-num">' + wl.length + '종목' + (nq ? ' · <span class="up">상승 ' + up + '</span> · <span class="down">하락 ' + dn +
      '</span> · 평균 <span class="' + dirCls(avg) + '">' + fmtPct(avg) + '</span>' : "") + '</div>';
    h += '<div class="mas-tools"><div class="mas-sort" role="group" aria-label="정렬">' + (wl.length ?
      [["reg", "등록순"], ["pct", "등락률"], ["name", "이름"]].map(function(s){
        return '<button data-sort="' + s[0] + '" aria-pressed="' + (MAS.sort === s[0]) + '"' + (MAS.sort === s[0] ? ' class="act"' : "") + '>' + s[1] + '</button>';
      }).join("") : "") + '</div><button class="mas-tbtn" data-edit>편집</button></div>';
  }

  if(!wl.length){
    h += '<div class="m-card mas-empty"><div class="mas-empty-ic">' + MAS_PLUS + '</div>' +
      '<b>“' + esc(groups[act] ? groups[act].name : "") + '” 그룹에 종목이 없습니다</b>' +
      '<span>종목을 추가하면 현재가와 등락을 한눈에 볼 수 있어요.</span>' +
      '<button class="mas-btn pri" data-add>종목 추가</button></div>';
  }else{
    h += '<div class="m-list mas-wlist' + (MAS.edit ? " editing" : "") + '">' + mAsWlItems().map(function(o){
      var w = o.w, q = o.q, u = UNI_BY_KEY[keyOf(w.mk, w.code)];
      var name = (q && q.name) || w.name;
      var stale = (q && !q.ok) ? ' · <span class="mas-stale">갱신실패</span>' : "";
      var right;
      if(MAS.edit){
        right = '<button class="mas-del" data-del="' + esc(w.code) + '" aria-label="' + esc(name) + ' 삭제">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>';
      }else if(!q){
        right = '<div class="mas-wr"><div class="mas-px loading">불러오는 중</div></div>';
      }else{
        right = '<canvas class="mas-spk" width="112" height="52" aria-hidden="true"></canvas>' +
          '<div class="mas-wr"><div class="mas-px m-num">' + fmtPrice(q.price, w.mk) + '</div>' +
          '<div class="mas-chg m-num ' + dirCls(q.chg) + '">' + fmtSigned(q.chg) + '</div></div>' +
          '<span class="mas-pct m-num ' + (q.pct > 0 ? "u" : (q.pct < 0 ? "d" : "f")) + '">' + fmtPct(q.pct) + '</span>';
      }
      return '<div class="mas-wrow"' + (MAS.edit ? "" : ' role="button" tabindex="0"') + ' data-code="' + esc(w.code) + '">' +
        '<div class="mas-wl"><div class="mas-nm">' + esc(name) + '</div>' +
        '<div class="mas-sub m-num">' + esc(w.code) + ' · ' + (u ? u.market : "KR") + stale + '</div></div>' + right + '</div>';
    }).join("") + '</div>';
    if(!MAS.edit) h += '<button class="mas-addbtn" data-add>' + MAS_PLUS + '종목 추가</button>';
    else h += '<div class="mas-hint">삭제할 종목의 − 버튼을 누르세요. 그룹 순서·종목 순서는 PC 버전에서 바꿀 수 있습니다.</div>';
  }
  box.innerHTML = h;
  /* 스파크라인 (최근 30거래일) — PC drawSpark 재사용 */
  $$("canvas.mas-spk", box).forEach(function(cv){
    var code = cv.closest("[data-code]").dataset.code, q = QUOTES[keyOf("KR", code)];
    var bars = (HIST[code] || {}).bars;
    drawSpark(cv, bars ? bars.slice(-30).map(function(b){ return b.c; }) : null, q && q.pct);
  });
  mAsChipVis(box);
}
/* 선택 칩이 보이게 칩 줄만 가로로 민다 (scrollIntoView 는 화면 세로 스크롤까지 움직인다) */
function mAsChipVis(box){
  var row = $(".m-chips", box), ch = row && $(".act", row);
  if(!ch || !box.offsetParent) return;
  var l = ch.offsetLeft - row.offsetLeft, r = l + ch.offsetWidth;
  if(l < row.scrollLeft) row.scrollLeft = Math.max(0, l - 12);
  else if(r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 12;
}
function mAsWlClick(e){
  var t = e.target, b;
  if((b = t.closest("[data-g]"))){
    var g = +b.dataset.g;
    if(g !== S.wlActive){ var pb = $('#wlTabs button[data-g="' + g + '"]'); if(pb) pb.click(); }
    return;
  }
  if(t.closest("[data-gadd]")){
    mAsNameSheet("관심종목 그룹 추가", "그룹 이름", "그룹 " + ((S.wlGroups || []).length + 1), function(n){
      mAsAsk(n, function(){ $("#wlAddGrp").onclick(); });
      loadSparklines();
    });
    return;
  }
  if(t.closest("[data-gren]")){
    var gg = S.wlGroups[S.wlActive];
    mAsNameSheet("그룹 이름 변경", "그룹 이름", gg.name, function(n){ mAsAsk(n, function(){ $("#wlRenGrp").onclick(); }); });
    return;
  }
  if(t.closest("[data-gdel]")){
    if(S.wlGroups.length <= 1){ toast("마지막 그룹은 삭제할 수 없습니다.", "err"); return; }
    var dg = S.wlGroups[S.wlActive];
    var sh = mSheet({ title:"그룹 삭제", cls:"mas-sheet", content:mAsConfirmHtml("“" + esc(dg.name) + "” 그룹과 그 안의 " +
      (dg.items || []).length + "종목을 삭제할까요?<br><small>되돌릴 수 없습니다.</small>", "그룹 삭제") });
    $("[data-cx]", sh.body).onclick = sh.close;
    $("[data-cok]", sh.body).onclick = function(){
      sh.close();
      mAsAsk(true, function(){ $("#wlDelGrp").onclick(); });
      loadSparklines();
    };
    return;
  }
  if(t.closest("[data-edit]")){ MAS.edit = true; mAsRenderWl(); return; }
  if(t.closest("[data-done]")){ MAS.edit = false; mAsRenderWl(); return; }
  if((b = t.closest("[data-sort]"))){ MAS.sort = b.dataset.sort; mAsSet("sort", MAS.sort); mAsRenderWl(); return; }
  if(t.closest("[data-add]")){ mAsOpenAdd(); return; }
  if((b = t.closest("[data-del]"))){
    var code = b.dataset.del, l = WL();
    for(var i=0;i<l.length;i++){
      if(l[i].code === code){
        var nm = l[i].name;
        l.splice(i, 1); save(); renderWatchlist();          // PC 삭제 버튼과 같은 처리
        toast(nm + " 삭제됨");
        break;
      }
    }
    return;
  }
  if(!MAS.edit && (b = t.closest(".mas-wrow[data-code]"))){
    var w = WL().filter(function(x){ return x.code === b.dataset.code; })[0];
    if(w) mOpenStock({ code:w.code, mk:w.mk || "KR", name:w.name });
  }
}

/* 종목 추가 시트 — PC setupSearch 재사용, 고르면 addWatch(지금 그룹) */
function mAsOpenAdd(){
  if(!MAS.addBox){
    MAS.addBox = document.createElement("div");
    MAS.addBox.innerHTML = '<div class="mas-to"></div>' +
      '<div class="srch m-srch" id="mAsAddSrch"><input type="text" placeholder="종목명 · 코드 (예: 삼성전자, 005930)" ' +
      'autocomplete="off" enterkeyhint="search" aria-label="추가할 종목 검색"><div class="sug"></div></div>' +
      '<div class="mas-quick"></div>';
    MAS.addBox.addEventListener("click", function(e){
      var b = e.target.closest("[data-qa]"); if(!b || b.disabled) return;
      mAsAddPick({ mk:"KR", code:b.dataset.qa, name:b.dataset.nm });
    });
  }
  var g = S.wlGroups[S.wlActive];
  $(".mas-to", MAS.addBox).innerHTML = '추가할 그룹 <b>' + esc(g.name) + '</b>';
  var have = {};
  WL().forEach(function(w){ have[w.code] = 1; });
  var rc = mRecent(), seen = {}, list = [];
  rc.forEach(function(x){ if(!seen[x.code]){ seen[x.code] = 1; list.push({ code:x.code, name:x.name, tag:"최근" }); } });
  topCaps(12).forEach(function(u){ if(!seen[u.code] && list.length < 12){ seen[u.code] = 1; list.push({ code:u.code, name:u.name, tag:u.market }); } });
  $(".mas-quick", MAS.addBox).innerHTML = '<div class="m-h">' + (rc.length ? "최근 본 종목 · 시가총액 상위" : "시가총액 상위") + '</div>' +
    '<div class="m-list">' + list.map(function(x){
      var on = !!have[x.code];
      return '<button class="m-row mas-qrow" data-qa="' + esc(x.code) + '" data-nm="' + esc(x.name) + '"' + (on ? " disabled" : "") + '>' +
        '<span class="m-row-t">' + esc(x.name) + '<span class="m-row-s m-num">' + esc(x.code) + ' · ' + esc(x.tag) + '</span></span>' +
        '<span class="mas-qadd' + (on ? " on" : "") + '">' + (on ? "추가됨" : MAS_PLUS) + '</span></button>';
    }).join("") + '</div>';
  $("input", MAS.addBox).value = "";
  $(".sug", MAS.addBox).classList.remove("open");
  MAS.addSheet = mAsFormSheet({ id:"wladd", title:"관심종목 추가", content:MAS.addBox });
  if(!MAS.addBox.mWired){ setupSearch("#mAsAddSrch", mAsAddPick); MAS.addBox.mWired = true; }
}
function mAsAddPick(it){
  if(addWatch(it) && MAS.addSheet){ MAS.addSheet.close(); loadSparklines(); }
}

/* ================================= 계좌 ================================= */
function mAsHoldRows(){
  /* [{it, acc, merged}] — 전체 보기는 mergedHoldings(읽기 전용 합산) */
  if(MAS.all) return mergedHoldings().map(function(m){ return { it:m, merged:true }; });
  var acc = curAcct();
  return acc.items.map(function(it){ return { it:it, acc:acc }; });
}
function mAsCalc(it){
  var q = QUOTES[keyOf(it.mk, it.code)];
  var qty = Number(it.qty) || 0, avg = Number(it.avg) || 0;
  var buy = it.buy !== undefined ? it.buy : qty*avg;
  var cur = (q && q.price > 0) ? q.price : null;
  var val = cur !== null ? qty*cur : null;
  var pl = val !== null ? val - buy : null;
  return { q:q, qty:qty, avg:avg, buy:buy, cur:cur, val:val, pl:pl, pct:(buy > 0 && pl !== null) ? pl/buy*100 : null };
}
function mAsRenderAc(){
  var box = $("#mAsAcV"); if(!box) return;
  var list = ACCTS(), cur = curAcct();
  if(list.length < 2 && MAS.all){ MAS.all = false; mAsSet("all", "0"); }
  var h = '<div class="m-chips mas-chips" role="tablist" aria-label="계좌">';
  if(list.length > 1){
    var nAll = mergedHoldings().length;
    h += '<button role="tab" data-acall aria-selected="' + MAS.all + '"' + (MAS.all ? ' class="act"' : "") + '>전체 <span class="n">' + nAll + '</span></button>';
  }
  h += list.map(function(a){
    var on = !MAS.all && a.id === cur.id;
    return '<button role="tab" data-a="' + esc(a.id) + '" aria-selected="' + on + '"' + (on ? ' class="act"' : "") + '>' +
      esc(a.name) + ' <span class="n">' + a.items.length + '</span></button>';
  }).join("") + '<button class="mas-chip-add" data-acadd aria-label="계좌 추가">' + MAS_PLUS + '</button></div>';

  var items = [];
  if(MAS.all) list.forEach(function(a){ items = items.concat(a.items); });
  else items = cur.items;
  var st = acctStats(items), rows = mAsHoldRows();
  h += '<div class="m-card mas-sumcard">' +
    '<div class="mas-sk">' + (MAS.all ? "전체 계좌 · " + list.length + "개" : esc(cur.name)) + ' 평가금액</div>' +
    '<div class="mas-sv m-num">' + fmt(Math.round(st.val)) + '<small>원</small></div>' +
    '<div class="mas-spl m-num ' + (st.n ? dirCls(st.pl) : "flat") + '">' +
      (st.n ? fmtSigned(Math.round(st.pl)) + '원 (' + fmtPct(st.pct) + ')' : "보유 종목 없음") + '</div>' +
    '<div class="mas-sgrid">' +
      '<div><span>매입금액</span><b class="m-num">' + fmt(Math.round(st.buy)) + '</b></div>' +
      '<div><span>평가손익</span><b class="m-num ' + (st.n ? dirCls(st.pl) : "") + '">' + (st.n ? fmtSigned(Math.round(st.pl)) : "-") + '</b></div>' +
      '<div><span>종목 수</span><b class="m-num">' + rows.length + '</b></div></div>' +
    (st.n && st.priced < st.n ? '<div class="mas-snote">시세를 아직 못 받은 ' + (st.n - st.priced) + '종목은 매입금액으로 계산했습니다.</div>' : "") +
    '</div>';

  h += '<div class="mas-hrow"><span class="m-h">' + (MAS.all ? "전 계좌 합산 보유" : "보유 종목") + ' ' + rows.length + '</span>' +
    (MAS.all ? "" : '<button class="mas-tbtn" data-acman>계좌 관리</button>') + '</div>';
  if(!rows.length){
    h += '<div class="m-card mas-empty"><div class="mas-empty-ic">' + MAS_PLUS + '</div>' +
      '<b>' + (MAS.all ? "보유 종목이 없습니다" : "“" + esc(cur.name) + "”에 보유 종목이 없습니다") + '</b>' +
      '<span>종목·수량·평균단가를 기록하면 평가금액과 손익을 계산해 드려요.<br>증권사 잔고 CSV를 가져올 수도 있습니다.</span>' +
      '<button class="mas-btn pri" data-hadd>보유 종목 추가</button></div>';
  }else{
    h += '<div class="m-list mas-hlist">' + rows.map(function(r, i){
      var it = r.it, c = mAsCalc(it);
      var sub = mAsNumTxt(c.qty) + '주 · 평단 ' + fmt(Math.round(c.avg));
      var extra = r.merged ? esc(it.accts.join(", ")) : (it.memo ? esc(it.memo) : "");
      return '<button class="mas-hrow-i" data-h="' + i + '">' +
        '<span class="mas-hl"><span class="mas-nm">' + esc(it.name) + '</span>' +
        '<span class="mas-sub m-num">' + sub + '</span>' +
        (extra ? '<span class="mas-memo">' + extra + '</span>' : "") + '</span>' +
        '<span class="mas-hr"><span class="mas-px m-num">' + (c.val !== null ? fmt(Math.round(c.val)) : '<i>시세 대기</i>') + '</span>' +
        '<span class="mas-chg m-num ' + dirCls(c.pl) + '">' + (c.pl !== null ? fmtSigned(Math.round(c.pl)) + ' (' + fmtPct(c.pct) + ')' : "-") + '</span></span>' +
        MAS_CHEV + '</button>';
    }).join("") + '</div>';
    h += '<button class="mas-addbtn" data-hadd>' + MAS_PLUS + '보유 종목 추가</button>';
  }
  h += '<div class="mas-tools-ft"><div class="m-h">가져오기 · 백업</div><div class="mas-links">' +
    '<button data-csv>증권사 CSV 가져오기</button><button data-jexp>계좌 백업(JSON)</button><button data-jimp>계좌 복원(JSON)</button></div>' +
    '<p>보유 기록은 이 기기의 브라우저에만 저장됩니다. 기기를 바꾸거나 데이터를 지우기 전에 백업하세요.</p></div>';
  box.innerHTML = h;
  MAS.rows = rows;
  mAsChipVis(box);
}
function mAsAcClick(e){
  var t = e.target, b;
  if(t.closest("[data-acall]")){ MAS.all = true; mAsSet("all", "1"); mAsRenderAc(); return; }
  if((b = t.closest("[data-a]"))){
    var id = b.dataset.a;
    MAS.all = false; mAsSet("all", "0");
    var pb = $('#acTabs button[data-a="' + id + '"]');
    if(pb && id !== S.acctSel) pb.click(); else mAsRenderAc();
    return;
  }
  if(t.closest("[data-acadd]")){
    mAsNameSheet("계좌 추가", "계좌 이름", "계좌 " + (ACCTS().length + 1), function(n){
      MAS.all = false; mAsSet("all", "0");
      mAsAsk(n, acctAdd);
    });
    return;
  }
  if(t.closest("[data-acman]")){ mAsAcctSheet(); return; }
  if(t.closest("[data-hadd]")){ mAsHoldForm(null); return; }
  if((b = t.closest("[data-h]"))){ var r = (MAS.rows || [])[+b.dataset.h]; if(r) mAsHoldSheet(r); return; }
  if(t.closest("[data-csv]")){ $("#acImport").click(); return; }
  if(t.closest("[data-jexp]")){ acctExport(); return; }
  if(t.closest("[data-jimp]")){ $("#acFile").click(); return; }
}

/* 계좌 관리 시트: 이름변경 · 순서 · 삭제 (공유 acctRename/acctMove/acctRemove) */
function mAsAcctSheet(){
  var a = curAcct(), l = ACCTS(), i = l.indexOf(a);
  var box = document.createElement("div");
  box.className = "mas-form";
  box.innerHTML = '<div class="mas-fld"><label for="mAsAcName">계좌 이름</label>' +
    '<input type="text" id="mAsAcName" maxlength="30" autocomplete="off" enterkeyhint="done"></div>' +
    '<div class="mas-err" role="alert"></div>' +
    '<div class="mas-acts"><button type="button" class="mas-btn pri" data-ren>이름 저장</button></div>' +
    '<div class="m-h">순서 (' + (i + 1) + ' / ' + l.length + ')</div>' +
    '<div class="mas-acts"><button type="button" class="mas-btn" data-mv="-1"' + (i <= 0 ? " disabled" : "") + '>앞으로</button>' +
    '<button type="button" class="mas-btn" data-mv="1"' + (i >= l.length - 1 ? " disabled" : "") + '>뒤로</button></div>' +
    '<div class="m-h">삭제</div>' +
    '<div class="mas-acts"><button type="button" class="mas-btn danger" data-rm' + (l.length <= 1 ? " disabled" : "") + '>계좌 삭제</button></div>' +
    (l.length <= 1 ? '<div class="mas-hint">마지막 계좌는 삭제할 수 없습니다.</div>' : "");
  var inp = $("input", box); inp.value = a.name;
  var sh = mAsFormSheet({ title:"계좌 관리", content:box });
  $("[data-ren]", box).onclick = function(){
    var n = inp.value.trim();
    if(!n){ $(".mas-err", box).textContent = "이름을 입력하세요."; inp.focus(); return; }
    sh.close(); mAsAsk(n, acctRename); toast("계좌 이름을 바꿨습니다.", "ok");
  };
  $$("[data-mv]", box).forEach(function(b){ b.onclick = function(){ sh.close(); acctMove(+b.dataset.mv); }; });
  $("[data-rm]", box).onclick = function(){
    mAsSwap(sh, "계좌 삭제", mAsConfirmHtml("“" + esc(a.name) + "” 계좌와 그 안의 " + a.items.length +
      "종목 기록을 삭제할까요?<br><small>되돌릴 수 없습니다. 먼저 백업해 두는 것을 권합니다.</small>", "계좌 삭제"));
    $("[data-cx]", sh.body).onclick = sh.close;
    $("[data-cok]", sh.body).onclick = function(){ sh.close(); mAsAsk(true, acctRemove); toast("계좌를 삭제했습니다."); };
  };
}

/* 보유 상세 시트 */
function mAsHoldSheet(r){
  var it = r.it, c = mAsCalc(it);
  var dl = function(k, v, cls){ return '<div><dt>' + k + '</dt><dd class="m-num ' + (cls || "") + '">' + v + '</dd></div>'; };
  var h = '<div class="mas-dhead"><div><b>' + esc(it.name) + '</b><span class="m-num">' + esc(it.code) + '</span></div>' +
    (c.cur !== null ? '<div class="mas-dpx m-num"><b>' + fmtPrice(c.cur, it.mk) + '</b><span class="' + dirCls(c.q.pct) + '">' +
      fmtSigned(c.q.chg) + ' (' + fmtPct(c.q.pct) + ')</span></div>' : "") + '</div>' +
    '<dl class="mas-dl">' +
    dl("보유수량", mAsNumTxt(c.qty) + "주") + dl("평균단가", fmt(Math.round(c.avg)) + "원") +
    dl("매입금액", fmt(Math.round(c.buy)) + "원") + dl("평가금액", c.val !== null ? fmt(Math.round(c.val)) + "원" : "시세 대기") +
    dl("평가손익", c.pl !== null ? fmtSigned(Math.round(c.pl)) + "원" : "-", dirCls(c.pl)) + dl("수익률", fmtPct(c.pct), dirCls(c.pct)) +
    (r.merged ? dl("계좌", esc(it.accts.join(", "))) : "") +
    (!r.merged && it.memo ? '<div class="wide"><dt>메모</dt><dd>' + esc(it.memo) + '</dd></div>' : "") + '</dl>' +
    '<div class="mas-acts"><button type="button" class="mas-btn" data-view>종목 보기</button>';
  if(r.merged){
    h += '</div><div class="m-h">계좌별 수정</div><div class="mas-acts col">' + it.acctIds.map(function(id, k){
      return '<button type="button" class="mas-btn" data-edacc="' + esc(id) + '">' + esc(it.accts[k]) + '에서 수정</button>';
    }).join("") + '</div>';
  }else{
    h += '<button type="button" class="mas-btn" data-ed>수정</button><button type="button" class="mas-btn danger" data-rmh>삭제</button></div>';
  }
  var sh = mAsFormSheet({ title:"보유 종목", content:h });
  sh.body.onclick = function(e){
    var t = e.target, b;
    if(t.closest("[data-view]")){ mOpenStock({ code:it.code, mk:it.mk || "KR", name:it.name }); return; }
    if(t.closest("[data-ed]")){ mAsHoldForm({ acc:r.acc, it:it }, sh); return; }
    if((b = t.closest("[data-edacc]"))){
      var acc = ACCTS().filter(function(a){ return a.id === b.dataset.edacc; })[0];
      var k = keyOf(it.mk, it.code);
      var own = acc && acc.items.filter(function(x){ return keyOf(x.mk, x.code) === k; })[0];
      if(own) mAsHoldForm({ acc:acc, it:own }, sh);
      return;
    }
    if(t.closest("[data-rmh]")){
      mAsSwap(sh, "보유 종목 삭제", mAsConfirmHtml("“" + esc(r.acc.name) + "”에서 " + esc(it.name) + " 기록을 삭제할까요?", "삭제"));
      return;
    }
    if(t.closest("[data-cx]")){ sh.close(); return; }
    if(t.closest("[data-cok]")){
      var i = r.acc.items.indexOf(it);
      sh.close();
      if(i >= 0){
        r.acc.items.splice(i, 1); save(); renderAccounts(); renderPortfolio();   // PC 삭제 버튼과 같은 처리
        toast(it.name + " 기록을 삭제했습니다.");
      }
    }
  };
}

/* 보유 추가/수정 폼 — ed = null(추가) | {acc, it}(수정). sh 를 주면 그 시트 안에서 바꾼다 */
function mAsHoldForm(ed, sh){
  if(!MAS.form){
    var f = MAS.form = document.createElement("div");
    f.className = "mas-form";
    f.innerHTML =
      '<div class="mas-fld mas-facct"><label for="mAsHAcct">계좌</label><select id="mAsHAcct"></select></div>' +
      '<div class="mas-fld"><label for="mAsHSrchIn">종목</label>' +
        '<div class="mas-picked"><span class="mas-pk"></span><button type="button" class="mas-tbtn" data-repick>변경</button></div>' +
        '<div class="srch m-srch" id="mAsHSrch"><input type="text" id="mAsHSrchIn" placeholder="종목명 · 코드 검색" autocomplete="off" enterkeyhint="search"><div class="sug"></div></div>' +
        '<div class="mas-err" data-e="stock" role="alert"></div></div>' +
      '<div class="mas-two">' +
        '<div class="mas-fld"><label for="mAsHQty">수량</label><div class="mas-unit"><input type="text" id="mAsHQty" inputmode="decimal" autocomplete="off" placeholder="0" enterkeyhint="next"><span>주</span></div>' +
          '<div class="mas-err" data-e="qty" role="alert"></div></div>' +
        '<div class="mas-fld"><label for="mAsHAvg">평균단가</label><div class="mas-unit"><input type="text" id="mAsHAvg" inputmode="decimal" autocomplete="off" placeholder="0" enterkeyhint="next"><span>원</span></div>' +
          '<div class="mas-err" data-e="avg" role="alert"></div></div>' +
      '</div>' +
      '<div class="mas-calc m-num"></div>' +
      '<div class="mas-fld"><label for="mAsHMemo">메모 <small>(선택)</small></label><input type="text" id="mAsHMemo" maxlength="60" autocomplete="off" enterkeyhint="done"></div>' +
      '<div class="mas-acts"><button type="button" class="mas-btn" data-fx>취소</button><button type="button" class="mas-btn pri" data-fok>저장</button></div>';
    $("[data-repick]", f).onclick = function(){ MAS.fPick = null; mAsFormSync(); setTimeout(function(){ $("#mAsHSrchIn").focus(); }, 30); };
    ["#mAsHQty", "#mAsHAvg"].forEach(function(s){ $(s, f).addEventListener("input", function(){ mAsFormErr(); mAsFormCalc(); }); });
    $("#mAsHAcct", f).onchange = function(){ mAsFormErr(); };
    $("#mAsHQty", f).onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); $("#mAsHAvg").focus(); } };
    $("#mAsHAvg", f).onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); $("#mAsHMemo").focus(); } };
    $("#mAsHMemo", f).onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); mAsFormSave(); } };
    $("[data-fok]", f).onclick = mAsFormSave;
  }
  var f = MAS.form;
  MAS.fEd = ed;
  MAS.fPick = ed ? { mk:ed.it.mk || "KR", code:ed.it.code, name:ed.it.name } : null;
  var l = ACCTS(), sel = curAcct().id;
  $("#mAsHAcct", f).innerHTML = l.map(function(a){
    return '<option value="' + esc(a.id) + '"' + (a.id === sel ? " selected" : "") + '>' + esc(a.name) + ' (' + a.items.length + '종목)</option>';
  }).join("");
  $(".mas-facct", f).classList.toggle("m-off", !!ed || l.length < 2);
  $("#mAsHQty", f).value = ed ? String(Number(ed.it.qty) || 0) : "";
  $("#mAsHAvg", f).value = ed ? String(Math.round((Number(ed.it.avg) || 0) * 100) / 100) : "";
  if(ed && !(Number(ed.it.qty) > 0)) $("#mAsHQty", f).value = "";
  if(ed && !(Number(ed.it.avg) > 0)) $("#mAsHAvg", f).value = "";
  $("#mAsHMemo", f).value = ed ? (ed.it.memo || "") : "";
  $("#mAsHSrchIn", f).value = "";
  $(".sug", f).classList.remove("open");
  mAsFormErr(); mAsFormSync();
  var title = ed ? "보유 종목 수정 · " + ed.acc.name : "보유 종목 추가";
  if(sh){
    sh.body.onclick = null;                          // 상세 시트의 클릭 처리 해제
    mAsSwap(sh, title, f);
  }else{
    sh = mAsFormSheet({ id:"hold", title:title, content:f });
  }
  MAS.fSheet = sh;
  $("[data-fx]", f).onclick = sh.close;
  if(!f.mWired){
    setupSearch("#mAsHSrch", function(it){ MAS.fPick = it; mAsFormErr(); mAsFormSync(); setTimeout(function(){ $("#mAsHQty").focus(); }, 30); });
    f.mWired = true;
  }
  if(!ed) setTimeout(function(){ $("#mAsHSrchIn").focus(); }, 280);
}
function mAsFormSync(){
  var f = MAS.form, p = MAS.fPick;
  $(".mas-picked", f).classList.toggle("m-off", !p);
  $("#mAsHSrch", f).classList.toggle("m-off", !!p);
  $("[data-repick]", f).classList.toggle("m-off", !!MAS.fEd);
  if(p){
    var u = UNI_BY_KEY[keyOf(p.mk, p.code)];
    $(".mas-pk", f).innerHTML = '<b>' + esc(p.name) + '</b> <span class="m-num">' + esc(p.code) + (u ? " · " + u.market : "") + '</span>';
  }
  mAsFormCalc();
}
function mAsFormCalc(){
  var f = MAS.form, qty = mAsParse($("#mAsHQty", f).value), avg = mAsParse($("#mAsHAvg", f).value);
  var p = MAS.fPick, q = p ? QUOTES[keyOf(p.mk, p.code)] : null, t = "";
  if(qty !== null && avg !== null){
    t = "매입금액 <b>" + fmt(Math.round(qty*avg)) + "원</b>";
    if(q && q.price > 0){
      var val = qty*q.price, pl = val - qty*avg;
      t += " · 현재가 기준 평가 " + fmt(Math.round(val)) + '원 <span class="' + dirCls(pl) + '">' + fmtSigned(Math.round(pl)) + "</span>";
    }
  }else if(q && q.price > 0) t = "현재가 " + fmtPrice(q.price, p.mk) + "원";
  $(".mas-calc", f).innerHTML = t;
}
function mAsFormErr(errs){
  errs = errs || {};
  $$(".mas-err[data-e]", MAS.form).forEach(function(el){
    var m = errs[el.dataset.e] || "";
    el.textContent = m;
    var fld = el.closest(".mas-fld");
    if(fld) fld.classList.toggle("bad", !!m);
  });
}
function mAsFormSave(){
  var f = MAS.form, ed = MAS.fEd, p = MAS.fPick, errs = {}, first = null;
  var qs = $("#mAsHQty", f).value, as = $("#mAsHAvg", f).value;
  var qty = mAsParse(qs), avg = mAsParse(as), memo = $("#mAsHMemo", f).value.trim();
  var acc = ed ? ed.acc : ACCTS().filter(function(a){ return a.id === $("#mAsHAcct", f).value; })[0] || curAcct();
  if(!p) errs.stock = "종목을 검색해 선택하세요.";
  else if(!ed){
    var k = keyOf(p.mk, p.code);
    if(acc.items.some(function(x){ return keyOf(x.mk, x.code) === k; }))
      errs.stock = "이미 “" + acc.name + "”에 있는 종목입니다. 목록에서 눌러 수정하세요.";
  }
  if(!qs.trim()) errs.qty = "수량을 입력하세요.";
  else if(qty === null || !(qty > 0)) errs.qty = "0보다 큰 숫자로 입력하세요.";
  if(!as.trim()) errs.avg = "평균단가를 입력하세요.";
  else if(avg === null) errs.avg = "숫자로 입력하세요.";
  mAsFormErr(errs);
  if(errs.stock) first = p ? null : "#mAsHSrchIn";
  if(!first && errs.qty) first = "#mAsHQty";
  if(!first && errs.avg) first = "#mAsHAvg";
  if(errs.stock || errs.qty || errs.avg){ if(first) $(first, f).focus(); return; }
  var sh = MAS.fSheet;
  if(ed){
    ed.it.qty = qty; ed.it.avg = avg; ed.it.memo = memo;
    save(); renderAccounts(); renderPortfolio();
    toast(ed.it.name + " 수정됨", "ok");
  }else{
    S.acctSel = acc.id;
    acctAddItem(p);                                  // 공유: 항목 추가 + 저장 + 렌더 + 시세 갱신
    var key = keyOf(p.mk, p.code);
    var it = curAcct().items.filter(function(x){ return keyOf(x.mk, x.code) === key; })[0];
    if(it){ it.qty = qty; it.avg = avg; it.memo = memo; save(); renderAccounts(); renderPortfolio(); }
  }
  if(sh) sh.close();
}

/* =============================== 화면 등록 =============================== */
mScreen("assets", {
  title: "내 자산",
  mount: function(root){
    this.seg = mSegBar([["wl", "관심종목"], ["acct", "계좌"]], function(v){
      mGo("assets", { seg:v }, { replace:true });
    });
    root.appendChild(this.seg);
    var wl = document.createElement("div"); wl.className = "m-pane"; wl.id = "mAsWl";
    var ac = document.createElement("div"); ac.className = "m-pane"; ac.id = "mAsAcct";
    var wlp = mPanelOf("#wlBody"), pfp = mPanelOf("#pfBody");
    if(wlp) wl.appendChild(wlp);
    ac.appendChild($("#tab-acct"));
    if(pfp) ac.appendChild(pfp);
    var wv = document.createElement("div"); wv.id = "mAsWlV"; wv.className = "mas-view";
    var av = document.createElement("div"); av.id = "mAsAcV"; av.className = "mas-view";
    wl.appendChild(wv); ac.appendChild(av);
    wv.addEventListener("click", mAsWlClick);
    av.addEventListener("click", mAsAcClick);
    wv.addEventListener("keydown", function(e){
      if((e.key === "Enter" || e.key === " ") && e.target.classList.contains("mas-wrow")){ e.preventDefault(); e.target.click(); }
    });
    root.appendChild(wl); root.appendChild(ac);
    mPullToRefresh(root);
    /* PC 렌더 직후 앱 화면도 다시 그린다 (기존 감싸기 사슬은 그대로 이어진다) */
    var rw = renderWatchlist, ra = renderAccounts;
    renderWatchlist = function(){ var v = rw.apply(this, arguments); mAsQueue(); return v; };
    renderAccounts = function(){ var v = ra.apply(this, arguments); mAsQueue(); return v; };
  },
  show: function(p){
    var seg = p.seg === "acct" || p.seg === "wl" ? p.seg : mAsGet("seg", "wl");
    if(seg !== "acct") seg = "wl";
    mAsSet("seg", seg);
    this.seg.mSet(seg);
    $("#mAsWl").classList.toggle("m-off", seg !== "wl");
    $("#mAsAcct").classList.toggle("m-off", seg !== "acct");
    if(seg === "acct"){ mDesk("acct"); mAsRenderAc(); }
    else{
      mDesk("wl");
      renderWatchlist(); loadSparklines();
    }
  },
  hide: function(){ if(MAS.edit){ MAS.edit = false; mAsQueue(); } },
  refresh: function(){ mAsQueue(); return Promise.resolve(); },
  reselect: function(){
    if(MAS.edit){ MAS.edit = false; mAsRenderWl(); return true; }
    return false;
  }
});
