# Reglas operativas — Supreme AI

Establecidas: 2026-08-07, a raíz de un push directo a `main` hecho por otra sesión sin autorización.

## Regla #1 — Producción es sagrada

Nadie hace cambios directos a producción. Todo cambio, sin excepción, sigue este flujo:

```
Idea → Staging → Pruebas → Aprobación de Michelle → Producción
```

En términos concretos para este repo:
- Ningún push directo a `main`. Todo pasa por una rama de trabajo y espera la frase de autorización de Michelle antes de tocar producción.
- Ningún cambio de esquema o dato se ejecuta primero contra el D1 de producción — se prueba en `supreme-autopro-staging` primero.
- El Worker de backend (`supremekv1`) no se edita "en caliente" desde el dashboard sin que el cambio exista antes como código versionado en este repo.
- Si otra sesión de Claude toca este proyecto, debe conocer y respetar esta regla.

## Regla #2 — Nada entra sin validación

Antes de guardar una factura nueva, el sistema pregunta: ¿existe este WO? ¿existe este Order#? ¿existe este cliente? ¿existe esta combinación? Si hay conflicto, no guarda — pregunta. (Pendiente de implementar — Pilar 2.)

## Regla #3 — Papelera, no borrado

Nada se elimina de forma permanente. Todo lo que se retira pasa a `Archive` con su historial, no se destruye.

## Regla #4 — Reconciliar Base de Datos

Función periódica que revisa toda la base y reporta duplicados, clientes repetidos y números sospechosos para revisión — nunca corrige nada automáticamente. (Pendiente de implementar — Pilar 2.)

## Pilares del roadmap

1. **Seguridad**
2. **Integridad de Datos**
3. **Automatización**
4. **Operaciones**
5. **Inteligencia Empresarial**
6. **Escalabilidad**
7. **Experiencia del Usuario**

## Filtro para nuevas funciones

Antes de construir algo, debe cumplir las 5 reglas:
1. Ahorra tiempo.
2. Reduce errores.
3. Protege los datos.
4. Escala con la empresa.
5. Es tan simple que cualquier persona nueva pueda usarla.
