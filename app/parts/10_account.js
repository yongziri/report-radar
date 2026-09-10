/* =========================================================================
   계좌 — 계좌별 보유 기록 (localStorage 전용, 백업은 JSON 내보내기/가져오기)
   시세는 별도 타이머 없이 refreshAll() 이 채워 둔 QUOTES 를 그대로 읽는다.
   ========================================================================= */

/* 보유 목록 집계. 시세를 못 받은 종목은 매입금액으로 대체해 합계를 왜곡시키지 않는다. */
function acctStats(items){
  var buy = 0, val = 0, priced = 0;
  (items || []).forEach(function(it){
    var qty = Number(it.qty) || 0, avg = Number(it.avg) || 0;
    var q = QUOTES[keyOf(it.mk, it.code)];
    buy += qty*avg;
    if(q && q.price > 0){ val += qty*q.price; priced++; }
    else val += qty*avg;
  });
  var pl = val - buy;
  return { buy:buy, val:val, pl:pl, pct:(buy > 0 ? pl/buy*100 : null),
           n:(items || []).length, priced:priced };
}
function acctSumHtml(st){
  return [["매입금액", fmt(Math.round(st.buy)), ""],
          ["평가금액", fmt(Math.round(st.val)), ""],
          ["평가손익", (st.n ? fmtSigned(Math.round(st.pl)) : "-"), dirCls(st.pl)],
          ["수익률",   fmtPct(st.pct), dirCls(st.pct)]].map(function(r){
    return '<div class="ovi"><div class="k">' + r[0] + '</div>' +
           '<div class="v ' + r[2] + '">' + r[1] + '</div></div>';
  }).join("");
}

function renderAccounts(){
  var list = ACCTS(), cur = curAcct();
  $("#acTabs").innerHTML = list.map(function(a){
    return '<button data-a="' + esc(a.id) + '"' + (a.id === cur.id ? ' class="act"' : "") + '>' +
           esc(a.name) + ' <span class="n">' + a.items.length + '</span></button>';
  }).join("");

  var all = [];
  list.forEach(function(a){ all = all.concat(a.items); });
  $("#acTot").innerHTML = acctSumHtml(acctStats(all));
  $("#acTotSub").textContent = list.length + "개 계좌 · " + mergedHoldings().length + "종목";
  $("#acSum").innerHTML = acctSumHtml(acctStats(cur.items));
  $("#acName").textContent = cur.name;
  renderAcctRows(cur);
}

function acctNum(val, onChange, w){
  var el = document.createElement("input");
  el.type = "number"; el.className = "cell"; el.step = "any"; el.min = "0";
  el.value = (val === null || val === undefined || val === "" ? "" : val);
  if(w) el.style.width = w;
  el.onchange = function(){ onChange(el.value === "" ? 0 : Number(el.value)); };
  return el;
}
function acctBtn(label, on, dis){
  var b = document.createElement("button");
  b.className = "btn xs"; b.textContent = label; b.disabled = !!dis;
  b.onclick = on;
  return b;
}

function renderAcctRows(acc){
  var tb = $("#acBody"); tb.innerHTML = "";
  var items = acc.items;
  $("#acEmpty").style.display = items.length ? "none" : "block";
  items.forEach(function(it, i){
    var q = QUOTES[keyOf(it.mk, it.code)];
    var qty = Number(it.qty) || 0, avg = Number(it.avg) || 0;
    var buy = Math.round(qty*avg);
    var cur = (q && q.price > 0) ? q.price : null;
    var val = cur !== null ? qty*cur : null;
    var pl = val !== null ? val - buy : null;
    var pct = (buy > 0 && pl !== null) ? pl/buy*100 : null;
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="l"><span class="tk acnm" data-hv="' + esc(it.code) + '">' + esc(it.name) + '</span></td>' +
      '<td class="c" style="color:var(--tx3)">' + esc(it.code) + '</td>' +
      '<td></td><td></td>' +
      '<td class="num ' + (q ? dirCls(q.pct) : "") + '">' + (cur !== null ? fmtPrice(cur, it.mk) : "-") + '</td>' +
      '<td></td>' +
      '<td class="num ' + dirCls(pl) + '">' + (pl !== null ? fmtSigned(Math.round(pl)) : "-") + '</td>' +
      '<td class="num ' + dirCls(pct) + '">' + fmtPct(pct) + '</td>' +
      '<td class="num">' + (val !== null ? fmt(Math.round(val)) : "-") + '</td>' +
      '<td class="l"></td><td class="c mv"></td><td class="c"></td>';
    var td = tr.children;
    /* 보유수량 */
    td[2].appendChild(acctNum(it.qty, function(v){
      it.qty = v; save(); renderAccounts();
    }));
    /* 매입금액 — 입력하면 평균단가를 역산한다 (저장은 qty·avg 기준) */
    td[3].appendChild(acctNum(buy || "", function(v){
      if(qty > 0){ it.avg = v/qty; save(); renderAccounts(); }
      else { toast("보유수량을 먼저 입력하세요.", "err"); renderAccounts(); }
    }, "96px"));
    /* 평균단가 — 매입금액은 avg×qty 로 다시 계산된다 */
    td[5].appendChild(acctNum(it.avg, function(v){
      it.avg = v; save(); renderAccounts();
    }));
    /* 메모 (자유 텍스트. 입력 중 표가 다시 그려지지 않도록 저장만 한다) */
    var m = document.createElement("input");
    m.type = "text"; m.className = "cell memo"; m.placeholder = "메모";
    m.value = it.memo || "";
    m.onchange = function(){ it.memo = m.value; save(); };
    td[9].appendChild(m);
    /* 순서 이동 */
    td[10].appendChild(acctBtn("▲", function(){
      items.splice(i-1, 0, items.splice(i, 1)[0]); save(); renderAccounts();
    }, i === 0));
    td[10].appendChild(acctBtn("▼", function(){
      items.splice(i+1, 0, items.splice(i, 1)[0]); save(); renderAccounts();
    }, i === items.length - 1));
    /* 삭제 */
    td[11].appendChild(acctBtn("×", function(){
      items.splice(i, 1); save(); renderAccounts(); renderPortfolio();
    }));
    tr.querySelector(".acnm").onclick = function(){
      selectStock({ mk:it.mk || "KR", code:it.code, name:it.name });
      showTab("anal");
    };
    tb.appendChild(tr);
  });
}

/* 계좌 탭을 열면서 특정 계좌를 선택한다 (대시보드 패널 → 계좌) */
function openAcctTab(id){
  if(id) S.acctSel = id;
  save(); showTab("acct");
}

function acctAddItem(it){
  var acc = curAcct(), k = keyOf(it.mk, it.code);
  if(acc.items.some(function(x){ return keyOf(x.mk, x.code) === k; })){
    toast("이미 “" + acc.name + "”에 있습니다: " + it.name);
    return;
  }
  acc.items.push({ mk:it.mk, code:it.code, name:it.name, qty:0, avg:0, memo:"" });
  save(); renderAccounts(); renderPortfolio(); refreshAll();
  toast(acc.name + "에 " + it.name + " 추가됨", "ok");
}

/* ---------- 계좌 추가·이름변경·삭제·순서 ---------- */
function acctAdd(){
  var n = prompt("새 계좌 이름", "계좌 " + (ACCTS().length + 1));
  if(!n || !n.trim()) return;
  var a = { id:newAcctId(), name:n.trim(), items:[] };
  S.accounts.push(a); S.acctSel = a.id;
  save(); renderAccounts(); renderPortfolio();
  toast("계좌가 추가되었습니다: " + a.name, "ok");
}
function acctRename(){
  var a = curAcct(), n = prompt("계좌 이름 변경", a.name);
  if(!n || !n.trim()) return;
  a.name = n.trim(); save(); renderAccounts(); renderPortfolio();
}
function acctRemove(){
  if(ACCTS().length <= 1){ toast("마지막 계좌는 삭제할 수 없습니다.", "err"); return; }
  var a = curAcct();
  if(!confirm("“" + a.name + "” 계좌와 그 안의 " + a.items.length + "종목 기록을 삭제할까요?")) return;
  S.accounts = S.accounts.filter(function(x){ return x.id !== a.id; });
  S.acctSel = S.accounts[0].id;
  save(); renderAccounts(); renderPortfolio(); refreshAll();
}
function acctMove(dir){
  var l = ACCTS(), i = l.indexOf(curAcct()), j = i + dir;
  if(j < 0 || j >= l.length) return;
  l.splice(j, 0, l.splice(i, 1)[0]);
  save(); renderAccounts(); renderPortfolio();
}

/* ---------- 백업 / 복원 (계좌만) ---------- */
function acctExport(){
  var data = { type:"stock-helper-accounts", v:1, at:new Date().toISOString(), accounts:ACCTS() };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "accounts-" + todayStr() + ".json";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  toast("계좌 " + S.accounts.length + "개를 JSON으로 내보냈습니다.", "ok");
}
/* 계좌 배열 / {accounts:[...]} / 예전 {portfolio:[...]} 를 모두 받아들인다 */
function acctNormalize(raw){
  var list = null;
  if(Array.isArray(raw)) list = raw;
  else if(raw && Array.isArray(raw.accounts)) list = raw.accounts;
  else if(raw && Array.isArray(raw.portfolio)) list = [{ name:"가져온 계좌", items:raw.portfolio }];
  if(!list) return null;
  var seen = {};
  return list.map(function(a, i){
    var id = String((a && a.id) || "");
    if(!id || seen[id]) id = newAcctId();
    seen[id] = 1;
    return {
      id:id,
      name:String((a && a.name) || ("계좌 " + (i+1))).trim() || ("계좌 " + (i+1)),
      items:((a && a.items) || []).filter(function(x){ return x && x.code; }).map(function(x){
        return { mk:x.mk || "KR", code:String(x.code), name:String(x.name || x.code),
                 qty:Number(x.qty) || 0, avg:Number(x.avg) || 0, memo:String(x.memo || "") };
      })
    };
  });
}
function acctImportFile(file){
  var fr = new FileReader();
  fr.onload = function(){
    try{
      var list = acctNormalize(JSON.parse(fr.result));
      if(!list || !list.length) throw new Error("계좌 정보를 찾지 못했습니다");
      var n = list.reduce(function(s, a){ return s + a.items.length; }, 0);
      var replace = confirm("계좌 " + list.length + "개(" + n + "종목)를 읽었습니다.\n\n" +
        "[확인] 기존 계좌 " + ACCTS().length + "개를 모두 교체\n[취소] 기존 계좌 뒤에 추가");
      if(replace){ S.accounts = list; }
      else {
        var used = {};
        ACCTS().forEach(function(a){ used[a.id] = 1; });
        list.forEach(function(a){ if(used[a.id]) a.id = newAcctId(); S.accounts.push(a); });
      }
      S.acctSel = list[0].id;
      save(); renderAccounts(); renderPortfolio(); refreshAll();
      toast("계좌를 가져왔습니다 — 총 " + S.accounts.length + "개 계좌", "ok");
    }catch(e){ toast("가져오기 실패: " + e.message, "err"); }
  };
  fr.onerror = function(){ toast("파일을 읽지 못했습니다.", "err"); };
  fr.readAsText(file);
}

function initAccounts(){
  setupSearch("#srchAcct", acctAddItem);
  $("#acTabs").onclick = function(e){
    var b = e.target.closest("button[data-a]"); if(!b) return;
    S.acctSel = b.dataset.a; save(); renderAccounts();
  };
  $("#acAdd").onclick = acctAdd;
  $("#acRen").onclick = acctRename;
  $("#acDel").onclick = acctRemove;
  $("#acLeft").onclick = function(){ acctMove(-1); };
  $("#acRight").onclick = function(){ acctMove(1); };
  $("#acExp").onclick = acctExport;
  $("#acImpJson").onclick = function(){ $("#acFile").click(); };
  $("#acFile").onchange = function(){
    if(this.files[0]) acctImportFile(this.files[0]);
    this.value = "";
  };
  $("#pfOpenAcct").onclick = function(){ openAcctTab(); };
}
