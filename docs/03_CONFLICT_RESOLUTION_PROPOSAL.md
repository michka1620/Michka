# Paso 3 — Propuesta de corrección de registros conflictivos (SOLO staging, no ejecutado)

## 3.1 Las 3 facturas en blanco → cuarentena

Propuesta de estructura, aditiva, sin renombrar ni quitar ningún campo existente:

```json
{
  "...todos los campos originales sin cambiar...": "...",
  "dataIntegrity": "QUARANTINED",
  "quarantine": {
    "reason": "Registro creado sin cliente/fecha/tecnico; Order# colisiona con una factura real ya existente",
    "flaggedAt": "2026-08-07",
    "sourceCommit": "e3b386e",
    "sourceDescription": "Push directo a main fuera de este flujo de trabajo, sin PR ni autorizacion"
  }
}
```

Se aplicaría a los 3 registros exactamente así, sin tocar ningún otro dato:

| WO | Order# actual | Total | Acción propuesta |
|---|---|---|---|
| 4920134821 | 202609555 | $736.50 | `dataIntegrity: QUARANTINED` — sin evidencia de que sea un trabajo real |
| 4920135137 (versión en blanco) | 202609556 | $372.50 | `dataIntegrity: QUARANTINED` — duplica una factura completa ya existente en D1 |
| 4920135629 (versión en blanco) | 202609557 | $159.00 | `dataIntegrity: QUARANTINED` — duplica una factura completa ya existente en D1 |

Regla de cálculo propuesta (código, para cuando se autorice): cualquier función que sume totales (facturado/cobrado/pendiente) debe excluir los registros con `dataIntegrity === "QUARANTINED"`. Una vista aparte, "Cuarentena", los sigue mostrando — no desaparecen, solo salen de las cuentas.

## 3.2 Recuperar visibilidad de SMYRNA y New Bern Transport

Estas dos facturas **ya existen completas y correctas** en D1 (`new_invoices`), no hay que recrearlas. El problema es que el filtro de deduplicación del cliente (`index.html`, función `getInvoices`) las excluye porque el WO real ya "aparece ocupado" por la versión en blanco dentro de `HISTORICAL_DATA`.

Dos formas de arreglarlo (para decidir, ninguna ejecutada):

- **Opción A — parche de datos:** vaciar el campo `wo` de las 2 versiones en blanco dentro de `HISTORICAL_DATA` (quedan en cuarentena mostrando solo su Order# y total, sin bloquear el WO real).
- **Opción B — parche de lógica (recomendada):** el filtro de deduplicación en `getInvoices()` debe ignorar cualquier registro con `dataIntegrity === "QUARANTINED"` al construir el set de WO/Order# "ya ocupados". Esto arregla la causa real (el filtro no distingue un registro en cuarentena de uno válido) y sirve para cualquier caso futuro similar, no solo estos dos.

Recomiendo B porque A es un parche puntual que no evita que vuelva a pasar; B corrige la regla que permitió que pasara.

## 3.3 Comparación esperada antes/después (calculada sobre los datos reales, sin ejecutar nada)

| Métrica | ANTES (estado actual) | DESPUÉS (con la propuesta aplicada) |
|---|---|---|
| Total de facturas | 632 | 631 |
| Total facturado | $149,692.99 | $148,956.49 |
| Total cobrado | $129,574.57 | $129,574.57 (sin cambio — ninguno de los 3 en cuarentena estaba cobrado) |
| Total pendiente | $20,118.42 | $19,381.92 |
| Clientes únicos | 251 | 252 (aparece "NEW BERN TRANSPORT" como cliente nuevo — distinto de "NEW BERN" que ya existía; queda anotado, no se combina) |

La diferencia de facturado (-$736.50) es exactamente el monto de la única factura sin gemelo bueno (4920134821) — las otras dos se compensan (sale la versión en blanco, entra la versión completa por el mismo monto).

## 3.4 Casos de prueba — "una factura nunca vuelve a ocultar otra"

1. **Colisión de Order# al guardar:** crear una factura con un Order# que ya existe → el sistema debe detenerse y avisar antes de guardar, no guardar silenciosamente un duplicado.
2. **WO real ya existente:** crear una factura con un WO que ya tiene una factura completa en cualquier otro Order# → el sistema debe avisar "posible duplicado", no crear una sombra en blanco.
3. **Pre-chequeo antes de fusionar D1 en `HISTORICAL_DATA`:** antes de cualquier fusión futura, correr una verificación que compare cada WO/Order# entrante contra los ya existentes; si hay colisión, la fusión se detiene y lista los conflictos en vez de continuar. (Esto es exactamente lo que faltó el 6 de agosto.)
4. **Cuarentena no cuenta:** después de marcar un registro `QUARANTINED`, verificar que desaparece de los 4 totales (facturado/cobrado/pendiente/clientes si aplica) pero sigue apareciendo en la vista de Cuarentena.
5. **Sin duplicado tras la corrección:** después de aplicar la Opción B, buscar por WO 4920135137 y por WO 4920135629 debe devolver **exactamente un** resultado cada uno (el completo), no dos.
6. **Auditoría de regresión:** volver a correr el script de auditoría completa sobre el resultado — debe dar 0 colisiones de Order# nuevas y 0 WO reales duplicados nuevos (los 2 duplicados históricos de febrero quedan aparte, documentados, sin resolver hasta tener evidencia).

Nada de esto se ejecuta todavía — es la propuesta para tu aprobación, a correr primero en staging.
