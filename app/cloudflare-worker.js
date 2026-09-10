/**
 * 주식 대시보드용 CORS 프록시 (Cloudflare Worker)
 *
 * 목적: rss2json 의존을 없애고 구글뉴스 RSS · DART 공시를 직접 가져온다.
 *  - rss2json 무료 경로는 간헐 실패가 잦고, DART 최근공시도 10건만 돌려준다(원본은 50건).
 *  - 이 워커를 쓰면 원본 XML 을 그대로 받아 앱에서 파싱하므로 50건 전부 사용 가능.
 *
 * 사용법:  GET https://<워커주소>/?url=<encodeURIComponent(원본 URL)>
 * 배포 방법: tools/PROXY_SETUP.md 참고
 *
 * 보안: 아래 ALLOW 호스트만 허용하고 그 외에는 403. (공개 오픈 프록시가 되지 않도록)
 * 환경변수(선택): DART_KEY — opendart.fss.or.kr 요청에 crtfc_key 를 자동 첨부한다.
 *                 (앱 코드에 키를 넣지 않아도 되도록 워커에서만 주입)
 */

const ALLOW = [
  "news.google.com",
  "dart.fss.or.kr",
  "opendart.fss.or.kr"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

function deny(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status: status || 403,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return deny("GET 만 허용됩니다.", 405);

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return deny("url 파라미터가 필요합니다.", 400);

    let u;
    try {
      u = new URL(target);
    } catch {
      return deny("url 형식이 올바르지 않습니다.", 400);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:")
      return deny("http/https 만 허용됩니다.");

    // 호스트 화이트리스트 (정확히 일치하거나 서브도메인만 허용)
    const host = u.hostname.toLowerCase();
    const allowed = ALLOW.some((h) => host === h || host.endsWith("." + h));
    if (!allowed) return deny(`허용되지 않은 호스트: ${host}`);

    // DART 오픈API 키 자동 첨부 (앱에 키를 노출하지 않기 위함)
    if (host.endsWith("opendart.fss.or.kr") && env && env.DART_KEY && !u.searchParams.get("crtfc_key")) {
      u.searchParams.set("crtfc_key", env.DART_KEY);
    }

    let upstream;
    try {
      upstream = await fetch(u.toString(), {
        headers: {
          // 일부 소스가 기본 UA 를 거부하므로 브라우저 UA 를 사용
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept": "application/xml,text/xml,application/json,text/html;q=0.9,*/*;q=0.8"
        },
        cf: { cacheTtl: 300, cacheEverything: true }   // 5분 엣지 캐시로 원본 부하 완화
      });
    } catch (e) {
      return deny("원본 요청 실패: " + e.message, 502);
    }

    const headers = new Headers(CORS);
    const ct = upstream.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    headers.set("Cache-Control", "public, max-age=300");

    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
