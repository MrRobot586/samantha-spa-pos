# Samantha Spa POS

Punto de venta e inventario para spa/salón: catálogo de servicios con
recetas (BOM), inventario híbrido (retail + insumos internos), comisiones
por estilista, **moneda en vivo con tasa BCV** (USD ⇄ Bs ⇄ €),
**métodos de pago con cambio**, **caja con retiros, corte e historial**,
**reportes por fecha con export CSV** y **CRUD de catálogo y usuarios**.
HTML, CSS y JavaScript puro, **sin dependencias ni build**.

Refactor completo de `Projects/Origins/POS system Samantha Spa.html`
(el archivo original queda intacto): se corrigieron los 16 bugs detectados
en el análisis, se dividió en HTML/CSS/JS y se añadió persistencia.

## Arranque

```bash
./servir.sh          # sirve en http://127.0.0.1:8000 y abre el navegador
./servir.sh 9001     # otro puerto
```

## Demo en GitHub Pages

Publicada desde la rama `main` (raíz, servida con `.nojekyll`):

```
https://mrrobot586.github.io/samantha-spa-pos/
```

Puedes probarla con las credenciales de la sección "Usuarios y acceso".
Notas:

- El `localStorage` pertenece al **origen** `https://mrrobot586.github.io`
  (se comparte entre los repos de un mismo usuario, la clave
  `samantha-spa-pos:v2` lo mantiene aislado de otras apps). Cada visita
  arranca de los datos de semilla.
- La app habla con `ve.dolarapi.com` por HTTPS con CORS abierto; funciona
  igual desde el dominio publicado.

Es obligatorio servirlo (no abrir el archivo con doble clic): los módulos
ES (`type="module"`) no cargan por `file://`.

## Usuarios y acceso

La app arranca en la pantalla de login. Credenciales semilla:

| Usuario   | PIN    | Rol            |
|-----------|--------|----------------|
| `admin`   | `1234` | Administrador  |
| `valeria` | `1111` | Estilista      |
| `carlos`  | `1111` | Estilista      |
| `sofia`   | `1111` | Estilista      |

- **Administrador**: todo (ventas, servicios, inventario, comisiones,
  **Caja & Cortes** y gestión de usuarios).
- **Estilista**: solo Dashboard (con sus propias ventas) y Caja/POS; su
  venta se atribuye automáticamente a su estilista vinculado. No ve
  comisiones, inventario ni caja.
- El alta/baja de usuarios, roles y restablecimiento de PIN se hace desde
  el botón **Usuarios** del header (solo admin). Nunca se puede quedar la
  app sin al menos un administrador activo.

> **Nota de seguridad (lee esto):** al ser una app 100% local sin backend,
> el login es **control de acceso en el equipo**, no seguridad de servidor:
> los PIN se guardan hasheados con salt (`core/pin.js`), pero el
> localStorage es editable por cualquiera con acceso al navegador. Sirve
> para saber quién hizo cada venta, no para proteger datos de atacantes.

## Moneda y tasa BCV

- Los precios **siempre se guardan en USD**; Bs y € son solo visualización
  (botones `[USD][Bs][€]` en el header, persistidos en `settings.currency`).
- La tasa llega de `https://ve.dolarapi.com/v1/cotizaciones` (gratuita, sin
  API key): se pinta la caché al arrancar y se revalida al inicio, cada 10
  minutos si está vencida (TTL 1 h) y con el clic en el badge de tasa.
  Sin red se usa la última tasa guardada y el badge lo indica.
- Cada transacción guarda un **snapshot de la tasa** (`rates`) y cada corte
  de caja también: los reportes históricos se pueden mostrar en Bs fieles
  aunque la tasa cambie después.
- El formato USD histórico (`$1,234.56`) no cambió; Bs usa locale `es-VE`
  y € usa `es-ES`.

## Métodos de pago y caja

- El ticket cobra en **Efectivo, Tarjeta u Otro**. En efectivo se indica el
  recibido en la moneda activa y se calcula el cambio (vacío = pago exacto;
  recibido menor que el total → el cobro se bloquea sin tocar nada).
- **La caja arranca cerrada: no se puede cobrar hasta abrirla.** La
  pestaña **Caja & Cortes** (solo admin) gestiona:
  - **Apertura** con fondo inicial (en la moneda activa, guardado en USD).
  - **Retiros** con motivo, monto y quién lo hizo.
  - **Corte**: efectivo esperado = fondo + ventas en efectivo − retiros;
    se ingresa el contado físico y la diferencia (sobrante/faltante) queda
    registrada en el historial junto con ventas por método y tasa vigente.
- El **badge de caja** en el header muestra `Caja abierta`/`Caja cerrada`
  (solo admin) y lleva a la pestaña de caja.

## Tema y responsive

- **Tema `auto | dark | light`** con botón de ciclo en el topbar. `auto` es
  el valor por defecto y sigue a `prefers-color-scheme` (cambia en vivo si
  el sistema cambia). El tema elegido se persiste en `settings.theme` y lo
  restaura antes del primer render un script pre-paint de `<head>`.
- **Escala:** tipografía `--fs-2xs…--fs-5xl`, espaciado `--space-1…--space-20`
  y breakpoints canónicos **640 / 768 / 1024 / 1280** (todo documentado en
  `css/tokens.css`).
- **Dispositivos:** la sidebar lateral vive en ≥1024; por debajo pasa a barra
  inferior fija (con safe-area para el notch). La topbar se compacta por
  niveles (iconos-only hasta 1280) y el contenido se limita a 1440px en
  monitores anchos. Objetivos táctiles ≥44px y `prefers-reduced-motion`.

## Pruebas

```bash
npm test             # node --test tests/*.test.mjs — 89 pruebas, cero dependencias
```

Cubren la lógica de dominio (ticket, IVA, comisiones, cobro, stock,
métodos de pago, caja/cortes, tasas y conversión, persistencia —incluido
el tema y el respaldo de "restaurar demo"—, reportes por fecha,
autenticación y usuarios). La UI se verifica con el smoke de CDP
(`npm run smoke` — requiere `python3` y Chrome: login, roles, venta,
gate de caja, apertura, corte, moneda y tema, CRUD, restaurar demo, XSS,
móvil y responsive en 6 anchos) y con el checklist del final. El CI de
GitHub Actions (`.github/workflows/ci.yml`) corre ambas cosas en cada push.

## Estructura

```
index.html            estructura semántica, sin handlers en línea (data-action)
css/
  tokens.css          paleta (oscuro + light), tipografía --fs-*, espaciado
                      --space-*, radios, sombras y los breakpoints canónicos
  base.css            reset, scrollbars, foco visible, reduced-motion
  layout.css          shell (sidebar/header/main) + bottom-nav + topbar responsive
  components.css      botones, tablas, badges, modales, toasts, formularios
  views/              grids y piezas específicas de cada pestaña (un archivo por tab)
    dashboard.css  pos.css  cash.css  services.css  inventory.css
    commissions.css  login.css  users.css
js/
  main.js             arranque + delegación de eventos (document[data-action])
  core/
    config.js         IVA, claves de storage (v2, sesión, tasas), monedas, temas, pestañas
    seed.js           datos iniciales (fábrica, no compartida)
    state.js          estado en memoria (sin DOM, testeable)
    storage.js        load/save con backend inyectable, normalización y migración v1→v2
    pin.js            hash de PINs (ofuscación local, etiquetado)
    auth.js           login/logout, sesión, permisos por rol
    rates.js          tasa BCV (fetch + caché), convert/toUSD, formatMoney
    utils.js          escapeHtml, money, uid, ids de transacción, fechas
  domain/             100% sin DOM → tests en node
    ticket.js         ítems, cantidades, subtotal/IVA/comisión, método de pago
    checkout.js       gate de caja → validación de stock → recibido → transacción
    cash.js           apertura, retiros, ventas por método, corte e historial
    inventory.js      altas, edición, bajas (bloqueadas si están en una receta), low-stock
    services.js       servicios y recetas, edición y baja
    reports.js        agregados por rango de fechas (ventas, comisiones, cortes)
    staff.js          lookup y tasa de comisión
    users.js          alta/edición/baja de usuarios, PIN, último admin
  ui/                 renders (innerHTML + escapeHtml) y modales
    header.js         toggle de moneda, tema, badge de tasa y badge de caja
    login-view.js     pantalla de acceso
    navigation.js     nav y pestañas según rol (switchTab rechaza lo no permitido)
    pos.js            catálogo, ticket, método de pago, recibido y cambio
    cash-view.js      pestaña Caja & Cortes + preview del corte
    dashboard.js      KPIs del día (acotados al rol)
    users-view.js     lista y formulario de usuarios
    csv-export.js     descarga de CSV (Blob + BOM), sin dependencias
    (+ services/inventory/commissions, modales, toasts)
tests/                node --test (ticket, checkout, cash, inventory, services, reports, rates, storage, auth, users)
smoke.mjs             smoke E2E por CDP (npm run smoke) — requiere python3 y Chrome
servir.sh             servidor estático local (Python o Node, sin instalar)
.github/workflows/ci.yml  CI: npm test + smoke en cada push/PR
```

## Decisiones del refactor

- **Comisión = tasa del estilista seleccionado.** El original calculaba con
  el % del servicio e ignoraba a quién se le atribuía la venta (bug #3). Los
  servicios ya no llevan `commissionPercent`; el selector de estilista es
  la única fuente de la tasa.
- **Persistencia en `localStorage`** con clave `samantha-spa-pos:v2`
  (v1 se migra automáticamente y queda como respaldo). Todo lo leído se
  normaliza campo a campo; si el JSON está corrupto se respalda en
  `samantha-spa-pos:backup-corrupto` y se arranca de semilla (nunca se
  borra a ciegas el historial de una caja).
- **Login local con PIN**: sesión en clave propia que sobrevive a F5,
  roles `admin`/`stylist` que ocultan pestañas (y `switchTab` las rechaza,
  no solo las oculta). Es control de acceso, no seguridad de servidor —
  está documentado en "Usuarios y acceso".
- **Stock nunca negativo.** El cobro valida caja abierta, retail y BOM
  completo *antes* de mutar; si falta algo, se bloquea con un toast
  detallando el faltante y el estado queda intacto.
- **Dinero en USD, visualización en la moneda activa.** El recibido y el
  contado se ingieren en la moneda visible y se traducen a USD con la tasa
  vigente antes de persistir; las ventas y cortes guardan su snapshot de
  tasa para poder reportarlos fielmente después.
- **XSS:** todo texto de usuario pasa por `escapeHtml()` antes de tocar
  `innerHTML`; los toasts usan `textContent`.
- **Móvil:** la sidebar se convierte en barra inferior fija (<1024px), en vez
  del layout roto del original; en 768–1023 el sidebar de 16rem dejaba el
  contenido a 512px y la topbar desbordaba (defecto del original), así que
  la nav inferior gana ancho y el lateral vuelve en ≥1024. La topbar se
  compacta por niveles: iconos-only hasta 1280, y fecha/nombre del usuario
  vuelven en xl; la tasa se trunca con "…" (completa en el tooltip).
- **Tema claro/oscuro vinculado al sistema:** `settings.theme` es
  `auto | dark | light`. Con `auto` sigue a `prefers-color-scheme` en vivo
  (listener de `matchMedia`). Un script pre-paint en `<head>` lee el tema
  guardado antes de que llegue el CSS para no "flashear" el color al
  recargar; si falla algo, el oscuro del `:root` es el respaldo.
- **CSS con escala de tokens:** tipografía `--fs-2xs…--fs-5xl` y espaciado
  `--space-1…--space-20`; las reglas nuevas usan solo tokens. Breakpoints
  canónicos **640 / 768 / 1024 / 1280** (se escriben como pares
  complementarios `min-width:640` / `max-width:639`…). Grids con
  `repeat(auto-fit, minmax(min(100%, N), 1fr))` en vez de columnas fijas.
  Safe-area (`env`) para el notch, objetivos táctiles ≥44px en móvil,
  `prefers-reduced-motion` y contenido limitado a 1440px en monitores anchos.
- **Indicadores reales:** el badge de caja y la tasa BCV muestran datos
  vivos del estado/API — el "+12% vs ayer" del original siguió eliminado
  por ser un dato inventado.
- **CDN endurecidos:** FontAwesome con versión exacta + `integrity`; los
  servicios de Google Fonts quedan sin SRI a propósito (sirven CSS según el
  User-Agent).
- **Editar/eliminar con guardas:** el estado nunca queda inconsistente. Un
  insumo usado por alguna receta no se puede borrar (se listan los servicios
  que lo usan); no se borra el último admin activo ni la propia cuenta; al
  descartar el ticket en curso se quita el servicio eliminado. Las bajas y
  "restaurar demo" pasan por un modal de confirmación genérico, nunca por
  `confirm()` nativo.
- **"Restaurar demo" respalda antes:** guarda el estado actual en
  `STORAGE_DEMO_BACKUP_KEY` y recién entonces repone la semilla, para que un
  clic accidental no borre datos reales.
- **Reportes por rango de fechas:** ventas y comisiones se agregan con rango
  inclusivo en hora local (mismo día cuenta completo); el historial de cortes
  se filtra por fecha de cierre y todo se puede exportar a CSV con BOM UTF-8
  (abre bien en Excel en español).
- **Sesión caduca por inactividad:** 20 minutos sin gestos del usuario cierran
  la sesión (`SESSION_IDLE_MS`, revisado cada 30 s). El `mousemove` se
  debouncea para no resetear el contador en cada pixel.

## Checklist de verificación manual

1. `./servir.sh` → aparece el login; sin sesión no se ve nada de la app.
2. PIN incorrecto → error inline; `admin`/`1234` → entra con 6 pestañas.
3. `valeria`/`1111` → solo Dashboard y POS; sin Inventario, Comisiones,
   Caja ni Usuarios; su dashboard no muestra alertas de stock.
4. El badge de tasa muestra `1 USD = … Bs` y se actualiza al hacer clic.
5. Cambiar a `Bs` y `€`: los KPIs, ticket y catálogo cambian de formato;
   al recargar, la moneda elegida persiste.
6. Con la caja cerrada, intentar cobrar → toast "La caja está cerrada".
7. Caja & Cortes → Abrir caja con fondo → el badge pasa a `Caja abierta`.
8. Vender en efectivo con recibido > total → muestra el cambio; con
   recibido < total → se bloquea. Vender en tarjeta → sin recibido.
9. Registrar un retiro y cerrar la caja con el contado → el corte aparece
   en el historial con su diferencia.
10. Vender un servicio con receta: el stock del insumo baja y la comisión
    del estilista acumula en Comisiones.
11. Recargar (F5): la sesión, ventas, stock, moneda y caja siguen ahí.
12. Producto llamado `<img src=x onerror=alert(1)>` → se muestra como texto.
13. ESC cierra los modales; el catálogo es navegable con Tab.
14. A 375px de ancho: aparece la barra inferior, sin scroll horizontal.
15. Tema: el botón del topbar cicla Auto → Oscuro → Claro (el icono cambia);
    con `auto` y el SO en claro/oscuro la app lo sigue en vivo; al recargar
    el tema elegido se mantiene sin parpadeo.
16. A 700 y 900px el header no desborda; a 900 se ve la barra inferior y a
    1100 el sidebar lateral vuelve a la izquierda.
17. A 1600px el contenido queda centrado (máx. ~1440) y los grids de KPIs,
    catálogo y servicios se adaptan (sin scroll horizontal en ningún ancho).
18. Editar un producto/servicio desde la tabla actualiza la fila; "Nuevo"
    vuelve a abrir el formulario en blanco.
19. Eliminar un insumo usado por una receta se bloquea con aviso; un retail
    sin receta sí se elimina (con confirmación).
20. Caja & Cortes: filtrar el historial por fechas y exportar CSV; Comisiones:
    elegir un rango y exportar el CSV por estilista (se abren en Excel).
21. "Restaurar demo" (en Usuarios) pide confirmación y repone inventario,
    ventas y caja de fábrica, dejando un respaldo previo.
22. Dejar la app 20 min sin tocarla cierra la sesión sola y vuelve al login.

## Fuera de alcance (posibles siguientes pasos)

Editar las recetas (BOM) desde la UI (hoy se edita el producto, no su
composición), exportar/print del ticket y de los KPIs, y separar el storage
por dispositivo (hoy es un único `localStorage` compartido por pestaña).
