# Propuesta de cambio de código — `index.html` (NO aplicado todavía)

## Por qué existen dos copias de la misma lógica

`getInvoices()` (~línea 925) construye la lista que ve la pantalla a partir de `HISTORICAL_DATA` + `localStorage`. `pullEditsFromKV()` (~línea 4085) hace básicamente lo mismo pero al sincronizar con el servidor D1. Se escribieron en momentos distintos del proyecto — la segunda se agregó durante la migración a D1 sin reutilizar la primera — y cada una implementó su propio filtro de "¿este WO/Order# ya existe en `HISTORICAL_DATA`?" por separado. Es exactamente el patrón de riesgo que permitió que este bug existiera: si alguien corrige una copia y no la otra, quedan inconsistentes entre sí sin que nada lo avise.

**Recomendación:** extraer una sola función compartida, por ejemplo `buildActiveHistoricalIndex(HISTORICAL_DATA)`, que ambas funciones llamen. Documentado aquí como recomendación — no implementado hasta que lo apruebes.

## Cambio propuesto en `getInvoices()` (índice.html, ~línea 925-936)

```diff
     // Add user-created invoices — exclude any that duplicate a HISTORICAL_DATA entry
-    var histNums = new Set(HISTORICAL_DATA.map(function(i){ return String(i.number); }));
-    var histWOs  = new Set(HISTORICAL_DATA.map(function(i){ return String(i.wo||''); }));
+    // Los registros en cuarentena nunca cuentan como "ya ocupan" un WO/Order# —
+    // de lo contrario un dato en blanco puede seguir tapando uno real.
+    var activeHistForDupCheck = HISTORICAL_DATA.filter(function(i){ return i.dataIntegrity !== 'QUARANTINED'; });
+    var histNums = new Set(activeHistForDupCheck.map(function(i){ return String(i.number); }));
+    var histWOs  = new Set(activeHistForDupCheck.map(function(i){ return String(i.wo||''); }));
     userNew = userNew.filter(function(inv){
       var n = String(inv.number||'');
       var w = String(inv.wo||'');
       // Remove if number OR wo matches a historical number (catches swapped fields too)
       if (histNums.has(n) || histNums.has(w)) return false;
       // Remove if wo matches a historical wo
       if (w && histWOs.has(w)) return false;
       return true;
     });
```

## Cambio propuesto en `pullEditsFromKV()` (index.html, ~línea 4085-4092)

```diff
-    var histNums = new Set(HISTORICAL_DATA.map(function(i){ return String(i.number); }));
-    var histWOs  = new Set(HISTORICAL_DATA.map(function(i){ return String(i.wo||''); }).filter(Boolean));
+    var activeHistForDupCheck = HISTORICAL_DATA.filter(function(i){ return i.dataIntegrity !== 'QUARANTINED'; });
+    var histNums = new Set(activeHistForDupCheck.map(function(i){ return String(i.number); }));
+    var histWOs  = new Set(activeHistForDupCheck.map(function(i){ return String(i.wo||''); }).filter(Boolean));
     function isHistorical(i) {
       var n = String(i.number||''), w = String(i.wo||'');
       return histNums.has(n) || histNums.has(w) || (w && histWOs.has(w));
     }
     var cleanServerNew = serverNew.filter(function(i){ return !isHistorical(i); });
```

## Lo que este cambio SÍ resuelve

Exactamente el problema actual: un registro en cuarentena deja de "bloquear" un registro real con el mismo WO. Los 8 checks de `07_OFFLINE_SIMULATION_RESULTS.md` prueban esto.

## Lo que este cambio NO resuelve todavía (fuera de alcance de hoy)

Las reglas más amplias que pediste en el punto 4 (un WO repetido futuro debe revisar también Order#/cliente/fecha antes de decidir; un Order# repetido debe generar alerta en vez de omitir en silencio; en conflicto, conservar ambos y marcar para revisión) son un sistema de validación más grande — es, en esencia, la Regla #2 ("nada entra sin validación") que ya quedó explícitamente para después de este sprint, junto con la automatización de capturas. El cambio de hoy soluciona el caso ya ocurrido; no construye todavía el sistema que evita que vuelva a pasar con datos futuros. Lo dejo anotado para cuando se autorice esa fase.
