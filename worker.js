import {
  authenticate,
  authorizeRoute,
  filterEditsForTechnician,
  loadTechNames,
} from "./worker-lib.js";

async function handleServicioSubmit(request, env, email) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // A technician can never set these -- the server decides them.
  delete body.number;
  delete body.order_number;
  delete body.total;
  delete body.totalLabor;
  delete body.status;

  body._creadoPor = email;
  body.status = "BORRADOR";
  body.total = 0;
  body.totalLabor = 0;

  const getReq = new Request(new URL("/edits", request.url).toString(), { method: "GET" });
  const getRes = await env.SUPREMEKV.fetch(getReq);
  if (!getRes.ok) {
    return new Response("Could not read current data", { status: 502 });
  }
  let current;
  try {
    current = await getRes.json();
  } catch (e) {
    return new Response("Unexpected data from backend", { status: 502 });
  }

  const newInvs = Array.isArray(current.newInvs) ? current.newInvs.slice() : [];
  newInvs.push(body);

  const postReq = new Request(new URL("/edits", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edits: current.edits || {},
      deleted: current.deleted || [],
      newInvs,
    }),
  });
  const postRes = await env.SUPREMEKV.fetch(postReq);
  if (!postRes.ok) {
    return new Response("Could not save submission", { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleEditsReadOwn(request, env, email) {
  const getReq = new Request(new URL("/edits", request.url).toString(), { method: "GET" });
  const getRes = await env.SUPREMEKV.fetch(getReq);
  if (!getRes.ok) return getRes;
  let data;
  try {
    data = await getRes.json();
  } catch (e) {
    return new Response("Unexpected data from backend", { status: 502 });
  }
  const techNames = loadTechNames(env);
  const filtered = filterEditsForTechnician(data, email, techNames);
  return new Response(JSON.stringify(filtered), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleVision(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response("Server misconfigured: missing ANTHROPIC_API_KEY", { status: 500 });
  }
  let body;
  try {
    body = await request.text();
  } catch (e) {
    return new Response("Invalid body", { status: 400 });
  }
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body,
  });
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

async function proxyToSupremekv(request, env, email, role) {
  const url = new URL(request.url);
  const innerUrl = new URL(request.url);
  innerUrl.pathname = url.pathname.replace(/^\/api/, "") || "/";
  const innerHeaders = new Headers();
  innerHeaders.set("Content-Type", request.headers.get("Content-Type") || "application/json");
  innerHeaders.set("X-Verified-Email", email);
  innerHeaders.set("X-Verified-Role", role);
  const innerRequest = new Request(innerUrl.toString(), {
    method: request.method,
    headers: innerHeaders,
    body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
  });
  return env.SUPREMEKV.fetch(innerRequest);
}

async function serveAsset(request, env) {
  const cleanUrl = new URL(request.url);
  cleanUrl.search = "";
  const assetRequest = new Request(cleanUrl.toString(), request);
  const response = await env.ASSETS.fetch(assetRequest);
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    newHeaders.set("Pragma", "no-cache");
    newHeaders.set("Expires", "0");
    newHeaders.delete("ETag");
    newHeaders.delete("Last-Modified");
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }
  return response;
}

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.ico") {
      return new Response("", { status: 204 });
    }

    const auth = await authenticate(request, env);
    if (!auth.ok) {
      return new Response(auth.message, { status: auth.status });
    }
    const { email, role } = auth;

    const decision = authorizeRoute(role, request.method, url.pathname);
    if (!decision.allow) {
      return new Response(decision.message, { status: decision.status });
    }

    switch (decision.kind) {
      case "asset":
        return serveAsset(request, env);
      case "vision":
        return handleVision(request, env);
      case "servicio_submit":
        return handleServicioSubmit(request, env, email);
      case "edits_read_own":
        return handleEditsReadOwn(request, env, email);
      case "edits_full":
      case "proxy_full":
        return proxyToSupremekv(request, env, email, role);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

export { worker_default as default };
