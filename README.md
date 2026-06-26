# SUPREME AutoPro LLC — Invoice System (Web App)

Sistema de facturas con base de datos en la nube (Supabase) y deploy en Netlify.

---

## Setup en 4 pasos (≈ 10 minutos)

### Paso 1 — Crear proyecto Supabase (gratis)

1. Ve a **https://supabase.com** → Sign up / Sign in
2. Click **New Project**
3. Nombre: `supreme-autopro` | Password: el que quieras | Region: US East
4. Espera ~2 minutos a que el proyecto inicie

### Paso 2 — Crear la base de datos

1. En tu proyecto Supabase → **SQL Editor** → **New Query**
2. Copia y pega todo el contenido de `supabase-setup.sql`
3. Click **Run** — debes ver "Success. No rows returned"

### Paso 3 — Configurar credenciales en index.html

1. En Supabase → **Project Settings** → **API**
2. Copia:
   - **Project URL** (algo como `https://xxxx.supabase.co`)
   - **anon / public key** (la clave larga que empieza con `eyJ...`)
3. Abre `index.html` y busca estas 2 líneas (cerca del inicio del `<script>`):
   ```js
   const SUPABASE_URL  = 'YOUR_SUPABASE_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```
4. Reemplaza con tus valores reales

### Paso 4 — Crear tu cuenta y hacer deploy

#### Crear tu cuenta de acceso:
1. Abre `index.html` en Chrome (puedes abrirlo directo como archivo)
2. Ingresa tu email (`michka1620@gmail.com`) y una contraseña nueva
3. Click **"Create account"** (primera vez)
4. Supabase te enviará un email de confirmación — confírmalo
5. Luego haz Sign In normalmente

#### Deploy en Netlify (gratis, permanente):
1. Ve a **https://netlify.com** → Sign up / Sign in
2. **Sites** → **Add new site** → **Deploy manually**
3. Arrastra la carpeta entera de este proyecto al área de deploy
4. ¡Listo! Netlify te da una URL como `https://nombre-aleatorio.netlify.app`
5. Puedes personalizar el nombre en Site Settings

---

## Funciones del sistema

| Función | Descripción |
|---------|-------------|
| **History** | Tabla de todas las facturas con búsqueda y filtros |
| **Monthly** | Resumen por mes con totales PAID/PENDING |
| **New Invoice** | Crear nueva factura con todos los campos |
| **PDF Download** | Descarga PDF individual o múltiple |
| **Export/Import** | Backup y restauración en JSON |
| **Edición inline** | Edita status, fecha, total directamente en la tabla |
| **Supabase sync** | Todos los cambios se guardan automáticamente en la nube |

## Primer acceso

En el **primer login**, el sistema importará automáticamente las **425 facturas históricas** (Enero–Junio 2026) a Supabase. Esto toma unos segundos.

## Acceso desde cualquier dispositivo

Una vez en Netlify, puedes acceder desde:
- 📱 iPhone / Android — abre la URL en Safari/Chrome
- 💻 Cualquier computadora con internet
- 📟 Tablet

## Backup de datos

- Usa **Export ⬇** para descargar un backup JSON de tus datos
- Usa **Import ⬆** para restaurar desde un backup
- Los datos también están siempre en Supabase (panel en supabase.com)

---

## Información de la empresa

- **Nombre:** Supreme AutoPro LLC
- **Dirección:** 233 Sugarberry Ave, Abilene, TX 79602
- **Teléfono:** 325-207-5839
- **Email:** contact@supremeautopro.com
