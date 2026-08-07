# Correcciones de seguridad v3 (diseño, NO aplicado)

Reemplaza el código de `docs/32`. Cambios: rechazo de correos desconocidos (fail closed), validación estricta del JWT antes de tocar la JWK, validación de metadatos de la JWK, eliminación completa de `wipeAll`, y confirmación de que los headers internos se construyen desde cero.

## 1. Correos desconocidos → rechazados, no técnico por defecto

Los 3 correos autorizados **no van en el código ni en el chat** — se guardan en una variable de entorno del Worker `bold-mouse-3bc3`, distinta en staging y producción:

```
# Variable de entorno "ACCESS_ROLES_JSON" (Type: Text, no hace falta Secret -- no es una
# credencial, es una lista de quien-es-quien; igual puedes marcarla Secret si prefieres)
# Valor (ejemplo de formato, tú pones los correos reales):
# {"correo1@dominio.com":"admin","correo2@dominio.com":"tecnico","correo3@dominio.com":"tecnico"}
```

Se configura una vez en el Worker de producción y otra vez, por separado, en el de staging — pueden tener valores distintos (por ejemplo, en staging solo tu correo mientras se prueba).

```js
function loadRoles(env) {
  try {
    const raw = JSON.parse(env.ACCESS_ROLES_JSON || '{}');
    const normalized = {};
    for (const email of Object.keys(raw)) {
      normalized[email.trim().toLowerCase()] = raw[email];
    }
    return normalized;
  } catch (e) {
    return {}; // JSON invalido -> nadie tiene rol -> todo se rechaza (fail closed)
  }
}
```

```diff
-    const role = ROLES[payload.email] || 'tecnico';
+    const ROLES = loadRoles(env);
+    const normalizedEmail = String(payload.email || '').trim().toLowerCase();
+    const role = ROLES[normalizedEmail];
+    if (!role) {
+      return new Response('Forbidden', { status: 403 });
+    }
```

Ningún correo fuera de esa lista recibe ningún rol — ni siquiera "técnico" por defecto. Login exitoso con Access + correo no autorizado en `ACCESS_ROLES_JSON` = `403`, no acceso.

## 2. Validación estricta del JWT — orden completo, falla ante cualquier error

```js
function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }

async function verifyAccessJWT(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64urlToJson(headerB64);
    payload = base64urlToJson(payloadB64);
  } catch (e) { return null; }

  // --- Antes de tocar la JWK: validar header y claims ---
  if (header.alg !== 'RS256') return null;              // ningun otro algoritmo se acepta
  if (!isNonEmptyString(header.kid)) return null;
  if (!isNonEmptyString(payload.email)) return null;

  const now = Date.now() / 1000;
  if (!payload.exp || now >= payload.exp) return null;    // expiracion
  if (payload.nbf && now < payload.nbf) return null;        // not-before, si existe
  if (payload.iss !== `https://${teamDomain}`) return null;    // issuer
  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audClaim.includes(aud)) return null;                     // audience

  // --- Seleccion y validacion de la JWK ---
  let jwks = await getAccessJWKS(teamDomain, false);
  if (!jwks) return null; // fallo al descargar -> fail closed
  let jwk = findValidJWK(jwks, header.kid);
  if (!jwk) {
    jwks = await getAccessJWKS(teamDomain, true); // la clave pudo rotar -- forzar refresco 1 vez
    if (!jwks) return null;
    jwk = findValidJWK(jwks, header.kid);
    if (!jwk) return null;
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  } catch (e) { return null; }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) return null;                                        // firma

  return payload; // solo si TODO lo de arriba paso
}

function findValidJWK(jwks, kid) {
  const jwk = (jwks.keys || []).find(k => k.kid === kid);
  if (!jwk) return null;
  if (jwk.kty !== undefined && jwk.kty !== 'RSA') return null;
  if (jwk.use !== undefined && jwk.use !== 'sig') return null;
  if (jwk.key_ops !== undefined && Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) return null;
  return jwk;
}
```

Nota: `kty`/`use`/`key_ops` se validan **solo cuando están presentes** en la JWK — son campos opcionales según el estándar; su ausencia no rechaza la clave, pero si están y no dicen lo esperado, sí se rechaza.

## 3. `wipeAll` — eliminado por completo, no gateado

```diff
     if (url.pathname === '/edits') {
       if (request.method === 'GET') {
         if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
         ...
       }
       if (request.method === 'POST') {
         if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
         let body;
         try { body = JSON.parse(await request.text()); } catch(e) { return new Response('Bad JSON', { status: 400, headers: cors }); }
 
-        if (body.wipeAll === true) {
-          if (currentRole() !== 'admin') {
-            return new Response('Solo administradora', { status: 403, headers: cors });
-          }
-          if (env.ALLOW_WIPE !== 'true') {
-            return new Response('wipeAll is disabled', { status: 403, headers: cors });
-          }
-          await env.SUPREME_DB.batch([
-            env.SUPREME_DB.prepare('DELETE FROM edits'),
-            env.SUPREME_DB.prepare('DELETE FROM deleted_keys'),
-            env.SUPREME_DB.prepare('DELETE FROM new_invoices'),
-          ]);
-          return json({ status: 'ok', wiped: true });
-        }
+        if ('wipeAll' in body) {
+          return new Response('wipeAll is no longer supported', { status: 400, headers: cors });
+        }
 
         // Surgical undelete...
```

(mismo cambio en `/sent` — se quita su bloque `body.wipeAll` y se agrega el mismo rechazo explícito). Ningún rastro de `ALLOW_WIPE` queda en el código. Un `POST {"wipeAll": true}` ahora responde **400** de forma explícita, en vez de ejecutar nada — más claro que dejarlo caer en silencio a "no hace nada".

## 5. Headers internos — construidos desde cero, nunca copiados del cliente

Ya era así en el diseño anterior (`new Headers()` vacío, luego `.set(...)` solo de lo que el propio código decide) — se deja explícito con un comentario para que quede auditable a simple vista:

```diff
       const innerUrl = new URL(request.url);
       innerUrl.pathname = url.pathname.replace(/^\/api/, '') || '/';

+      // IMPORTANTE: se construye un Headers() vacio y se llena a mano -- NUNCA se copian
+      // los headers de la solicitud original. Ningun X-Verified-* que el cliente
+      // hubiera mandado puede llegar aqui, porque nunca se leen ni se reenvian.
       const innerHeaders = new Headers();
       innerHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
       innerHeaders.set('X-Verified-Email', payload.email);
       innerHeaders.set('X-Verified-Role', role);
```
