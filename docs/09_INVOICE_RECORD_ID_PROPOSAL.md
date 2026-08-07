# Propuesta futura — `invoiceRecordId` (documentación, NO implementado)

## Problema que resuelve

Hoy la identidad de una factura depende de `number`+`wo`, y esos mismos dos campos a veces se usan invertidos entre sí (documentado desde el inicio de este proyecto). Eso significa que la identidad de un registro puede cambiar si se corrige un dato, y que dos registros con el mismo WO "compiten" por el mismo lugar en vez de poder coexistir mientras se revisan — que es exactamente lo que pasó esta semana.

## Propuesta

Agregar un campo aditivo, generado una sola vez al crear el registro, que nunca cambia:

```json
{
  "invoiceRecordId": "a1b2c3d4-...",
  "...todos los demas campos sin cambiar...": "..."
}
```

Reglas:
- Se genera (UUID) al crear el registro, una sola vez.
- No depende de `wo` ni de `number` — puede corregirse cualquiera de los dos sin perder la identidad del registro.
- No se reasigna nunca, ni siquiera si se corrige un error de captura.
- Dos registros con el mismo WO (uno real, uno erróneo) pueden coexistir con `invoiceRecordId` distintos, ambos visibles, marcados para revisión — en vez de que uno oculte al otro por compartir el mismo WO.

## Por qué no se implementa ahora

Es un cambio de identidad de datos que afecta cómo se guardan, comparan y sincronizan **todas** las facturas (D1, `HISTORICAL_DATA`, localStorage) — no es aditivo en el mismo sentido que un campo de cuarentena. Requiere su propio diseño de migración (cómo se le asigna un id a las 634 facturas existentes sin romper nada) y sus propias pruebas, coherente con la Regla #1. Queda documentado para cuando se autorice como su propia mejora, con su propia entrada en `EVOLUTION_LOG.md`.
