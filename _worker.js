export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Strip cache-busting query params before fetching asset
    const cleanUrl = new URL(request.url);
    cleanUrl.search = '';
    const assetRequest = new Request(cleanUrl.toString(), request);
    const response = await env.ASSETS.fetch(assetRequest);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Pragma', 'no-cache');
      newHeaders.set('Expires', '0');
      newHeaders.delete('ETag');
      newHeaders.delete('Last-Modified');
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }
    return response;
  }
};
