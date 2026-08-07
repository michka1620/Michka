# Resultado de la simulación offline (2026-08-07)

Ejecutada en Python, sobre los snapshots ya guardados (`backups/PRODUCCION_REAL_historical_data_...json` + `backups/d1_snapshot_...json`). No se modificó `index.html`, no se escribió en staging, no se tocó producción.

| # | Prueba | Resultado | Estado |
|---|---|---|---|
| 1 | Total físico de registros | 634 | ✅ OK |
| 2 | Registros activos | 631 | ✅ OK |
| 3 | Registros en cuarentena | 3 | ✅ OK |
| 4 | SMYRNA READY MIX ($372.50) visible | Sí, $372.50 | ✅ OK |
| 5 | New Bern Transport ($159.00) visible | Sí, $159.00 | ✅ OK |
| 6 | Las 3 en blanco no bloquean registros válidos | 0 colisiones nuevas de Order# entre activos | ✅ OK |
| 7 | Totales coinciden con lo aprobado | Facturado $148,956.49 · Cobrado $129,574.57 · Pendiente $19,381.92 · Clientes 252 | ✅ OK — coincide exacto |
| 8 | Ningún otro registro cambia de visibilidad | Aparecen exactamente 2 (SMYRNA, New Bern), pasan a cuarentena exactamente 3 (las ya conocidas), nada más se movió | ✅ OK |

**Nota:** el duplicado histórico Order# 20260998 (Southern Tire Mart vs. Rolling Equity Leasing, ver `06_CONFLICTOS_HISTORICOS.md`) sigue apareciendo — es el conflicto ya documentado de febrero, no uno nuevo introducido por esta corrección.

Con estos 8 checks en verde, la lógica propuesta (ver `08_CODE_CHANGE_PROPOSAL.md`) está lista para tu revisión — sigue sin implementarse.
