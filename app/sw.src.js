/* 공도 투자 연구소 — 서비스 워커
   원본: app/sw.src.js  →  python app/build.py 가 빌드 ID·폰트 주소를 찍어 루트 sw.js 로 만든다.
   (루트 sw.js 를 직접 고치지 말 것)

   캐시 규칙
   - 내비게이션 / index.html      : stale-while-revalidate (캐시 즉시 표시, 뒤에서 갱신)
   - 같은 출처 + ?v= 쿼리          : cache-first, 같은 경로의 이전 버전은 지운다 (fonts.css, 버전 붙은 data 파일)
   - data/meta.json · data/*.json : network-first, 실패 시 캐시 (오프라인이면 마지막 데이터로 열린다)
   - 그 밖의 같은 출처 정적 파일    : stale-while-revalidate (manifest·아이콘)
   - 다른 출처(네이버 JSONP·rss2json·TradingView 등)는 가로채지 않는다
   빌드 ID 가 바뀌면 캐시 이름이 바뀌고, activate 에서 이전 캐시를 모두 지운다.
   앱 버전(m/sw.js)도 이 파일로 만든다: 캐시 접두어·프리캐시 목록·루트 자원 경로(ASSET_BASE)만 다르다. */
"use strict";
const BUILD_ID = "__BUILD_ID__";
const CACHE = "__CACHE_PREFIX__" + BUILD_ID;
const CACHE_PREFIX = "__CACHE_PREFIX__";
const PRECACHE = __PRECACHE__;
/* data/ 가 있는 저장소 루트 — 워커 범위 기준 상대 경로 (PC "./", 앱 "../") */
const ASSET_BASE = "__ASSET_BASE__";

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    // 한 파일이 실패해도 설치는 계속한다 (addAll 은 하나만 실패해도 전부 실패)
    return Promise.all(PRECACHE.map(function(u){
      return c.add(new Request(u, { cache:"reload" })).catch(function(){});
    }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){
      if(k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE) return caches.delete(k);
    }));
  }).then(function(){ return self.clients.claim(); }));
});

/* 캐시 키: 쿼리·해시를 뗀 경로. 디렉터리 요청("/report-radar/")은 index.html 과 같은 키로 본다 */
function pageKey(url){
  var u = new URL(url);
  u.search = ""; u.hash = "";
  if(/\/$/.test(u.pathname)) u.pathname += "index.html";
  return u.href;
}
function scopeIndex(){ return new URL("./index.html", self.registration.scope).href; }

function staleWhileRevalidate(e, key){
  return caches.open(CACHE).then(function(c){
    return c.match(key).then(function(hit){
      var net = fetch(e.request).then(function(res){
        if(res && res.ok && !res.redirected) c.put(key, res.clone());
        return res;
      });
      if(hit){
        e.waitUntil(net.catch(function(){}));
        return hit;
      }
      return net;
    });
  });
}

function networkFirst(e, key){
  return caches.open(CACHE).then(function(c){
    return fetch(e.request).then(function(res){
      if(res && res.ok) c.put(key, res.clone());
      return res;
    }).catch(function(err){
      return c.match(key).then(function(hit){ if(hit) return hit; throw err; });
    });
  });
}

function cacheFirstVersioned(e){
  var req = e.request, url = new URL(req.url);
  return caches.open(CACHE).then(function(c){
    return c.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          // 같은 경로의 다른 ?v= 항목을 지운 뒤 저장
          e.waitUntil(c.keys().then(function(keys){
            return Promise.all(keys.map(function(k){
              var ku = new URL(k.url);
              if(ku.origin === url.origin && ku.pathname === url.pathname && ku.search !== url.search)
                return c.delete(k);
            }));
          }).then(function(){ return c.put(req, copy); }));
        }
        return res;
      });
    });
  });
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;           // 다른 출처는 손대지 않는다
  if(url.pathname.slice(-6) === "/sw.js") return;

  if(req.mode === "navigate"){
    // 같은 앱 페이지는 하나의 키(index.html)로 — "/report-radar/" 와 "/report-radar/index.html"
    var key = pageKey(req.url);
    if(key === scopeIndex() || key === pageKey(self.registration.scope)) key = scopeIndex();
    e.respondWith(staleWhileRevalidate(e, key));
    return;
  }
  if(url.searchParams.has("v")){
    e.respondWith(cacheFirstVersioned(e));
    return;
  }
  var scopePath = new URL(self.registration.scope).pathname;
  var rel = url.pathname.indexOf(scopePath) === 0 ? url.pathname.slice(scopePath.length) : url.pathname;
  var basePath = new URL(ASSET_BASE, self.registration.scope).pathname;
  var drel = url.pathname.indexOf(basePath) === 0 ? url.pathname.slice(basePath.length) : url.pathname;
  if(/^data\/[^/]+\.json$/.test(drel)){
    e.respondWith(networkFirst(e, pageKey(req.url)));
    return;
  }
  if(rel === "index.html" || rel === ""){
    e.respondWith(staleWhileRevalidate(e, scopeIndex()));
    return;
  }
  e.respondWith(staleWhileRevalidate(e, pageKey(req.url)));
});
