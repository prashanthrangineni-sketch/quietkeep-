// tests/mock-next-server.mjs
// Mock NextResponse for testing Next.js API routes without next package installed.

export class NextResponse extends Response {
  static json(data, init = {}) {
    const body = JSON.stringify(data);
    const headers = new Headers(init.headers || {});
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new NextResponse(body, {
      ...init,
      headers,
    });
  }

  static redirect(url, init = 307) {
    const status = typeof init === 'number' ? init : (init?.status || 307);
    const headers = new Headers(typeof init === 'object' ? init?.headers : {});
    headers.set('Location', typeof url === 'string' ? url : url.toString());
    return new NextResponse(null, { status, headers });
  }

  static rewrite(destination, init = {}) {
    return new NextResponse(null, init);
  }

  static next(init = {}) {
    return new NextResponse(null, init);
  }
}

export default {
  NextResponse,
};
