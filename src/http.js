export function requestId(request) {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

export function json(body, status, requestId, origin, extraHeaders) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId });
  if (origin) headers.set('access-control-allow-origin', origin);
  if (extraHeaders) for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

export function error(code, message, status, requestId, origin) {
  return json({ error: { code, message, requestId } }, status, requestId, origin);
}
