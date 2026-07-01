export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Pragma', 'no-cache');
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }
    return response;
  }
};
