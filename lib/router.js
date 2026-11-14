// /api/* 요청을 받아 각 API 묶음으로 넘깁니다.
import { ApiError, json } from './util.js';
import { getDb, ensureSchema } from './db.js';
import { register as registerPublic } from './api-public.js';
import { register as registerHost } from './api-host.js';
import { register as registerAdmin } from './api-admin.js';

class Router {
  constructor() {
    this.routes = [];
    for (const m of ['get', 'post', 'put', 'delete']) this[m] = (pattern, fn) => this.add(m.toUpperCase(), pattern, fn);
  }
  add(method, pattern, fn) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ method, re, keys, fn });
  }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { fn: r.fn, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

const router = new Router();
registerPublic(router);
registerHost(router);
registerAdmin(router);

const MAX_BODY = 2_400_000;

export async function handleApi({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  try {
    const hit = router.match(method, path);
    if (!hit) throw new ApiError(404, 'not_found', '없는 주소예요.');

    let body = {};
    if (method !== 'GET') {
      // 다른 사이트에서 보낸 요청은 받지 않습니다.
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new ApiError(403, 'bad_origin', '허용되지 않은 요청이에요.');
      if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new ApiError(413, 'too_large', '보내는 내용이 너무 커요.');
      const text = await request.text();
      if (text.length > MAX_BODY) throw new ApiError(413, 'too_large', '보내는 내용이 너무 커요.');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError(400, 'bad_json', '요청 형식이 올바르지 않아요.');
        }
      }
      if (!body || typeof body !== 'object') body = {};
    }

    // SITE_URL을 정하지 않았다면 지금 접속한 주소를 메일 속 링크에 씁니다.
    if (!env.SITE_URL) {
      try {
        env.SITE_URL = url.origin;
      } catch {
        /* 읽기 전용이면 그대로 둡니다 */
      }
    }
    await ensureSchema(env);
    const ctx = { request, env, url, query: url.searchParams, params: hit.params, body };
    Object.defineProperty(ctx, 'db', { get: () => getDb(env) }); // DB가 필요한 API에서만 연결을 확인합니다.

    const out = await hit.fn(ctx);
    if (out instanceof Response) return out;
    const headers = {};
    if (out && out._cookie) {
      headers['set-cookie'] = out._cookie;
      delete out._cookie;
    }
    return json(out ?? { ok: true }, 200, headers);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message, ...(e.extra || {}) } }, e.status);
    const msg = String((e && e.message) || e);
    if (/no such table/i.test(msg)) {
      return json({ error: { code: 'db_not_ready', message: 'DB 준비가 아직 끝나지 않았어요. /admin 에서 "DB 준비하기"를 눌러 주세요.' } }, 503);
    }
    console.log('API error', method, path, msg, e && e.stack);
    return json({ error: { code: 'server_error', message: '처리하다가 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' } }, 500);
  }
}
