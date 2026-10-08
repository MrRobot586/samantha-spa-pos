/* Smoke test de Samantha Spa POS: levanta servidor + Chrome headless por CDP
 * (sin dependencias), carga la app y recorre el flujo completo: login y
 * roles, venta con pago mixto y confirmación, gate/apertura/corte de caja,
 * moneda en vivo con tasa BCV, XSS y viewport móvil. Reporta errores de
 * consola, excepciones y recursos 404.
 *
 * Requisitos: python3, google-chrome-stable. Uso: `npm run smoke`. */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const esperar = ms => new Promise(r => setTimeout(r, ms));

function servidor() {
    const p = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', RAIZ],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((ok, ko) => {
        let out = '';
        const t = setTimeout(() => ko(new Error('servidor sin puerto')), 8000);
        p.stdout.on('data', d => {
            out += d;
            const m = out.match(/port (\d+)/);
            if (m) { clearTimeout(t); ok({ proc: p, url: `http://127.0.0.1:${m[1]}` }); }
        });
    });
}

function chrome() {
    const bin = process.env.CHROME_BIN || 'google-chrome-stable';
    const p = spawn(bin, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
        '--user-data-dir=' + join(tmpdir(), 'chrome-smoke-' + Date.now()),
        '--disable-extensions', 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return new Promise((ok, ko) => {
        let err = '';
        const t = setTimeout(() => ko(new Error('chrome sin DevTools: ' + err.slice(-300))), 15000);
        p.stderr.on('data', d => {
            err += d;
            const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
            if (m) { clearTimeout(t); ok({ proc: p, ws: m[1] }); }
        });
    });
}

const errores = [];

async function main() {
    const srv = await servidor();
    const chr = await chrome();
    console.log(`servidor ${srv.url} | chrome ok`);

    const ws = new WebSocket(chr.ws);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pend = new Map();
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
        if (m.method === 'Runtime.exceptionThrown') {
            errores.push('Excepción: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        }
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
            errores.push('Log: ' + m.params.entry.text);
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            errores.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
        }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
        const i = ++id;
        pend.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
        ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);

    const evaluar = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    };

    await send('Page.navigate', { url: srv.url }, sessionId);
    for (let i = 0; i < 50; i++) {
        if (await evaluar(`document.readyState === 'complete'`)) break;
        await esperar(100);
    }
    await esperar(600);

    const checks = [];
    const check = async (nombre, expr) => {
        try {
            const v = await evaluar(expr);
            checks.push([v ? 'OK  ' : 'FALLO', nombre, JSON.stringify(v)]);
        } catch (e) {
            checks.push(['FALLO', nombre, e.message]);
        }
    };

    /** Abre/cierra el menú del topbar solo si hace falta (el menú de estado
     *  persistido no existe: siempre arranca cerrado tras un reload). */
    const menuAbierto = async () => {
        if (await evaluar(`!document.getElementById('topbar-menu-panel').classList.contains('is-hidden')`)) return;
        await evaluar(`document.getElementById('btn-menu').click()`);
        await esperar(120);
    };
    const menuCerrado = async () => {
        if (!(await evaluar(`!document.getElementById('topbar-menu-panel').classList.contains('is-hidden')`))) return;
        await evaluar(`document.getElementById('btn-menu').click()`);
        await esperar(120);
    };

    await check('título', `document.title`);

    // --- Login ---------------------------------------------------------------
    await check('pantalla de login visible', `!document.getElementById('login-screen').classList.contains('is-hidden')`);
    await check('app oculta sin sesión', `document.body.classList.contains('is-logged-out')`);

    await evaluar(`document.getElementById('login-pin').value = '0000'; document.getElementById('form-login').requestSubmit(); true`);
    await esperar(150);
    await check('PIN incorrecto → error inline', `document.getElementById('login-error').textContent`);
    await check('PIN incorrecto → sigue sin sesión', `document.body.classList.contains('is-logged-out')`);

    await evaluar(`document.getElementById('login-user').value = 'admin'; document.getElementById('login-pin').value = '1234'; document.getElementById('form-login').requestSubmit(); true`);
    await esperar(300);
    await check('login admin → app visible', `!document.body.classList.contains('is-logged-out')`);
    await check('chip del usuario', `document.getElementById('user-chip-name').textContent`);
    await check('admin ve la pestaña Configuración', `!document.getElementById('nav-settings').classList.contains('is-hidden')`);
    await check('nav admin: 8 pestañas visibles', `[...document.querySelectorAll('.sidebar__nav .nav-btn')].filter(b => !b.classList.contains('is-hidden')).length === 8`);
    await check('dashboard admin ve alertas de stock', `!document.getElementById('dash-stock-card').classList.contains('is-hidden')`);
    await check('badge de caja visible para admin', `!document.getElementById('cash-badge').classList.contains('is-hidden')`);

    // --- Menú desplegable del topbar ----------------------------------------
    await check('menú cerrado tras el login',
        `document.getElementById('topbar-menu-panel').classList.contains('is-hidden') && document.getElementById('btn-menu').getAttribute('aria-expanded') === 'false'`);
    await check('el topbar solo enseña título + badges + menú',
        `!document.querySelector('.topbar__right > .currency-toggle') && !document.querySelector('.topbar__right > .rate-source') && !document.querySelector('.topbar__right > .topbar__date')`);
    await check('badge de tasa visible en la barra', `document.getElementById('rate-badge').offsetParent !== null`);
    await evaluar(`document.getElementById('btn-menu').click()`);
    await esperar(120);
    await check('clic en el botón de usuario abre el menú',
        `!document.getElementById('topbar-menu-panel').classList.contains('is-hidden') && document.getElementById('btn-menu').getAttribute('aria-expanded') === 'true'`);
    await check('el botón del menú lleva el icono de usuario', `document.querySelector('#btn-menu i').classList.contains('fa-circle-user')`);
    await check('moneda dentro del menú',
        `document.getElementById('topbar-menu-panel').contains(document.querySelector('.currency-toggle'))`);
    await check('sesión dentro del menú (fecha fuera)',
        `document.getElementById('topbar-menu-panel').contains(document.getElementById('user-chip')) && !document.getElementById('topbar-menu-panel').contains(document.getElementById('current-date'))`);
    await check('tema y fecha viven en el sidebar',
        `!document.getElementById('topbar-menu-panel').contains(document.getElementById('theme-toggle')) && document.querySelector('.sidebar__bottom').contains(document.getElementById('theme-toggle')) && document.querySelector('.sidebar__bottom').contains(document.getElementById('current-date'))`);
    await check('el menú ya no tiene grupo Herramientas', `!document.querySelector('#topbar-menu-panel #menu-group-tools')`);
    await check('el panel cabe en pantalla',
        `(() => { const r = document.getElementById('topbar-menu-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top > 0; })()`);
    await evaluar(`document.getElementById('page-title').click()`);
    await esperar(120);
    await check('clic fuera cierra el menú',
        `document.getElementById('topbar-menu-panel').classList.contains('is-hidden') && document.getElementById('btn-menu').getAttribute('aria-expanded') === 'false'`);
    await evaluar(`document.getElementById('btn-menu').click()`);
    await esperar(120);
    await evaluar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await esperar(120);
    await check('ESC cierra el menú', `document.getElementById('topbar-menu-panel').classList.contains('is-hidden')`);
    await menuAbierto();
    await check('el menú ya no abre modales (todo vive en Configuración)', `!document.querySelector('#topbar-menu-panel [data-action="open-modal"]')`);
    await esperar(120);
    await menuAbierto();
    await evaluar(`document.getElementById('nav-ventas').click()`);
    await esperar(150);
    await check('cambiar de pestaña cierra el menú',
        `document.getElementById('topbar-menu-panel').classList.contains('is-hidden')`);
    await evaluar(`document.getElementById('nav-dashboard').click()`);
    await esperar(150);

    // Alta de usuarios desde la UI (los usuarios viven en Configuración)
    await evaluar(`document.getElementById('nav-settings').click()`);
    await esperar(150);
    await check('pestaña Configuración abierta desde el nav',
        `!document.getElementById('tab-settings').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('#tab-settings [data-action="open-modal"][data-target="modal-users"]').click()`);
    await esperar(150);
    await check('modal de usuarios abierto', `!document.getElementById('modal-users').classList.contains('is-hidden')`);
    await check('lista de usuarios: 4 semilla', `document.querySelectorAll('#users-list .user-row').length === 4`);
    await evaluar(`
        document.getElementById('user-name').value = 'Prueba UI';
        document.getElementById('user-username').value = 'Prueba';
        document.getElementById('user-role').value = 'stylist';
        document.getElementById('user-pin').value = '7777';
        document.getElementById('form-user').requestSubmit();
        true`);
    await esperar(250);
    await check('usuario creado (lista con 5)', `document.querySelectorAll('#users-list .user-row').length === 5`);
    await check('username normalizado a minúsculas', `[...document.querySelectorAll('#users-list .user-row__meta')].some(el => el.textContent.includes('@prueba'))`);
    await evaluar(`document.querySelector('[data-action="close-modal"][data-target="modal-users"]').click()`);
    await esperar(100);

    // Estilista: nav restringida
    await evaluar(`document.querySelector('[data-action="logout"]').click()`);
    await esperar(150);
    await check('logout → vuelve al login', `document.body.classList.contains('is-logged-out')`);
    await evaluar(`document.getElementById('login-user').value = 'valeria'; document.getElementById('login-pin').value = '1111'; document.getElementById('form-login').requestSubmit(); true`);
    await esperar(300);
    await check('nav estilista: 3 pestañas visibles', `[...document.querySelectorAll('.sidebar__nav .nav-btn')].filter(b => !b.classList.contains('is-hidden')).length === 3`);
    await check('estilista NO ve Inventario', `document.getElementById('nav-inventory').classList.contains('is-hidden')`);
    await check('estilista NO ve Caja & Cortes', `document.getElementById('nav-cash').classList.contains('is-hidden')`);
    await check('estilista ve Ventas', `!document.getElementById('nav-ventas').classList.contains('is-hidden')`);
    await check('estilista NO ve Configuración', `document.getElementById('nav-settings').classList.contains('is-hidden')`);
    await check('estilista NO ve el badge de caja', `document.getElementById('cash-badge').classList.contains('is-hidden')`);
    await check('el tab de Configuración está oculto para el estilista', `document.getElementById('tab-settings').classList.contains('is-hidden')`);
    await check('dashboard estilista oculta alertas de stock', `document.getElementById('dash-stock-card').classList.contains('is-hidden') && document.getElementById('dash-alerts-card').classList.contains('is-hidden')`);

    // De vuelta como admin para el resto del flujo
    await evaluar(`document.querySelector('[data-action="logout"]').click()`);
    await esperar(120);
    await evaluar(`document.getElementById('login-user').value = 'admin'; document.getElementById('login-pin').value = '1234'; document.getElementById('form-login').requestSubmit(); true`);
    await esperar(300);

    // Flujo de venta completo por delegación de eventos
    await check('KPI ventas renderizado', `document.getElementById('dash-today-sales').textContent`);
    await check('catálogo con ítems', `document.querySelectorAll('#pos-catalog-grid .catalog-card').length`);
    await check('inventario con filas', `document.querySelectorAll('#inventory-table-body tr').length`);
    await check('comisiones con tarjetas', `document.querySelectorAll('#commissions-staff-grid .staff-card').length`);

    // Flujo de venta completo por delegación de eventos
    await evaluar(`document.querySelector('[data-tab="pos"]').click()`);
    await esperar(150);
    await check('POS visible', `!document.getElementById('tab-pos').classList.contains('is-hidden')`);
    await check('selector de estilista poblado', `document.querySelectorAll('#pos-staff-select option').length`);

    // Validación del wizard: con la orden vacía no se puede pasar al cobro
    await check('paso 2 bloqueado con la orden vacía',
        `document.querySelector('[data-action="pos-step"][data-step="2"]').disabled === true`);
    await check('el paso 1 es el activo',
        `document.querySelector('.pos-step[data-step="1"]').classList.contains('is-active')`);
    await check('cobro y cierre ocultos al entrar',
        `document.getElementById('pos-checkout').classList.contains('is-hidden') && document.getElementById('pos-done').classList.contains('is-hidden')`);

    await evaluar(`document.querySelector('[data-action="add-item"][data-type="service"]').click()`);
    await esperar(100);
    await check('ticket con 1 ítem', `document.querySelectorAll('#ticket-items-container .ticket-item').length`);
    await check('total del ticket', `document.getElementById('ticket-total').textContent`);
    await check('comisión usa tasa del estilista', `document.getElementById('ticket-commission').textContent`);
    await check('paso 2 se habilita con ítems',
        `document.querySelector('[data-action="pos-step"][data-step="2"]').disabled === false`);

    // Paso 1 → 2 (catálogo e ítems fuera, resumen de cobro dentro)
    await evaluar(`document.querySelector('.pos__next').click()`);
    await esperar(150);
    await check('paso 2 activo tras continuar',
        `!document.getElementById('pos-checkout').classList.contains('is-hidden') && document.getElementById('pos-done').classList.contains('is-hidden')`);
    await check('paso 1 oculto en el cobro',
        `document.querySelector('#tab-pos .pos-layout').classList.contains('is-hidden')`);
    await check('resumen del cobro lista el ítem',
        `document.querySelectorAll('#checkout-items .checkout-item').length === 1`);
    await check('total replicado en el paso 2',
        `document.getElementById('ck-total').textContent === document.getElementById('ticket-total').textContent`);

    // Vuelta al paso 1 y de nuevo al cobro (se puede retroceder)
    await evaluar(`document.querySelector('.pos-checkout__actions [data-action="pos-step"][data-step="1"]').click()`);
    await esperar(150);
    await check('vuelta al paso 1', `!document.querySelector('#tab-pos .pos-layout').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('.pos__next').click()`);
    await esperar(150);

    // Pago mixto: cuatro métodos disponibles y resumen Pagado/Falta/Vuelto
    await check('cuatro inputs de pago', `document.querySelectorAll('[data-action="payment-amount"]').length === 4`);
    await evaluar(`(() => { const i = document.querySelector('[data-action="payment-amount"][data-method="cash"]'); i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await esperar(120);
    await check('vuelto calculado ($24.60)', `document.getElementById('ticket-change').textContent.includes('24.60')`);

    // La caja arranca cerrada: el modal confirma, pero el cobro se rechaza (gate)
    await check('badge de caja dice Cerrada', `document.getElementById('cash-badge-text').textContent.includes('cerrada')`);
    await evaluar(`document.querySelector('[data-action="pay"]').click()`);
    await esperar(200);
    await check('modal de confirmación de venta abierto', `!document.getElementById('modal-sale-confirm').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('[data-action="confirm-sale"]').click()`);
    await esperar(250);
    await check('caja cerrada → cobro bloqueado', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions.length === 0 && document.querySelectorAll('#ticket-items-container .ticket-item').length === 1`);
    await check('el cobro rechazado no avanza al cierre',
        `!document.getElementById('pos-checkout').classList.contains('is-hidden') && document.getElementById('pos-done').classList.contains('is-hidden')`);
    await check('toast de caja cerrada', `[...document.querySelectorAll('#toast-stack .toast')].pop()?.textContent.includes('cerrada') || false`);

    // Abrir caja desde la pestaña Caja & Cortes
    await evaluar(`document.querySelector('[data-action="switch-tab"][data-tab="cash"]').click()`);
    await esperar(200);
    await check('pestaña Caja visible', `!document.getElementById('tab-cash').classList.contains('is-hidden')`);
    await check('acciones con caja cerrada: Abrir caja', `document.querySelector('[data-action="cash-open-modal"]') !== null`);
    await evaluar(`document.querySelector('[data-action="cash-open-modal"]').click()`);
    await esperar(150);
    await check('modal de apertura abierto', `!document.getElementById('modal-cash-open').classList.contains('is-hidden')`);
    await evaluar(`document.getElementById('cash-open-fondo').value = '500'; document.getElementById('form-cash-open').requestSubmit(); true`);
    await esperar(250);
    await check('badge de caja dice Abierta', `document.getElementById('cash-badge-text').textContent.includes('abierta')`);
    await check('sesión de caja persistida', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).cashSession.open === true`);
    await check('resumen muestra el fondo 500', `document.getElementById('cash-summary').textContent.includes('500')`);

    // Volver al POS: primero el pago insuficiente, luego el pago exacto
    await evaluar(`document.querySelector('[data-action="switch-tab"][data-tab="pos"]').click()`);
    await esperar(150);
    await evaluar(`(() => { const i = document.querySelector('[data-action="payment-amount"][data-method="cash"]'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-action="pay"]').click(); return true; })()`);
    await esperar(200);
    await evaluar(`document.querySelector('[data-action="confirm-sale"]').click()`);
    await esperar(250);
    await check('pago insuficiente → cobro bloqueado', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions.length === 0 && document.querySelectorAll('#ticket-items-container .ticket-item').length === 1`);
    await check('toast de faltante', `[...document.querySelectorAll('#toast-stack .toast')].pop()?.textContent.includes('Faltan') || false`);

    // Pago exacto en efectivo (se limpia el input) → procesa
    await evaluar(`(() => { const i = document.querySelector('[data-action="payment-amount"][data-method="cash"]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-action="pay"]').click(); return true; })()`);
    await esperar(200);
    await check('pago exacto precargado en el modal', `document.getElementById('sale-confirm-preview').textContent.includes('Efectivo')`);
    await evaluar(`document.querySelector('[data-action="confirm-sale"]').click()`);
    await esperar(300);
    await check('toast de venta concretada', `[...document.querySelectorAll('#toast-stack .toast')].pop()?.textContent.includes('concretada') || false`);
    await check('ventas del día tras cobrar', `document.getElementById('dash-today-sales').textContent`);
    await check('persistencia guardada', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions.length`);
    await check('venta guardó método y pagos', `(() => {
        const tx = JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions[0];
        return tx.method === 'cash' && tx.receivedUSD > 0 && Array.isArray(tx.payments) && tx.payments[0].method === 'cash';
    })()`);
    await check('la venta guardó el detalle del servicio (snapshot)', `(() => {
        const tx = JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions[0];
        return tx.items.some(i => i.type === 'service' && i.name && typeof i.price === 'number');
    })()`);

    // Ticket de canje tras concretar (se intercepta window.print)
    await check('paso 3 (cierre) activo tras concretar',
        `!document.getElementById('pos-done').classList.contains('is-hidden') && document.querySelector('.pos-step[data-step="3"]').classList.contains('is-active')`);
    await check('el cierre muestra la venta', `document.getElementById('sale-done-preview').textContent.includes('TX-') || document.getElementById('sale-done-preview').textContent.length > 0`);
    await evaluar(`window.__printed = false; window.print = () => { window.__printed = true; }; true`);
    await evaluar(`document.querySelector('[data-action="print-last-ticket"]').click()`);
    await esperar(200);
    await check('window.print fue invocado', `window.__printed === true`);
    await check('ticket contiene el servicio', `document.getElementById('print-area').textContent.includes('Tinte Completo & Broshing')`);
    await check('ticket contiene el estilista', `document.getElementById('print-area').textContent.includes('Valeria Gómez')`);
    await check('ticket contiene código de canje', `document.getElementById('print-area').textContent.includes('C-')`);
    await check('ticket usa ancho 58mm', `document.querySelector('#print-area .receipt').style.getPropertyValue('--receipt-width') === '58mm'`);
    await evaluar(`document.querySelector('[data-action="pos-new-sale"]').click()`);
    await esperar(150);
    await check('Nueva venta vuelve al paso 1',
        `!document.querySelector('#tab-pos .pos-layout').classList.contains('is-hidden')
         && document.getElementById('pos-checkout').classList.contains('is-hidden')
         && document.getElementById('pos-done').classList.contains('is-hidden')
         && document.querySelectorAll('#ticket-items-container .ticket-item').length === 0`);

    // Pestaña Ventas + reimpresión
    await evaluar(`document.querySelector('[data-tab="ventas"]').click()`);
    await esperar(200);
    await check('pestaña Ventas visible', `!document.getElementById('tab-ventas').classList.contains('is-hidden')`);
    await check('Ventas lista la venta', `document.querySelectorAll('#sales-list tr').length === 1`);
    await check('filtros de Ventas con espacio real (bug de --gap-sm)',
        `(() => {
            const to = document.getElementById('venta-to');
            const btn = document.querySelector('[data-action="report-sales"]');
            if (!to || !btn) return false;
            const dx = btn.getBoundingClientRect().left - to.getBoundingClientRect().right;
            const dy = btn.getBoundingClientRect().top - to.getBoundingClientRect().bottom;
            // lado a lado → separación horizontal; si se apila, la vertical
            return Math.round(dx >= 0 ? dx : dy) >= 5;
        })()`);
    await check('inputs de fecha compactos (regla .input--date viva)',
        `(() => {
            const f = document.querySelector('.sales-filters');
            const a = document.getElementById('venta-from');
            if (!f || !a) return false;
            return a.getBoundingClientRect().width < f.getBoundingClientRect().width - 10;
        })()`);
    await check('botón imprimir habilitado', `!document.querySelector('#sales-list [data-action="print-ticket"]').disabled`);
    await evaluar(`window.__printed = false; document.querySelector('#sales-list [data-action="print-ticket"]').click()`);
    await esperar(150);
    await check('reimpresión desde Ventas', `window.__printed === true && document.getElementById('print-area').textContent.includes('Tinte Completo & Broshing')`);

    // Ajustes de impresión (admin): viven en la pestaña Configuración
    await evaluar(`document.getElementById('nav-settings').click()`);
    await esperar(150);
    await check('Configuración abierta (ticket de canje)', `!document.getElementById('tab-settings').classList.contains('is-hidden')`);
    await check('4 métodos de pago de fábrica', `document.querySelectorAll('#payment-methods-list tr').length === 4`);
    await check('Efectivo se muestra como fijo', `document.querySelector('#payment-methods-list tr').textContent.includes('Fijo')`);
    await evaluar(`
        document.getElementById('ticket-width').value = '80';
        document.getElementById('ticket-business-name').value = 'Samantha Spa & Estilo';
        document.getElementById('ticket-footer').value = 'Ticket de canje';
        document.getElementById('form-print-settings').requestSubmit();
        true`);
    await esperar(200);
    await check('ajustes de ticket persistidos', `(() => {
        const t = JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.ticket;
        return t.printerWidth === 80 && t.businessName === 'Samantha Spa & Estilo' && t.footer === 'Ticket de canje';
    })()`);

    // Retiro y corte de caja
    await evaluar(`document.querySelector('[data-action="switch-tab"][data-tab="cash"]').click()`);
    await esperar(200);
    await evaluar(`document.querySelector('[data-action="cash-withdraw-modal"]').click()`);
    await esperar(150);
    await evaluar(`document.getElementById('cash-withdraw-amount').value = '10'; document.getElementById('cash-withdraw-note').value = 'Retiro de prueba'; document.getElementById('form-cash-withdraw').requestSubmit(); true`);
    await esperar(250);
    await check('retiro registrado en la tabla', `document.getElementById('cash-withdrawals-list').textContent.includes('10.00') && document.getElementById('cash-withdrawals-list').textContent.includes('Retiro de prueba')`);

    await evaluar(`document.querySelector('[data-action="cash-close-modal"]').click()`);
    await esperar(150);
    await check('preview del corte con el esperado', `document.getElementById('cash-close-preview').textContent.includes('565.40')`);
    await evaluar(`document.getElementById('cash-close-contado').value = '565.40'; document.getElementById('form-cash-close').requestSubmit(); true`);
    await esperar(300);
    await check('corte cuadra exacto (toast)', `[...document.querySelectorAll('#toast-stack .toast')].pop()?.textContent.includes('cuadra') || false`);
    await check('corte en el historial', `document.getElementById('cash-closures-list').textContent.includes('565.40')`);
    await check('caja volvió a cerrarse', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).cashSession.open === false && document.getElementById('cash-badge-text').textContent.includes('cerrada')`);

    // Moneda en tiempo real: siembra la caché de tasas antes del F5 para que
    // la conversión funcione con la tasa guardada (con o sin red).
    await evaluar(`localStorage.setItem('samantha-spa-pos:rates', JSON.stringify({ usdBs: 872.3927, eurBs: 977.21940683, fecha: '2026-10-06T00:00:00-04:00', fetchedAt: Date.now() })); true`);

    // Recarga: los datos y la sesión deben sobrevivir
    await send('Page.navigate', { url: srv.url }, sessionId);
    await esperar(800);
    await check('tras F5 sigue logueado', `!document.body.classList.contains('is-logged-out')`);
    await check('tras F5 la venta sigue ahí', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions.length`);
    await check('tras F5 la comisión acumuló', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).staff[0].totalCommissions`);
    await check('la venta guardó el snapshot de tasa', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).transactions[0].rates.usdBs > 0`);

    // Moneda de visualización: badge de tasa + toggle USD/Bs/€
    await esperar(900); // deja tiempo al fetch de la tasa (si falla, manda la caché)
    await check('badge de tasa BCV', `document.getElementById('rate-badge').textContent.includes('Tasa USD:')`);
    await check('el badge ya no enseña la fecha', `!/\\d\\d\\/\\d\\d\\/\\d\\d/.test(document.getElementById('rate-badge').textContent)`);
    await check('USD activo por defecto', `document.querySelector('[data-action="set-currency"].is-active').dataset.currency === 'USD'`);
    await check('KPI en USD', `document.getElementById('dash-today-sales').textContent.includes('$')`);

    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="VES"]').click()`);
    await esperar(200);
    await check('KPI convertido a Bs', `document.getElementById('dash-today-sales').textContent.includes('Bs')`);
    await check('moneda persistida en el estado', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.currency === 'VES'`);

    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="EUR"]').click()`);
    await esperar(200);
    await check('KPI convertido a €', `document.getElementById('dash-today-sales').textContent.includes('€')`);

    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="USD"]').click()`);
    await esperar(200);
    await check('vuelta a USD', `document.getElementById('dash-today-sales').textContent.includes('$')`);

    // --- Fuente de la tasa BCV (Tasa USD / Tasa Euro) ----------------------
    await check('selector de tasa presente y por defecto Tasa USD',
        `document.getElementById('rate-source')?.value === 'usd'`);
    await check('badge con Tasa USD', `document.getElementById('rate-badge').textContent.includes('Tasa USD:')`);

    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="VES"]').click()`);
    await esperar(200);
    await evaluar(`window.__kpiUsd = document.getElementById('dash-today-sales').textContent; true`);
    await check('KPI en Bs con la tasa del dólar',
        `document.getElementById('dash-today-sales').textContent.includes('Bs')`);

    await evaluar(`(() => { const s = document.getElementById('rate-source'); s.value = 'eur'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await esperar(300);
    await check('badge con Tasa Euro', `document.getElementById('rate-badge').textContent.includes('Tasa Euro:')`);
    await check('selector refleja Tasa Euro', `document.getElementById('rate-source').value === 'eur'`);
    await check('el KPI en Bs cambia al elegir Tasa Euro',
        `JSON.stringify(document.getElementById('dash-today-sales').textContent) !== JSON.stringify(window.__kpiUsd)`);
    await check('la fuente quedó guardada en el estado',
        `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.rateSource === 'eur'`);

    // La vista en € usa la tasa cruzada: no depende de la fuente elegida.
    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="EUR"]').click()`);
    await esperar(200);
    await evaluar(`window.__kpiEur = document.getElementById('dash-today-sales').textContent; true`);
    await evaluar(`(() => { const s = document.getElementById('rate-source'); s.value = 'usd'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await esperar(300);
    await check('la vista en € no cambia con la fuente de la tasa',
        `JSON.stringify(document.getElementById('dash-today-sales').textContent) === JSON.stringify(window.__kpiEur)`);
    await check('el badge vuelve a Tasa USD',
        `document.getElementById('rate-badge').textContent.includes('Tasa USD:')`);

    // La fuente elegida sobrevive a F5
    await evaluar(`(() => { const s = document.getElementById('rate-source'); s.value = 'eur'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await esperar(150);
    await send('Page.navigate', { url: srv.url }, sessionId);
    await esperar(800);
    await check('tras F5 la fuente sigue en Tasa Euro',
        `document.getElementById('rate-source').value === 'eur' && document.getElementById('rate-badge').textContent.includes('Tasa Euro:')`);
    await evaluar(`(() => { const s = document.getElementById('rate-source'); s.value = 'usd'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await esperar(150);
    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="USD"]').click()`);
    await esperar(150);

    // La moneda elegida sobrevive a F5
    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="VES"]').click()`);
    await esperar(150);
    await send('Page.navigate', { url: srv.url }, sessionId);
    await esperar(800);
    await check('tras F5 la moneda sigue en Bs', `document.querySelector('[data-action="set-currency"].is-active').dataset.currency === 'VES' && document.getElementById('dash-today-sales').textContent.includes('Bs')`);
    await evaluar(`document.querySelector('[data-action="set-currency"][data-currency="USD"]').click()`);
    await esperar(150);

    // --- Tema (oscuro/claro/auto) ------------------------------------------
    await check('tema aplicado al arrancar', `['dark', 'light'].includes(document.documentElement.dataset.theme)`);
    await check('botón de tema presente con icono', `!!document.getElementById('theme-toggle')?.querySelector('i')`);
    await check('el tema vive en el sidebar', `document.querySelector('.sidebar__bottom').contains(document.getElementById('theme-toggle'))`);

    await evaluar(`document.getElementById('theme-toggle').click()`); // auto → dark
    await esperar(150);
    await check('primer clic → oscuro', `document.documentElement.dataset.theme === 'dark' && document.querySelector('#theme-toggle i').classList.contains('fa-moon')`);

    await evaluar(`document.getElementById('theme-toggle').click()`); // dark → light
    await esperar(150);
    await check('segundo clic → claro', `document.documentElement.dataset.theme === 'light' && document.querySelector('#theme-toggle i').classList.contains('fa-sun')`);

    await evaluar(`document.getElementById('theme-toggle').click()`); // light → auto
    await esperar(150);
    await check('tercer clic → auto con icono de escritorio',
        `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.theme === 'auto' && document.querySelector('#theme-toggle i').classList.contains('fa-desktop')`);

    // 'auto' sigue al sistema en vivo (listener de matchMedia en boot)
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
    await esperar(250);
    await check("'auto' reacciona al sistema (emulado dark → dark)", `document.documentElement.dataset.theme === 'dark'`);
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    await esperar(250);
    await check("'auto' vuelve al sistema (light)", `document.documentElement.dataset.theme === 'light'`);

    // F5: el script pre-paint del <head> debe restaurar el tema guardado
    await evaluar(`document.getElementById('theme-toggle').click()`); // auto → dark
    await esperar(150);
    await send('Page.navigate', { url: srv.url }, sessionId);
    await esperar(800);
    await check('tema persistido tras F5 (pre-paint)', `document.documentElement.dataset.theme === 'dark'`);
    // vuelve a auto para no arrastrar estado a los bloques siguientes
    await evaluar(`document.getElementById('theme-toggle').click(); document.getElementById('theme-toggle').click()`);
    await esperar(150);
    await check('vuelta a auto tras F5', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.theme === 'auto'`);
    await menuCerrado();

    // XSS: un nombre malicioso debe renderizarse como texto
    await evaluar(`
        document.getElementById('prod-name').value = '<img src=x onerror=alert(1)>';
        document.getElementById('prod-type').value = 'sale';
        document.getElementById('prod-unit').value = 'Unidades';
        document.getElementById('prod-stock').value = '5';
        document.getElementById('prod-min').value = '1';
        document.getElementById('prod-cost').value = '2';
        document.getElementById('prod-price').value = '9';
        document.getElementById('form-add-product').requestSubmit();
        true`);
    await esperar(300);
    await check('XSS escapado en inventario', `
        (() => {
            const celdas = [...document.querySelectorAll('#inventory-table-body td.cell-strong')];
            const conTextoMalicioso = celdas.some(td => td.textContent.includes('<img src=x'));
            const conImgReal = document.querySelectorAll('#inventory-table-body img').length > 0;
            return conTextoMalicioso && !conImgReal;
        })()`);

    await check('badge de tasa visible a 375px (ya no depende de ≥640)',
        `document.getElementById('rate-badge').offsetParent !== null`);

    // Móvil 375px: la bottom-nav debe estar visible
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 700, deviceScaleFactor: 2, mobile: true }, sessionId);
    await esperar(300);
    await check('bottom-nav visible en móvil', `
        (() => {
            const nav = document.querySelector('.sidebar__nav');
            const r = nav.getBoundingClientRect();
            return r.bottom > 0 && r.bottom <= 700 && r.top > 500;
        })()`);
    await check('bottom-nav solo iconos a 375px (etiqueta oculta, nombre accesible intacto)', `
        (() => {
            const s = document.querySelector('.sidebar__nav .nav-btn span');
            const cs = getComputedStyle(s);
            return cs.position === 'absolute' && parseFloat(cs.width) <= 1 && s.textContent.trim().length > 0;
        })()`);
    await check('bottom-nav sin scroll horizontal a 375px', `
        (() => {
            const nav = document.querySelector('.sidebar__nav');
            return nav.scrollWidth <= nav.clientWidth + 1;
        })()`);

    // --- Responsive: grids auto-fit + topbar + ultrawide --------------------
    await evaluar(`document.getElementById('nav-pos').click()`);
    await esperar(300);
    await check('catalog-grid 1 columna a 375px', `
        (() => {
            const c = [...document.querySelectorAll('.catalog-card')];
            if (c.length < 2) return false;
            return c[1].getBoundingClientRect().top > c[0].getBoundingClientRect().top;
        })()`);

    await evaluar(`document.getElementById('nav-dashboard').click()`);
    await esperar(300);
    await check('metrics-grid 1 columna a 375px', `
        (() => {
            const c = [...document.querySelectorAll('.metrics-grid .metric-card')];
            return c.length >= 4 && c[1].getBoundingClientRect().top > c[0].getBoundingClientRect().top;
        })()`);
    await check('topbar sin desborde a 375px', `
        (() => {
            const t = document.querySelector('.topbar');
            return t.scrollWidth <= t.clientWidth + 1;
        })()`);

    // Tablet portrait: aquí el badge de caja (≥640) y la nav con texto vuelven
    await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await esperar(300);
    await check('bottom-nav con texto en tablet (700px)',
        `getComputedStyle(document.querySelector('.sidebar__nav .nav-btn span')).position === 'static'`);
    await check('topbar sin desborde a 700px', `
        (() => {
            const t = document.querySelector('.topbar');
            return t.scrollWidth <= t.clientWidth + 1;
        })()`);
    await menuAbierto();
    await check('selector de tasa en el menú (700px)',
        `document.querySelector('.rate-source').offsetParent !== null`);

    // Bandas intermedias: 768–1023 (etiquetas ocultas) y 1024–1279 (compacto)
    // El selector de tasa ya no depende del ancho: vive en el menú.
    await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await esperar(300);
    await check('selector de tasa sigue en el menú a 768px',
        `document.querySelector('.rate-source').offsetParent !== null`);
    await menuCerrado();
    for (const ancho of [768, 900, 1100]) {
        await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
        await esperar(300);
        await check(`topbar sin desborde a ${ancho}px`, `
            (() => {
                const t = document.querySelector('.topbar');
                return t.scrollWidth <= t.clientWidth + 1;
            })()`);
    }

    // El umbral del bottom-nav es 1024: barra inferior en 900px, sidebar en 1100px
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await esperar(300);
    await check('bottom-nav visible a 900px (lateral oculto)', `
        (() => {
            const s = document.querySelector('.sidebar').getBoundingClientRect();
            return s.top > 700 && s.bottom <= 900;
        })()`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await esperar(300);
    await check('sidebar lateral visible a 1100px', `
        (() => {
            const s = document.querySelector('.sidebar').getBoundingClientRect();
            return s.left === 0 && s.top === 0 && s.height >= 800;
        })()`);

    // Ultrawide: el contenido se limita a ~1440px y los KPIs vuelven a 4 col
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await esperar(400);
    await check('view con tope ≤1440px a 1600px de ancho', `
        document.querySelector('.view:not(.is-hidden)').getBoundingClientRect().width <= 1441`);
    await check('metrics-grid en fila a 1600px (auto-fit)', `
        (() => {
            const c = [...document.querySelectorAll('.metrics-grid .metric-card')];
            return c.length >= 4 && Math.abs(c[3].getBoundingClientRect().top - c[0].getBoundingClientRect().top) < 2;
        })()`);

    // --- Reportes por fecha ------------------------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await evaluar(`document.getElementById('nav-commissions').click(); true`);
    await esperar(250);
    await evaluar(`document.querySelector('[data-action="report-commissions"]').click(); true`);
    await esperar(200);
    await check('reporte de comisiones lista al menos una venta del día', `
        document.querySelectorAll('#commissions-report-list tr td.cell-amount').length > 0`);

    await evaluar(`document.getElementById('nav-cash').click(); true`);
    await esperar(250);
    await check('historial de cortes visible sin filtro', `
        document.getElementById('cash-closures-list').textContent.includes('565.40')`);

    // --- CRUD: editar, borrar (permitido y bloqueado) -----------------------
    await evaluar(`document.getElementById('nav-inventory').click(); true`);
    await esperar(250);

    await evaluar(`
        document.querySelector('[data-action="edit-product"][data-id="p3"]').click();
        document.getElementById('prod-name').value = 'Shampoo Editado 300ml';
        document.getElementById('form-add-product').requestSubmit();
        true`);
    await esperar(250);
    await check('editar producto actualiza la tabla', `
        document.getElementById('inventory-table-body').textContent.includes('Shampoo Editado 300ml')`);

    // Borrar un producto de venta que ninguna receta usa (p4)
    await evaluar(`document.querySelector('[data-action="delete-product"][data-id="p4"]').click(); true`);
    await esperar(150);
    await check('el borrado abre el modal de confirmación', `
        !document.getElementById('modal-confirm').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('#modal-confirm [data-action="confirm-action"]').click(); true`);
    await esperar(250);
    await check('producto sin receta se elimina', `
        !document.getElementById('inventory-table-body').textContent.includes('Mascarilla Reparadora')`);

    // Borrar un insumo usado por una receta debe bloquearse (p1)
    await evaluar(`document.querySelector('[data-action="delete-product"][data-id="p1"]').click(); true`);
    await esperar(150);
    await evaluar(`document.querySelector('#modal-confirm [data-action="confirm-action"]').click(); true`);
    await esperar(250);
    await check('insumo con receta no se elimina', `
        document.getElementById('inventory-table-body').textContent.includes('Tinte Rubio Ceniza')`);

    // --- Configuración: CRUD de métodos de pago + comisión del rol ----------
    await evaluar(`document.getElementById('nav-settings').click(); true`);
    await esperar(200);
    await check('admin entra a Configuración (CRUD)', `!document.getElementById('tab-settings').classList.contains('is-hidden')`);

    // Agregar un método custom electrónico
    await evaluar(`
        document.getElementById('method-label').value = 'Zelle';
        document.getElementById('method-type').value = 'electronico';
        document.getElementById('form-payment-method').requestSubmit();
        true`);
    await esperar(200);
    await check('método custom agregado (5)', `document.querySelectorAll('#payment-methods-list tr').length === 5`);
    await check('el método se ve con su tipo', `(() => {
        const rows = [...document.querySelectorAll('#payment-methods-list tr')];
        const z = rows.find(r => r.textContent.includes('Zelle'));
        return z && z.textContent.includes('Electrónico');
    })()`);

    // Duplicado rechazado
    await evaluar(`
        document.getElementById('method-label').value = 'Zelle';
        document.getElementById('method-type').value = 'electronico';
        document.getElementById('form-payment-method').requestSubmit();
        true`);
    await esperar(200);
    await check('duplicado de método se rechaza', `[...document.querySelectorAll('#toast-stack .toast')].pop()?.textContent.includes('Ya existe') || false`);
    await check('sigue con 5 métodos', `document.querySelectorAll('#payment-methods-list tr').length === 5`);

    // Editar (renombrar) mantiene el id estable
    await evaluar(`document.querySelector('[data-action="edit-method"][data-id="zelle"]').click(); true`);
    await esperar(120);
    await check('edición precarga el formulario', `document.getElementById('method-label').value === 'Zelle' && document.getElementById('btn-method-save').textContent.includes('Guardar')`);
    await evaluar(`document.getElementById('method-label').value = 'Zelle US'; document.getElementById('form-payment-method').requestSubmit(); true`);
    await esperar(200);
    await check('método renombrado con id estable', `(() => {
        const txt = document.getElementById('payment-methods-list').textContent;
        return txt.includes('Zelle US') && ['Efectivo', 'Débito', 'Pago Móvil', 'Divisa'].every(x => txt.includes(x));
    })()`);

    // Efectivo es fijo (ni editar ni borrar)
    await check('efectivo no tiene botones Editar/Eliminar', `!document.querySelector('#payment-methods-list [data-action="delete-method"][data-id="cash"]') && !document.querySelector('#payment-methods-list [data-action="edit-method"][data-id="cash"]')`);

    // Borrar pide confirmación
    await evaluar(`document.querySelector('[data-action="delete-method"][data-id="zelle"]').click(); true`);
    await esperar(120);
    await check('borrar método pide confirmación', `!document.getElementById('modal-confirm').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('#modal-confirm [data-action="confirm-action"]').click(); true`);
    await esperar(250);
    await check('método eliminado (volvió a 4)', `document.querySelectorAll('#payment-methods-list tr').length === 4`);

    // Comisión global del rol
    await evaluar(`document.getElementById('commission-rate').value = '50'; document.getElementById('form-commission').requestSubmit(); true`);
    await esperar(200);
    await check('comisión del rol guardada', `JSON.parse(localStorage.getItem('samantha-spa-pos:v2')).settings.stylistCommissionRate === 50`);
    await check('la comisión se refleja en el formulario', `document.getElementById('commission-rate').value === '50'`);

    // --- Restaurar demo ----------------------------------------------------
    await evaluar(`document.querySelector('#tab-settings [data-op="reset-demo"]').click(); true`);
    await esperar(150);
    await check('restaurar demo pide confirmación', `
        !document.getElementById('modal-confirm').classList.contains('is-hidden')`);
    await evaluar(`document.querySelector('#modal-confirm [data-action="confirm-action"]').click(); true`);
    await esperar(300);
    await evaluar(`document.getElementById('nav-inventory').click(); true`);
    await esperar(250);
    await check('restaurar demo repone el inventario de fábrica', `
        (() => {
            const txt = document.getElementById('inventory-table-body').textContent;
            return txt.includes('Mascarilla Reparadora') && txt.includes('Tinte Rubio Ceniza') && !txt.includes('Shampoo Editado 300ml');
        })()`);

    console.log('\n--- CHECKS ---');
    for (const [estado, nombre, valor] of checks) console.log(`${estado}  ${nombre} → ${valor}`);

    console.log('\n--- ERRORES DE CONSOLA/RED ---');
    if (errores.length === 0) console.log('(ninguno)');
    else errores.forEach(e => console.log(e));

    const fallos = checks.filter(c => c[0] === 'FALLO');
    console.log(`\nresultado: ${checks.length - fallos.length}/${checks.length} checks, ${errores.length} errores`);
    console.log(fallos.length === 0 && errores.length === 0 ? 'SMOKE OK' : 'SMOKE CON FALLOS');

    ws.close();
    chr.proc.kill();
    srv.proc.kill();
    process.exit(fallos.length === 0 && errores.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
