/* =========================================================================
   포트폴리오 잔고 가져오기 — 파서 (순수 함수. DOM·전역 상태에 의존하지 않음)
   증권사별 내보내기 형식이 제각각이라 헤더·구분자·컬럼을 모두 추정한다.
   tools/test_parsers.mjs 가 이 파일을 그대로 읽어 검증하므로 로직 중복이 없다.
   ========================================================================= */

/* 합계·소계 행은 보유종목이 아니므로 반드시 제외 */
const IMP_SKIP_RE = /^(합\s*계|총\s*계|소\s*계|계|총합\s*계|누\s*계|평\s*가|total|sum|subtotal)$/i;

const IMP_HEAD = {
  code:["종목번호","종목코드","단축코드","표준코드","종목_코드","코드","티커","symbol","code","ticker"],
  name:["종목명","종목명칭","상품명","종목","name","stock"],
  qty: ["보유수량","잔고수량","주식수","보유주식수","체결수량","수량","qty","quantity","shares"],
  avg: ["매입평균가","평균단가","매입단가","평단가","매입가","장부가","취득단가","avgprice","avg","price"]
};

/* "1,234" "₩1,234" "(1,234)" -> 숫자 / 숫자가 아니면 null */
function impNum(s){
  if(s === null || s === undefined) return null;
  var raw = String(s).trim();
  if(!raw) return null;
  var neg = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  var t = raw.replace(/[(),"'₩$\s%+]/g, "").replace(/^-/, "");
  if(!/^\d+(\.\d+)?$/.test(t)) return null;
  var v = parseFloat(t);
  return neg ? -v : v;
}
/* "A005930" / "005930" 모두 종목코드로 인식. 앞자리 0 을 보존한다. */
function impIsCode(s){
  if(s === null || s === undefined) return false;
  return /^[Aa]?\d{6}$/.test(String(s).trim());
}
function impCode(s){ return String(s).trim().replace(/^[Aa]/, ""); }
function impKey(s){ return String(s || "").replace(/[\s_()\-]/g, "").toLowerCase(); }

/* CSV 따옴표를 존중하는 행 분해 */
function impSplitLine(line, d){
  if(d !== ","){
    return line.split(d).map(function(s){ return s.trim().replace(/^"(.*)"$/, "$1").trim(); });
  }
  var out = [], cur = "", q = false;
  for(var i=0;i<line.length;i++){
    var ch = line[i];
    if(ch === '"'){
      if(q && line[i+1] === '"'){ cur += '"'; i++; } else q = !q;
    }else if(ch === d && !q){ out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(function(s){ return s.trim(); });
}

/* 탭/쉼표/세미콜론/파이프 중 열 수가 가장 일관된 구분자 선택 */
function impDetectDelim(text){
  var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); }).slice(0, 40);
  var best = null;
  ["\t", ",", ";", "|"].forEach(function(d){
    var counts = lines.map(function(l){ return impSplitLine(l, d).length; })
                      .filter(function(n){ return n > 1; });
    if(counts.length < 1) return;
    var freq = {};
    counts.forEach(function(n){ freq[n] = (freq[n] || 0) + 1; });
    var top = Object.keys(freq).sort(function(a, b){ return freq[b] - freq[a]; })[0];
    var score = freq[top] * Math.min(+top, 8);      // 일관된 행 수 × 열 수(과대 가중 방지)
    if(!best || score > best.score) best = { d:d, score:score, cols:+top };
  });
  return best || { d:",", score:0, cols:1 };
}

/* 헤더 행 -> {code,name,qty,avg} 열 인덱스. 정확 일치 우선, 그다음 부분 일치. */
function impMapHeader(cells){
  var map = {}, used = {};
  var norm = cells.map(impKey);
  var keys = ["code", "name", "qty", "avg"];
  keys.forEach(function(k){
    IMP_HEAD[k].some(function(h){
      var i = norm.indexOf(impKey(h));
      if(i >= 0 && !used[i] && map[k] === undefined){ map[k] = i; used[i] = 1; return true; }
      return false;
    });
  });
  keys.forEach(function(k){
    if(map[k] !== undefined) return;
    for(var i=0;i<norm.length;i++){
      if(used[i] || !norm[i]) continue;
      var hit = IMP_HEAD[k].some(function(h){
        var hh = impKey(h);
        return hh.length > 1 && norm[i].indexOf(hh) >= 0;
      });
      if(hit){ map[k] = i; used[i] = 1; break; }
    }
  });
  return map;
}

/* 헤더가 없을 때 열 내용으로 추정 */
function impInferCols(rows, lookup){
  var n = 0;
  rows.forEach(function(r){ if(r.length > n) n = r.length; });
  var stat = [];
  for(var c=0;c<n;c++){
    var vals = [];
    rows.forEach(function(r){
      var v = r[c];
      if(v !== null && v !== undefined && String(v).trim()) vals.push(String(v).trim());
    });
    if(!vals.length){ stat.push(null); continue; }
    var codes = 0, nums = 0, ints = 0, names = 0, frac = 0, sum = 0;
    vals.forEach(function(v){
      if(impIsCode(v)) codes++;
      if(lookup && lookup(v)) names++;
      var x = impNum(v);
      if(x !== null){
        nums++; sum += x;
        if(Math.floor(x) === x) ints++; else frac++;
      }
    });
    stat.push({ c:c, codes:codes/vals.length, names:names/vals.length, nums:nums/vals.length,
                intRatio:nums ? ints/nums : 0, frac:frac, mean:nums ? sum/nums : 0 });
  }
  var live = stat.filter(Boolean), map = {};
  var byCode = live.filter(function(s){ return s.codes >= 0.6; })
                   .sort(function(a, b){ return b.codes - a.codes; })[0];
  if(byCode) map.code = byCode.c;
  var byName = live.filter(function(s){ return s.c !== map.code && s.names >= 0.5; })
                   .sort(function(a, b){ return b.names - a.names; })[0];
  if(byName) map.name = byName.c;
  var numCols = live.filter(function(s){
    return s.c !== map.code && s.c !== map.name && s.nums >= 0.8;
  });
  if(numCols.length === 1) map.qty = numCols[0].c;
  else if(numCols.length >= 2){
    var withFrac = numCols.filter(function(s){ return s.frac > 0; });
    var avgCol = (withFrac.length === 1) ? withFrac[0]
               : numCols.slice().sort(function(a, b){ return b.mean - a.mean; })[0];
    var qtyCol = numCols.filter(function(s){ return s !== avgCol; })
                        .sort(function(a, b){ return (b.intRatio - a.intRatio) || (a.mean - b.mean); })[0];
    map.avg = avgCol.c;
    if(qtyCol) map.qty = qtyCol.c;
  }
  return map;
}

/**
 * 잔고 텍스트 파싱.
 * @param text   원문(CSV/TSV/붙여넣기)
 * @param lookup (종목명) -> {code, mk} | null  — 내장 유니버스 역매핑
 * @param force  {code,name,qty,avg} 열 인덱스 수동 지정(사용자 교정). null 허용 = 무시
 */
function parseHoldings(text, lookup, force){
  var res = { rows:[], skipped:[], headerIdx:-1, header:null, map:{}, delim:"", cols:0 };
  if(!text || !String(text).trim()) return res;

  var det = impDetectDelim(text);
  res.delim = det.d;
  var all = text.split(/\r?\n/).map(function(l){ return impSplitLine(l, det.d); })
                .filter(function(r){ return r.some(function(c){ return String(c || "").trim(); }); });
  if(!all.length) return res;
  res.cols = Math.max.apply(null, all.map(function(r){ return r.length; }));

  /* 헤더 탐지: 앞 12행 중 헤더 키워드가 2개 이상 잡히는 행 */
  var best = 1;
  for(var i=0;i<Math.min(all.length, 12);i++){
    var m = impMapHeader(all[i]);
    var sc = Object.keys(m).length;
    if(sc > best){ best = sc; res.headerIdx = i; res.header = all[i]; res.map = m; }
  }
  var body = res.headerIdx >= 0 ? all.slice(res.headerIdx + 1) : all;
  if(res.headerIdx < 0) res.map = impInferCols(body, lookup);

  if(force){
    ["code","name","qty","avg"].forEach(function(k){
      if(force[k] === null) delete res.map[k];
      else if(force[k] !== undefined) res.map[k] = force[k];
    });
  }
  var map = res.map;

  body.forEach(function(r){
    var cell = function(k){
      return map[k] === undefined ? "" : String(r[map[k]] === undefined ? "" : r[map[k]]).trim();
    };
    var nameRaw = cell("name"), codeRaw = cell("code");
    /* 합계·소계 행 제외 (어느 칸에 있든) */
    var isSum = r.some(function(c){ return IMP_SKIP_RE.test(String(c || "").trim()); });
    if(isSum){ res.skipped.push({ raw:r, reason:"합계행" }); return; }

    var qty = impNum(cell("qty"));
    var avg = impNum(cell("avg"));
    var code = "", mk = "KR", matched = false;

    /* 국내 전용: 6자리 코드 또는 내장 유니버스 이름만 매칭한다.
       알파벳 티커 행은 미매칭으로 남겨 사용자가 코드를 직접 넣거나 제외하게 한다. */
    if(codeRaw && impIsCode(codeRaw)){ code = impCode(codeRaw); matched = true; }
    if(!code && nameRaw){
      var hit = lookup && lookup(nameRaw);
      if(hit){ code = hit.code; matched = true; }
      else if(impIsCode(nameRaw)){ code = impCode(nameRaw); matched = true; }
    }
    /* 종목 식별 정보도 수량도 없으면 데이터 행이 아님 */
    if(!nameRaw && !code && qty === null){ res.skipped.push({ raw:r, reason:"빈행" }); return; }
    if(qty === null && avg === null && !code){ res.skipped.push({ raw:r, reason:"수치없음" }); return; }

    res.rows.push({
      raw:r, code:code, name:nameRaw || code, mk:mk,
      qty:qty === null ? 0 : qty, avg:avg === null ? 0 : avg, matched:matched
    });
  });
  return res;
}

/* 파일 바이트 -> 문자열. UTF-8 로 읽어 대체문자(U+FFFD) 비율이 높으면 EUC-KR 로 재해석. */
function decodeHoldingsBytes(buf){
  var u8 = new Uint8Array(buf);
  var utf8 = new TextDecoder("utf-8").decode(u8);
  var bad = (utf8.match(/�/g) || []).length;
  if(bad === 0 || !utf8.length) return { text:utf8, encoding:"utf-8", bad:0 };
  var ratio = bad / utf8.length;
  if(ratio > 0.005){
    try{
      var euc = new TextDecoder("euc-kr").decode(u8);
      var bad2 = (euc.match(/�/g) || []).length;
      if(bad2 < bad) return { text:euc, encoding:"euc-kr", bad:bad2 };
    }catch(e){ /* 브라우저가 euc-kr 을 지원하지 않으면 utf-8 유지 */ }
  }
  return { text:utf8, encoding:"utf-8", bad:bad };
}
