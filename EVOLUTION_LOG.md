# Supreme AutoPro — Evolution Log

Registro de cada mejora real hecha al sistema: el problema que resolvió, cómo, y su impacto. Objetivo: que dentro de unos años se pueda ver el camino completo, no depender de la memoria.

Formato de cada entrada: Problema → Solución → Fecha → Tiempo ahorrado → Errores eliminados → Quién aprobó.

---

## #001 — Captura → Factura automática (Bandeja de Servicios)

- **Estado:** En diseño — pendiente de aprobación de Michelle. Sin código todavía (Regla #1).
- **Problema:** Toda captura de Luis/John pasa hoy por Michelle: ella abre Claude, sube las imágenes, revisa todo, y recién ahí se crea la factura. Es un cuello de botella de una sola persona que no escala con más vans/técnicos, y el relevo manual (describir capturas por chat) fue la causa raíz de los problemas de numeración encontrados en la auditoría del 2026-08-07.
- **Solución propuesta:** Bandeja de subida directa para Luis/John (sin formulario largo) → procesamiento con IA en el servidor (no en el navegador de Michelle) → validación automática (Regla #2: ¿existe este WO/Order#/cliente?) → alta confianza y sin conflicto = factura blanca lista, directo a la cola del cierre semanal; baja confianza o conflicto = a "Requiere revisión", la única cola que Michelle mira.
- **Fecha:** (pendiente — se llena cuando se apruebe e implemente)
- **Tiempo ahorrado:** (pendiente de medir tras implementación)
- **Errores eliminados:** (pendiente — objetivo: eliminar colisiones de Order# y facturas con campos vacíos causadas por relevo manual)
- **Aprobó:** (pendiente)

---
