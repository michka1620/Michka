#!/usr/bin/env python3
"""
Validacion local de staging — Supreme AutoPro.

Corre esto TU, localmente. Nunca imprime nombres de clientes, telefonos,
direcciones, VIN, placas ni notas de reparacion — solo conteos, claves
afectadas, checksums y totales agregados.

Uso:
  STAGING_URL="https://supremekv1-staging.michka1620.workers.dev/edits" python3 scripts/validate_staging.py

No requiere la clave (GET no la exige hoy) -- ver docs/12_SEGURIDAD_ENDPOINTS.md
sobre por que eso mismo es un riesgo a corregir.
"""
import json
import os
import sys
import hashlib
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST_PATH = os.path.join(REPO_ROOT, 'backups', 'PRODUCCION_REAL_historical_data_2026-08-07_0128.json')

QUARANTINE_KEYS = ['4920134821|202609555', '4920135137|202609556', '4920135629|202609557']
EXPECTED = {
    'physical_total': 634, 'active': 631, 'quarantine': 3,
    'facturado': 148956.49, 'cobrado': 129574.57, 'pendiente': 19381.92, 'clientes': 252,
}

def sha256_of(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()

def fetch_staging():
    url = os.environ.get('STAGING_URL')
    if not url:
        print("ERROR: define STAGING_URL, ej:")
        print('  STAGING_URL="https://supremekv1-staging.michka1620.workers.dev/edits" python3 scripts/validate_staging.py')
        sys.exit(1)
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.load(r)

def key(inv): return str(inv.get('number')) + '|' + str(inv.get('wo') or '')

def deep_merge(inv, diff):
    obj_fields = ['client','tech','vehicle']
    merged = dict(inv)
    for f, ev in diff.items():
        if f in obj_fields and isinstance(ev, dict):
            base_obj = dict(inv.get(f) or {})
            for sf, sv in ev.items():
                bv = base_obj.get(sf)
                if sv not in (None, ''): base_obj[sf] = sv
                elif bv in (None, ''): base_obj[sf] = sv
            merged[f] = base_obj
        elif f in ('total','totalLabor','totalMaterial'):
            evnum = float(ev) if ev not in (None,'') else 0
            bvnum = float(merged.get(f) or 0)
            if evnum != 0: merged[f] = ev
            elif bvnum == 0: merged[f] = ev
        else:
            isEmpty = ev in (None, '')
            if not isEmpty: merged[f] = ev
            elif merged.get(f) in (None, ''): merged[f] = ev
    return merged

def main():
    with open(HIST_PATH) as f:
        hist = json.load(f)

    staging = fetch_staging()
    edits = staging.get('edits', {})
    deleted = set(staging.get('deleted', []))
    newInvs = staging.get('newInvs', [])

    print("=== CONTEOS CRUDOS DE STAGING (sin datos personales) ===")
    print("Filas en 'edits':", len(edits))
    print("Filas en 'deleted':", len(deleted))
    print("Filas en 'newInvs':", len(newInvs))
    print("Checksum de la respuesta completa:", sha256_of(staging)[:16], "...")

    print("\n=== CLAVES DE CUARENTENA — solo presencia, no contenido ===")
    for k in QUARANTINE_KEYS:
        present = k in edits
        flagged = present and edits[k].get('dataIntegrity') == 'QUARANTINED'
        print(f"  {k}: presente_en_edits={present}  dataIntegrity=QUARANTINED={flagged}")

    base = []
    for inv in hist:
        k = key(inv)
        if k in deleted: continue
        if k in edits: inv = deep_merge(inv, edits[k])
        base.append(inv)

    active_hist = [i for i in base if i.get('dataIntegrity') != 'QUARANTINED']
    hist_nums = set(str(i.get('number')) for i in active_hist)
    hist_wos = set(str(i.get('wo') or '') for i in active_hist)
    clean_new = []
    for inv in newInvs:
        k = key(inv)
        if k in deleted: continue
        n, w = str(inv.get('number','')), str(inv.get('wo') or '')
        if n in hist_nums or w in hist_nums or (w and w in hist_wos): continue
        clean_new.append(inv)

    active = active_hist + clean_new
    for inv in active:
        if inv.get('sentState')==2 and inv.get('status')=='PENDING': inv['status']='PAID'

    quarantine_count = len(base) - len(active_hist)
    physical_total = len(base) + len(clean_new)
    facturado = sum(float(i.get('total') or 0) for i in active)
    cobrado = sum(float(i.get('total') or 0) for i in active if i.get('status')=='PAID' or i.get('sentState')==2)
    pendiente = facturado - cobrado
    clientes = set((i.get('client') or {}).get('company','').strip().upper() for i in active if (i.get('client') or {}).get('company','').strip())

    results = {
        'physical_total': physical_total, 'active': len(active), 'quarantine': quarantine_count,
        'facturado': round(facturado,2), 'cobrado': round(cobrado,2), 'pendiente': round(pendiente,2),
        'clientes': len(clientes),
    }

    print("\n=== 8 CHECKS ===")
    checks = [
        ("Total fisico == 634", results['physical_total'] == EXPECTED['physical_total']),
        ("Activos == 631", results['active'] == EXPECTED['active']),
        ("Cuarentena == 3", results['quarantine'] == EXPECTED['quarantine']),
        ("SMYRNA (WO 4920135137) visible", any(str(i.get('wo'))=='4920135137' for i in active)),
        ("New Bern Transport (WO 4920135629) visible", any(str(i.get('wo'))=='4920135629' for i in active)),
        ("Facturado == esperado", abs(results['facturado'] - EXPECTED['facturado']) < 0.01),
        ("Cobrado == esperado", abs(results['cobrado'] - EXPECTED['cobrado']) < 0.01),
        ("Clientes == 252", results['clientes'] == EXPECTED['clientes']),
    ]
    all_ok = True
    for name, ok in checks:
        print(f"  [{'OK' if ok else 'FALLA'}] {name}")
        all_ok = all_ok and ok

    print("\n=== TOTALES AGREGADOS (sin desglose por cliente) ===")
    for k, v in results.items():
        print(f"  {k}: {v}")

    print(f"\nRESULTADO GENERAL: {'TODO OK' if all_ok else 'HAY FALLAS -- revisar arriba'}")

if __name__ == '__main__':
    main()
