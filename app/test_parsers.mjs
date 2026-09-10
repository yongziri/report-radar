/* 공시 파서·분류기 + XML 파서 단위 검증
   실샘플: tools/samples/{dart.xml, gnews.xml, dart_r2j.json}
   사용: node tools/test_parsers.mjs
   앱(parts/03_core.js)에서 함수 본문을 그대로 옮겨와 동일 로직을 검증한다. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = (f) => fs.readFileSync(path.join(HERE, "samples", f), "utf8");

/* ---- 03_core.js 와 동일 로직 ---- */
const DC_TYPES = [
  { k:"stake", t:"지분변동", kw:["임원ㆍ주요주주특정증권등소유상황보고서","주식등의대량보유상황보고서",
      "최대주주등소유주식변동신고서","임원ㆍ주요주주특정증권등거래계획보고서","특정증권등소유상황"] },
  { k:"earn",  t:"실적",     kw:["사업보고서","분기보고서","반기보고서","영업(잠정)실적","잠정실적",
      "감사보고서","결산실적","매출액또는손익구조"] },
  { k:"major", t:"주요사항", kw:["주요사항보고서"] }
];
const normDc = (s) => String(s||"").replace(/[ㆍ·・·‧\s]/g, "");
function dcType(rpt){
  const n = normDc(rpt);
  for(const g of DC_TYPES) for(const k of g.kw) if(n.indexOf(normDc(k)) >= 0) return g.k;
  return "etc";
}
function parseDart(it){
  let t = (it.title || "").trim();
  let comp = (it.author || "").trim();
  let mkt = (it.categories && it.categories[0]) || "";
  const m0 = t.match(/^\(([^)]*)\)\s*(.*)$/);
  if(m0){ if(!mkt) mkt = m0[1]; t = m0[2]; }
  let rpt = t; const i = t.indexOf(" - ");
  if(i > 0){ if(!comp) comp = t.slice(0, i); rpt = t.slice(i+3); }
  else if(!comp){
    const m1 = t.match(/^\[([^\]]+)\]\s*(.+)$/);
    if(m1){ comp = m1[1]; rpt = m1[2]; }
  }
  return { comp, rpt, mkt, link:it.link, at:it.pubDate, type:dcType(rpt) };
}

/* XML -> items (프록시 모드에서 쓰는 파서와 동일) */
function parseRssXml(xml){
  const doc = xml;
  const items = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>/g;
  let m;
  const tag = (s, n) => {
    const r = new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + n + ">");
    const x = r.exec(s);
    return x ? decodeEnt(x[1].trim()) : "";
  };
  const decodeEnt = (s) => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,"&");
  while((m = re.exec(doc))){
    const s = m[1];
    const cats = [];
    const cre = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/g;
    let c; while((c = cre.exec(s))) cats.push(decodeEnt(c[1].trim()));
    items.push({
      title: tag(s,"title"), link: tag(s,"link"),
      pubDate: tag(s,"pubDate"),
      author: tag(s,"dc:creator") || tag(s,"author"),
      categories: cats
    });
  }
  return items;
}

/* ---- 실행 ---- */
let fail = 0;
const ok = (c, msg) => { if(!c){ fail++; console.log("  FAIL:", msg); } };

console.log("=== 1) XML 파서: DART 원본 (50건 기대) ===");
const dartItems = parseRssXml(S("dart.xml"));
console.log("  파싱된 item:", dartItems.length);
ok(dartItems.length === 50, "DART item 50건이어야 함");
const d0 = dartItems[0];
console.log("  [0] title  :", d0.title);
console.log("  [0] author :", d0.author);
console.log("  [0] cats   :", JSON.stringify(d0.categories));
console.log("  [0] link   :", d0.link);
ok(d0.author === "현대퓨처넷", "dc:creator 추출");
ok(d0.link.startsWith("https://dart.fss.or.kr/api/link.jsp?rcpNo="), "link 추출");

console.log("\n=== 2) parseDart + 분류 (원본 XML 50건) ===");
const parsed = dartItems.map(parseDart);
const counts = {};
for(const p of parsed) counts[p.type] = (counts[p.type]||0) + 1;
console.log("  유형 분포:", JSON.stringify(counts));
ok(parsed.every(p => p.comp && p.rpt), "모든 항목에 회사명·보고서명이 있어야 함");
ok(parsed.every(p => !/^\(/.test(p.comp)), "회사명에 (유가)/(코스닥) 접두어가 남으면 안 됨");
for(const p of parsed.slice(0,5))
  console.log(`   ${p.mkt.padEnd(4)} | ${p.comp.padEnd(12)} | ${p.type.padEnd(5)} | ${p.rpt.slice(0,44)}`);

console.log("\n  -- 유형별 샘플 --");
for(const t of ["stake","earn","major","etc"]){
  const s = parsed.filter(p => p.type === t).slice(0,3);
  console.log("  " + t + ":");
  for(const p of s) console.log("     " + p.comp + " / " + p.rpt.slice(0,50));
}

console.log("\n=== 3) 전각 중점·공백 변형 강건성 ===");
const variants = [
  ["임원ㆍ주요주주특정증권등소유상황보고서", "stake"],
  ["임원·주요주주특정증권등소유상황보고서", "stake"],
  ["임원 · 주요주주 특정증권등 소유상황보고서", "stake"],
  ["임원‧주요주주특정증권등소유상황보고서", "stake"],
  ["주식등의대량보유상황보고서(약식)", "stake"],
  ["연결재무제표기준영업(잠정)실적(공정공시)", "earn"],
  ["분기보고서 (2026.03)", "earn"],
  ["주요사항보고서(자기주식취득신탁계약체결결정)", "major"],
  ["단일판매ㆍ공급계약체결", "etc"]
];
for(const [name, want] of variants){
  const got = dcType(name);
  const mark = got === want ? "OK  " : "FAIL";
  if(got !== want) fail++;
  console.log(`  ${mark} ${got.padEnd(5)} (기대 ${want.padEnd(5)}) ${name}`);
}

console.log("\n=== 4) XML 파서: 구글뉴스 ===");
const gitems = parseRssXml(S("gnews.xml"));
console.log("  파싱된 item:", gitems.length);
ok(gitems.length > 50, "구글뉴스 item 다수");
console.log("  [0] title:", gitems[0].title.slice(0,70));
console.log("  [0] date :", gitems[0].pubDate);
console.log("  [0] link :", gitems[0].link.slice(0,60) + "...");
ok(gitems[0].title.length > 5 && gitems[0].link.startsWith("http"), "뉴스 title/link 추출");
ok(!/&(amp|lt|gt|quot);/.test(gitems[0].title), "엔티티 디코딩됨");

console.log("\n=== 5) rss2json 경로와 동일 결과인지 대조 ===");
const r2j = JSON.parse(S("dart_r2j.json"));
console.log("  rss2json items:", r2j.items.length, "(원본 XML:", dartItems.length + ")");
const a = parseDart(r2j.items[0]);
console.log("  rss2json[0] ->", a.comp, "/", a.type, "/", a.rpt.slice(0,40));
ok(a.comp && a.rpt, "rss2json 항목도 동일 파서로 처리됨");

/* =========================================================================
   6) 잔고 가져오기 파서 — parts/08_import.js 를 그대로 로드해 검증(로직 중복 없음)
   ========================================================================= */
console.log("\n=== 6) 잔고 가져오기 파서 ===");
const impSrc = fs.readFileSync(path.join(HERE, "parts", "08_import.js"), "utf8");
const IMP = new Function(impSrc + `
  return { parseHoldings, impDetectDelim, impMapHeader, impNum, impIsCode, impCode, IMP_SKIP_RE };
`)();

/* 내장 유니버스 역매핑을 흉내낸 lookup (우선주 구분 확인 포함) */
const UNI = [
  ["005930","삼성전자"],["005935","삼성전자우"],["000660","SK하이닉스"],["035420","NAVER"],
  ["051910","LG화학"],["035720","카카오"],["005380","현대차"],["068270","셀트리온"],
  ["373220","LG에너지솔루션"]
];
const exact = {}, norm = {};
for(const [code, name] of UNI){
  exact[name] = { code, mk:"KR" };
  norm[name.replace(/\s/g,"")] = { code, mk:"KR" };
}
const lookup = (n) => {
  if(!n) return null;
  const s = String(n).trim();
  return exact[s] || norm[s.replace(/\s/g,"")] || null;
};

function show(tag, r){
  console.log(`  [${tag}] 구분자=${JSON.stringify(r.delim)} 헤더행=${r.headerIdx} ` +
              `매핑=${JSON.stringify(r.map)} 인식=${r.rows.length} 제외=${r.skipped.length}`);
  for(const x of r.rows)
    console.log(`     ${(x.code||"?").padEnd(7)} ${String(x.name).padEnd(14)} ` +
                `수량 ${String(x.qty).padStart(5)}  평단 ${String(x.avg).padStart(9)}  ` +
                `${x.matched ? "매칭" : "미매칭"}`);
  if(r.skipped.length)
    console.log("     제외:", r.skipped.map(s => s.reason + "(" + s.raw.filter(Boolean).slice(0,2).join("/") + ")").join(", "));
}

// ① EUC-KR 쉼표 CSV (파일 바이트 → 디코딩 폴백 포함)
const b1 = fs.readFileSync(path.join(HERE, "samples", "holdings_euckr.csv"));
const asUtf8 = new TextDecoder("utf-8").decode(b1);
const badCount = (asUtf8.match(/�/g) || []).length;
const asEuc = new TextDecoder("euc-kr").decode(b1);
console.log(`  인코딩: utf-8 로 읽으면 대체문자 ${badCount}개 → euc-kr 재해석 시 ` +
            `${(asEuc.match(/�/g)||[]).length}개`);
ok(badCount > 0, "EUC-KR 파일은 UTF-8 로 읽으면 깨져야 함(폴백 트리거)");
ok(asEuc.indexOf("삼성전자") >= 0, "euc-kr 디코딩 성공");
const r1 = IMP.parseHoldings(asEuc, lookup);
show("① EUC-KR CSV", r1);
ok(r1.headerIdx === 2, "계좌정보 2행 뒤 헤더행(index 2) 탐지");
ok(r1.rows.length === 4, "4종목 인식");
ok(r1.rows[0].code === "005930", "A접두어 제거 + 앞자리 0 보존");
ok(r1.rows[0].qty === 150 && r1.rows[0].avg === 71200, "쉼표 숫자 파싱");
ok(r1.rows.every(x => x.matched), "전부 매칭");

// ② UTF-8 탭 붙여넣기 (코드 열 없음 → 이름 역매핑)
const t2 = fs.readFileSync(path.join(HERE, "samples", "holdings_tab.txt"), "utf8");
const r2 = IMP.parseHoldings(t2, lookup);
show("② 탭 붙여넣기", r2);
ok(r2.delim === "\t", "탭 구분자 감지");
ok(r2.rows.length === 4, "4종목 인식");
ok(r2.map.code === undefined, "코드 열 없음");
ok(r2.rows[0].code === "035720", "종목명 역매핑(카카오)");
ok(r2.rows[3].code === "005935", "우선주 정확 일치(삼성전자우 ≠ 삼성전자)");
ok(r2.rows[0].qty === 80 && r2.rows[0].avg === 52300, "수량/평단 파싱");

// ③ 지저분한 케이스
const t3 = fs.readFileSync(path.join(HERE, "samples", "holdings_messy.csv"), "utf8");
const r3 = IMP.parseHoldings(t3, lookup);
show("③ 지저분", r3);
ok(r3.rows.length === 3, "합계/총계/빈행 제외하고 3종목");
ok(!r3.rows.some(x => /합계|총계/.test(x.name)), "합계행이 종목으로 들어오면 안 됨");
ok(r3.rows[0].code === "005930" && r3.rows[0].name === "삼성전자", "이름 앞뒤 공백 제거");
ok(r3.rows[1].code === "005935", "우선주 코드 유지");
ok(r3.skipped.filter(s => s.reason === "합계행").length === 2, "합계행 2건 제외 기록");

// ④ 수동 컬럼 교정(force) 동작
const r4 = IMP.parseHoldings(t2, lookup, { qty:2, avg:1 });   // 수량↔평단 뒤바꿔 지정
console.log(`  [④ 수동교정] 첫 행 수량=${r4.rows[0].qty} 평단=${r4.rows[0].avg} (의도적으로 스왑)`);
ok(r4.rows[0].qty === 52300 && r4.rows[0].avg === 80, "force 매핑이 자동추정을 덮어씀");

// ⑤ 헤더 없는 입력 → 내용 기반 추정
const t5 = "005930\t삼성전자\t10\t70000\n000660\tSK하이닉스\t5\t245000";
const r5 = IMP.parseHoldings(t5, lookup);
console.log(`  [⑤ 헤더없음] 매핑=${JSON.stringify(r5.map)} 인식=${r5.rows.length}`);
ok(r5.headerIdx === -1, "헤더 없음으로 판정");
ok(r5.rows.length === 2 && r5.rows[0].code === "005930", "내용 기반 추정 성공");
ok(r5.rows[0].qty === 10 && r5.rows[0].avg === 70000, "수량/단가 구분(정수·평균크기)");

// ⑥ 숫자 정규화 개별 케이스
console.log("  [⑥ 숫자 정규화]");
const numCases = [['"1,234"',1234],["₩12,000",12000],["(500)",-500],["-3",-3],["1.5",1.5],
                  ["",null],["-",null],["N/A",null],["005930",5930]];
for(const [inp, want] of numCases){
  const got = IMP.impNum(inp);
  if(got !== want){ fail++; console.log(`     FAIL ${inp} -> ${got} (기대 ${want})`); }
}
console.log("     " + numCases.length + "케이스 확인");
ok(IMP.impIsCode("A005930") && IMP.impIsCode("005930") && !IMP.impIsCode("AAPL"), "코드 판별");
ok(IMP.impCode("A005930") === "005930", "A접두어 제거");

console.log("\n" + (fail ? `>>> 실패 ${fail}건` : ">>> 전체 통과"));
process.exit(fail ? 1 : 0);
