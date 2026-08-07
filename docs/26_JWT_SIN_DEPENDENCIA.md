# 3. `jose` vs. Web Crypto nativo — análisis antes de elegir (NO implementado)

## El problema real con `jose`, específico de cómo se despliega hoy este proyecto

`worker-supremekv1/worker.js` se despliega **pegando el código directamente en el editor del dashboard de Cloudflare** ("Edit code" → Deploy) — no hay `wrangler deploy`, no hay `npm install`, no hay empaquetado. Un `import { jwtVerify } from 'jose'` en ese archivo **no funcionaría así** — el editor del dashboard ejecuta exactamente el texto que se pega, no resuelve paquetes de `node_modules` ni corre un bundler (`esbuild`, que es lo que hace `wrangler deploy` automáticamente detrás de escena). El archivo sí usa formato de módulos (`export default { async fetch(...) }`), lo cual es necesario para `import` — pero no es suficiente sin el paso de empaquetado.

## Respuesta punto por punto

- **Dónde se instalaría la dependencia:** en un `worker-supremekv1/package.json` que hoy no existe.
- **Qué `package.json` se crearía:** uno nuevo, con `"dependencies": { "jose": "^5.x" }`.
- **Cómo se empaquetaría:** `wrangler deploy` correría `esbuild` automáticamente y produciría un solo archivo con `jose` incluido — pero eso requiere empezar a desplegar este Worker con `wrangler`, no pegando código a mano.
- **¿Usa formato module?** Sí, ya lo usa — eso no es el obstáculo.
- **Cómo afectaría a GitHub Actions:** hoy el workflow (`.github/workflows/deploy.yml`) **solo despliega el frontend** (`bold-mouse-3bc3`) al hacer push a `main` — nunca toca `supremekv1`. Para que `jose` funcione de forma automática, habría que agregar `supremekv1` a ese pipeline (o crear uno nuevo) — un cambio de infraestructura aparte, no trivial, y no incluido en lo que se está pidiendo ahora.
- **Cómo se desplegaría manualmente vs. automáticamente:** manualmente, alguien tendría que correr `wrangler deploy` localmente (que empaqueta `jose` y sube el resultado) — ya no bastaría con copiar y pegar en el dashboard. Automáticamente, solo si se agrega el CI mencionado arriba.
- **Qué pasa si el bundle falla:** con `wrangler-action` en GitHub Actions, un fallo de empaquetado **detiene el despliegue** — no sube nada roto, el Worker sigue con la versión anterior funcionando. Es un fallo seguro, pero significa que el parche de seguridad no se aplicaría hasta resolver el problema del build.

## Alternativa sin dependencia — Web Crypto nativo (recomendada)

Existe, y evita todo lo anterior: verificar la firma RS256 del JWT a mano usando `crypto.subtle`, disponible de forma nativa en el runtime de Workers, sin ningún `import`. Sigue funcionando exactamente con el flujo actual de "pegar en el dashboard y desplegar" — cero archivos nuevos, cero build, cero cambio a GitHub Actions.

```js
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(base64url.length + (4 - base64url.length % 4) % 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64urlToJson(base64url) {
  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(base64url)));
}

let _jwksCache = null, _jwksCacheAt = 0;
async function getAccessJWKS(teamDomain) {
  if (_jwksCache && (Date.now() - _jwksCacheAt) < 3600000) return _jwksCache; // cache 1h
  const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  _jwksCache = await resp.json();
  _jwksCacheAt = Date.now();
  return _jwksCache;
}

async function verifyAccessJWT(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const header = base64urlToJson(headerB64);
  const payload = base64urlToJson(payloadB64);

  if (!payload.exp || Date.now() / 1000 >= payload.exp) return null;          // expiracion
  if (payload.iss !== `https://${teamDomain}`) return null;                    // issuer
  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audClaim.includes(aud)) return null;                                     // audience

  const jwks = await getAccessJWKS(teamDomain);
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) return null;                                                       // firma

  return payload; // incluye payload.email, ya verificado criptograficamente
}
```

Cubre las 4 verificaciones que pediste (firma, issuer, audience, expiración), en ~40 líneas, sin ningún paquete nuevo. **Esta es la que se usa en el diff final (`docs/29`).** `jose` queda documentado como una mejora futura razonable, atada a montar CI para `supremekv1` — no necesaria para este parche.
