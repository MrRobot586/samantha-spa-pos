# Samantha Spa POS

Punto de venta e inventario para spa/salón: catálogo de servicios con
recetas, inventario de productos de venta e insumos internos, comisiones
por estilista, **moneda en vivo con tasa BCV** (USD ⇄ Bs ⇄ €, con fuente de tasa elegible
USD o Euro),
**pagos mixtos (Efectivo, Débito, Pago Móvil, Divisa) con vuelto**, **caja
con retiros, corte e historial**, **reportes por fecha con export CSV**,
**tickets de canje imprimibles para impresora térmica** y
**CRUD de catálogo y usuarios**.
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
- **Estilista**: solo Dashboard (con sus propias ventas), Caja/POS y
  **Ventas** (para reimprimir sus tickets); su
  venta se atribuye automáticamente a su estilista vinculado. No ve
  comisiones, inventario, caja ni los ajustes de impresión.
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
- **Fuente de la tasa elegible en el topbar**: el selector `Tasa USD` /
  `Tasa Euro` define qué tasa del BCV alimenta la conversión a bolívares
  (y lo que pinta el badge: `Tasa USD: 872,39 Bs` o `Tasa Euro: 977,22 Bs`).
  Cualquier rol lo puede cambiar; queda en `settings.rateSource` (default
  `usd`) y sobrevive a F5. Solo cambia el paso a Bs: **la vista en € sigue
  usando la tasa cruzada** (`usdBs / eurBs`) y la de USD no cambia; si la
  tasa elegida no está disponible, la conversión cae a USD. El selector se
  oculta por debajo de 768px: el topbar desbordaba a 640–767 (medido). El
  badge de tasa sigue visible desde 640px con el mismo texto de fuente.
- Cada transacción guarda un **snapshot de la tasa** (`rates`) y cada corte
  de caja también: los reportes históricos se pueden mostrar en Bs fieles
  aunque la tasa cambie después.
- El formato USD histórico (`$1,234.56`) no cambió; Bs usa locale `es-VE`
  y € usa `es-ES`.

## Métodos de pago y caja

- **El POS es un wizard de 3 pasos**, en cualquier pantalla:
  **1 Orden** (catálogo, ítems, estilista y totales) → **2 Cobro**
  (resumen de la orden + métodos de pago) → **3 Cierre** (solo después de
  concretar: id de la venta, imprimir ticket, nueva venta). Se avanza con
  *Continuar al cobro* y se retrocede con *Atrás*/*Volver a la orden*.
  Las validaciones son estrictas: sin ítems no se pasa al paso 2 (el botón
  queda deshabilitado y el stepper lo refleja), el paso 3 no se puede
  elegir desde el stepper (solo existe tras la venta) y la confirmación
  sigue pasando por el modal *Confirmar venta* entre los pasos 2 y 3.
  El wizard vive en memoria: la orden persiste en F5 pero se vuelve al
  paso 1.
- El ticket se cobra con **Efectivo, Débito, Pago Móvil o Divisa**, en
  **pago mixto**: cada método lleva su propio monto (en la moneda activa,
  guardado en USD). El resumen muestra *Pagado / Falta / Vuelto*.
- Reglas del pago mixto:
  - **Efectivo y Divisa** son dinero físico: pueden superar el total y
    generan **vuelto** (se descuenta primero del efectivo y luego de la
    divisa).
  - **Débito y Pago Móvil** deben ir a monto exacto: si superan el total, el
    cobro se bloquea (el vuelto no se devuelve por el punto de venta).
  - Si falta por cubrir, `Procesar cobro` abre el **modal de confirmación**
    de la venta y el cobro se rechaza sin descontar stock ni comisión.
- **La caja arranca cerrada: no se puede cobrar hasta abrirla.** La
  pestaña **Caja & Cortes** (solo admin) gestiona:
  - **Apertura** con fondo inicial (en la moneda activa, guardado en USD).
  - **Retiros** con motivo, monto y quién lo hizo.
  - **Corte**: efectivo esperado = fondo + **dinero físico (Efectivo +
    Divisa)** − retiros; se ingresa el contado físico y la diferencia
    (sobrante/faltante) queda registrada en el historial junto con ventas por
    método y tasa vigente.
- El **badge de caja** en el header muestra `Caja abierta`/`Caja cerrada`
  (solo admin) y lleva a la pestaña de caja.

## Tickets de canje imprimibles

- Al concretar una venta se ofrece **Imprimir ticket**; también se puede
  **reimprimir** desde la pestaña **Ventas** (historial con filtro por fecha;
  el estilista solo ve sus propias ventas).
- El ticket es un comprobante de **canje de servicios**: incluye un **código
  único** (`C-XXXXXX`), la fecha/hora, los servicios pagados agrupados por
  estilista y el total. Los productos que acompañen la venta no se imprimen.
- **Configurable** (botón de impresora en el topbar, solo admin): ancho de
  papel **58 mm / 80 mm**, nombre del negocio, línea secundaria, pie y si se
  muestran los precios.
- La impresión usa `window.print()` con un CSS de ticket térmico
  (`css/print.css`): se elige la impresora en el diálogo del sistema y el
  ancho del papel se aplica con `@page { size: <ancho>mm auto }`.
- Cada venta guarda un **snapshot** de sus ítems (id, nombre y precio del
  momento), así el ticket no cambia si luego se edita el catálogo. Las ventas
  creadas antes de esta función no tienen nombres y se imprimen con etiquetas
  genéricas.

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
npm test             # node --test tests/*.test.mjs — 120 pruebas, cero dependencias
```

Cubren la lógica de dominio (ticket, IVA, comisiones, cobro, stock,
métodos de pago, caja/cortes, tasas y conversión, persistencia —incluido
el tema, el ticket de canje y el respaldo de "restaurar demo"—, reportes por
fecha, autenticación y usuarios) y una guarda estática del CSS (toda
variable `var(--x)` debe existir en el proyecto). La UI se verifica con el smoke de CDP
(`npm run smoke` — requiere `python3` y Chrome: login, roles, venta,
ticket imprimible (con `window.print` interceptado), reimpresión, ajustes de
impresión, gate de caja, apertura, corte, moneda y tema, CRUD, restaurar
demo, XSS, el gap de los filtros de Ventas, el wizard de 3 pasos del POS,
móvil y responsive en varios anchos) y con el checklist del final.
El CI de GitHub Actions (`.github/workflows/ci.yml`) corre ambas cosas en
cada push.

## Estructura

```
index.html            estructura semántica, sin handlers en línea (data-action)
css/
  tokens.css          paleta (oscuro + light), tipografía --fs-*, espaciado
                      --space-*, radios, sombras y los breakpoints canónicos
  base.css            reset, scrollbars, foco visible, reduced-motion
  layout.css          shell (sidebar/header/main) + bottom-nav + topbar responsive
  components.css      botones, tablas, badges, modales, toasts, formularios
  print.css           ticket térmico (58/80 mm) para window.print()
  views/              grids y piezas específicas de cada pestaña (un archivo por tab)
    dashboard.css  pos.css  sales.css  cash.css  services.css  inventory.css
    commissions.css  login.css  users.css
js/
  main.js             arranque + delegación de eventos (document[data-action])
  core/
    config.js         IVA, claves de storage (v2, sesión, tasas), monedas, temas, fuente de tasa, pestañas
    seed.js           datos iniciales (fábrica, no compartida)
    state.js          estado en memoria (sin DOM, testeable)
    storage.js        load/save con backend inyectable, normalización y migración v1→v2
    pin.js            hash de PINs (ofuscación local, etiquetado)
    auth.js           login/logout, sesión, permisos por rol
    rates.js          tasa BCV (fetch + caché), convert/toUSD, formatMoney
    utils.js          escapeHtml, money, uid, ids de transacción, fechas
  domain/             100% sin DOM → tests en node
    payments.js       métodos de pago, liquidación del pago mixto y vuelto
    ticket.js         ítems, cantidades, subtotal/IVA/comisión y pagos del ticket
    checkout.js       gate de caja → validación de stock → liquidación → transacción
    cash.js           apertura, retiros, ventas por método, corte e historial
    inventory.js      altas, edición, bajas (bloqueadas si están en una receta), low-stock
    services.js       servicios y recetas, edición y baja
    reports.js        agregados por rango de fechas (ventas, comisiones, cortes)
    receipt.js        datos del ticket de canje (código, grupos por estilista, totales)
    staff.js          lookup y tasa de comisión
    users.js          alta/edición/baja de usuarios, PIN, último admin
  ui/                 renders (innerHTML + escapeHtml) y modales
    header.js         toggle de moneda, selector de tasa, tema, badge de tasa y badge de caja
    login-view.js     pantalla de acceso
    navigation.js     nav y pestañas según rol (switchTab rechaza lo no permitido)
    pos.js            catálogo, ticket, pagos mixtos y wizard de cobro (3 pasos)
    sales-view.js     historial de ventas y reimpresión de tickets
    receipt.js        HTML del ticket de canje para #print-area
    cash-view.js      pestaña Caja & Cortes + preview del corte
    dashboard.js      KPIs del día (acotados al rol)
    users-view.js     lista y formulario de usuarios
    csv-export.js     descarga de CSV (Blob + marca de orden de bytes), sin dependencias
    (+ services/inventory/commissions, modales, toasts)
tests/                node --test (payments, ticket, checkout, cash, inventory, services, reports, receipt, rates, storage, auth, users, css)
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
- **Stock nunca negativo.** El cobro valida caja abierta, stock de
  productos y receta completa *antes* de mutar; si falta algo, se bloquea con un toast
  detallando el faltante y el estado queda intacto.
- **Dinero en USD, visualización en la moneda activa.** Los montos de pago
  y el contado se ingresan en la moneda visible y se traducen a USD con la
  tasa vigente antes de persistir; las ventas y cortes guardan su snapshot
  de tasa para poder reportarlos fielmente después.
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
- **Guardas estáticas sobre el CSS:** `tests/css.test.mjs` exige que toda
  variable usada con `var(--x)` exista en el proyecto. Así se cazó el
  `--gap-sm` inexistente de la barra de filtros de Ventas, que colapsaba el
  `gap` a 0 y dejaba el botón "Aplicar" pegado a los inputs (ahora usa
  `--space-3`, igual que `.report-bar`); de paso se borró la regla muerta
  `.sales-actions`.
- **Barra de filtros alineada (Ventas, Comisiones, Cortes):** `.input--date`
  estaba declarada ANTES de `.input { width: 100% }` en `components.css`, así
  que `width/padding/font-size` eran reglas muertas: los date pickers salían
  a ancho completo y el botón quedaba en su propia fila. Se movió la regla
  después de `.input` (ahora miden ~131px y caben en una fila con "Aplicar");
  el smoke verifica el gap real y que sigan compactos.
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
  se filtra por fecha de cierre y todo se puede exportar a CSV con marca de
  orden de bytes (abre bien en Excel en español).
- **Sesión caduca por inactividad:** 20 minutos sin gestos del usuario cierran
  la sesión (`SESSION_IDLE_MS`, revisado cada 30 s). El `mousemove` se
  debouncea para no resetear el contador en cada pixel.

## Checklist de verificación manual

1. `./servir.sh` → aparece el login; sin sesión no se ve nada de la app.
2. PIN incorrecto → error inline; `admin`/`1234` → entra con 7 pestañas.
3. `valeria`/`1111` → solo Dashboard, POS y Ventas; sin Inventario,
   Comisiones, Caja ni Usuarios; su dashboard no muestra alertas de stock
   y en Ventas solo ve sus propias ventas.
4. El badge de tasa muestra `Tasa USD: … Bs` y se actualiza al hacer clic.
   Con la fuente en `Tasa Euro` el badge pasa a `Tasa Euro: … Bs`.
5. Cambiar a `Bs` y `€`: los KPIs, ticket y catálogo cambian de formato;
   al recargar, la moneda elegida persiste. Con la fuente en `Tasa Euro`,
   todos los montos en Bs cambian (los de € no) y la elección también
   persiste tras recargar.
6. Con la caja cerrada, intentar cobrar (paso 2) → toast "La caja está
   cerrada" y el wizard no avanza al cierre.
7. Caja & Cortes → Abrir caja con fondo → el badge pasa a `Caja abierta`.
8. Vender con pago mixto (p. ej. efectivo + divisa) cubriendo el total →
   el modal confirma y aparece el vuelto; si el total no se cubre o el
   débito/pago móvil supera el total, el cobro se bloquea. Con la orden
   vacía, *Continuar al cobro* y el paso 2 del stepper están deshabilitados;
   *Atrás* vuelve al paso 1 sin perder los ítems.
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
19. Eliminar un insumo usado por una receta se bloquea con aviso; un
    producto de venta sin receta sí se elimina (con confirmación).
20. Caja & Cortes: filtrar el historial por fechas y exportar CSV; Comisiones:
    elegir un rango y exportar el CSV por estilista (se abren en Excel).
21. "Restaurar demo" (en Usuarios) pide confirmación y repone inventario,
    ventas y caja de fábrica, dejando un respaldo previo.
22. Vender un servicio y confirmar → el wizard pasa al paso 3 (Cierre) con
    "Imprimir ticket" y "Nueva venta"; al pulsar imprimir se abre el
    diálogo del sistema (el ticket solo muestra los servicios, el código de
    canje y los servicios agrupados por estilista; los productos no se
    imprimen). "Nueva venta" vuelve al paso 1 con la orden vacía.
23. Ajustes de impresión (botón de impresora en el topbar, solo admin):
    cambiar a 80 mm y editar encabezado/pie; reimprimir desde la pestaña
    Ventas (con filtro por fecha) conserva y refleja esos ajustes.
24. Dejar la app 20 min sin tocarla cierra la sesión sola y vuelve al login.

## Fuera de alcance (posibles siguientes pasos)

Editar las recetas desde la UI (hoy se edita el producto, no su
composición), exportar/print de los KPIs, y separar el storage
por dispositivo (hoy es un único `localStorage` compartido por pestaña).
