# R2 — Arquitectura documental (diseño, R2 NO activado todavía)

## 1. Estructura de carpetas/objetos

R2 es clave-valor plano (no hay carpetas reales), pero se usan prefijos para que sea navegable a simple vista en el dashboard:

```
supreme-captures/
  {año}/{semana-facturacion=YYYY-MM-DD del miercoles de inicio}/{tecnico}/{objeto}
```

Ejemplo: `2026/2026-08-05/luis/20260806T231045Z_9f3a1c2e.png`

La búsqueda real (por WO, por factura, por técnico) nunca depende de esta estructura de carpetas — depende del índice en la tabla `capturas` (D1). Los prefijos son solo para revisión manual/humana.

## 2. Convención de nombres

`{timestamp_subida_UTC}_{uuid4}.{extension}` — nunca el nombre original del teléfono (`IMG_4450.PNG`), porque dos técnicos pueden subir archivos con el mismo nombre el mismo día. El UUID garantiza que nunca se pisan dos archivos entre sí.

## 3. Modelo de vinculación

La tabla `capturas` (ver `04_DATA_MODEL_CAPTURAS_REVISIONES.md`) es el único lugar que conecta: imagen (`r2_key`) ↔ técnico ↔ fecha/hora ↔ semana de facturación ↔ WO detectado ↔ factura (`invoice_key`) ↔ estado de procesamiento. La tabla `revisiones` conecta además cada excepción con su `captura_id` de origen.

## 4. Política de acceso privado

- El bucket se crea **privado** — sin acceso público, sin habilitar el dominio `.r2.dev` público.
- Toda visualización de una imagen pasa por el Worker: genera una URL firmada de corta duración (minutos) solo cuando Michelle abre una revisión puntual — nunca un link permanente.
- El Worker exige el mismo `SYNC_KEY` que el resto de las escrituras hasta que exista autenticación real por usuario (Regla de usuarios, pendiente).

## 5. Prevención de duplicados

Al subir, se calcula el SHA-256 del archivo (en el navegador o en el Worker). Antes de crear un objeto nuevo en R2, se busca ese hash en la tabla `capturas`. Si ya existe, no se sube un objeto idéntico — se enlaza el evento nuevo a la imagen ya guardada.

## 6. Estrategia de respaldo

R2 tiene redundancia propia de Cloudflare a nivel de objeto (no depende de un solo disco/región). Lo que sí hay que respaldar aparte es el **índice** (la tabla `capturas` en D1) — si el índice se pierde, las imágenes siguen en R2 pero se vuelven difíciles de encontrar. Se incluye en la misma rutina de snapshot que ya existe para el resto de D1 (`backups/`).

## 7. Costo estimado

Con el volumen actual (~120 facturas/mes, ~3 fotos c/u, ~400KB c/u ≈ 140MB/mes, ~1.6GB acumulados en 12 meses de retención): **$0/mes**, dentro del nivel gratuito de R2 (10GB almacenamiento, 1M escrituras, 10M lecturas gratis, sin costo de egreso). Margen para crecer ~6x antes de pagar algo.

## 8. Procedimiento de eliminación después de 12 meses (diseñado, no activo)

1. Job programado (no automático hasta aprobarlo) que lista, cada mes, los objetos cuyo `uploaded_at` en `capturas` supera 12 meses.
2. **Excepción obligatoria:** cualquier imagen ligada a una factura en cuarentena, en disputa, o con una revisión sin resolver **no entra en esta lista**, sin importar la fecha — se conserva hasta que se resuelva.
3. Los candidatos a eliminar pasan primero a un registro de "pendiente de eliminación" con 30 días de gracia.
4. Eliminación real requiere confirmación manual — nunca automática y silenciosa.

## 9. Plan de reversión

R2 es 100% aditivo: no reemplaza nada del flujo actual de facturación. Si algo sale mal, se detienen las subidas nuevas y se desconecta el binding — el resto del sistema (D1 de facturas, `index.html`) sigue funcionando exactamente igual, porque nunca depende de que R2 exista. Si el índice (`capturas`) se corrompe, se restaura desde su propio snapshot — los objetos en R2 nunca se tocan en ese proceso (nunca se sobreescriben ni se borran automáticamente).
