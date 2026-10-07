import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEY, LEGACY_STORAGE_KEY, STORAGE_BACKUP_KEY, STORAGE_DEMO_BACKUP_KEY } from '../js/core/config.js';
import { createSeedState } from '../js/core/seed.js';
import {
    loadState, saveState, normalizeState, restoreDemo, createMemoryBackend
} from '../js/core/storage.js';

test('round trip: guardar y cargar devuelve el mismo estado', () => {
    const backend = createMemoryBackend();
    const state = createSeedState();
    state.transactions.push({
        id: 'TX-ABC-1', date: new Date().toISOString(), time: '10:00',
        staffId: 'st1', staffName: 'Valeria Gómez',
        items: [{ type: 'service', qty: 1 }],
        subtotal: 65, tax: 10.4, total: 75.4, commission: 32.5
    });
    state.currentTicket.items.push({ type: 'service', id: 's1', name: 'Tinte', price: 65, qty: 2 });

    assert.equal(saveState(state, backend), true);

    const { state: cargado, recovered } = loadState(backend);
    assert.equal(recovered, null);
    assert.equal(cargado.transactions.length, 1);
    assert.equal(cargado.transactions[0].id, 'TX-ABC-1');
    assert.equal(cargado.currentTicket.items[0].qty, 2);
});

test('JSON corrupto: respalda la cadena cruda y arranca de semilla', () => {
    const backend = createMemoryBackend({ [STORAGE_KEY]: '{esto no es json' });

    const { state, recovered } = loadState(backend);

    assert.equal(recovered, 'corrupto');
    assert.equal(backend.getItem(STORAGE_BACKUP_KEY), '{esto no es json');
    assert.equal(state.products.length, createSeedState().products.length);
});

test('JSON válido pero con la forma rota: normaliza en vez de romper', () => {
    const backend = createMemoryBackend({
        [STORAGE_KEY]: JSON.stringify({
            staff: [
                { id: 'st1', name: 'Valeria Gómez', commissionRate: 50, totalCommissions: 0, salesCount: 0 },
                { id: 'st2', name: null } // entrada inválida: fuera
            ],
            products: 'no soy un array',
            services: [{ id: 's9', name: 'Masaje', price: 40, recipe: [{ productId: 'no-existe', amount: 5 }] }],
            currentTicket: 'basura',
            transactions: [{ id: 'TX-X', date: 'fecha-ilegible' }],
            posFilterCategory: 'otra-cosa'
        })
    });

    const { state, recovered } = loadState(backend);

    assert.equal(recovered, null); // el JSON parsea: no es "corrupto"
    assert.equal(state.staff.length, 1, 'la entrada sin nombre se descarta');
    assert.equal(state.staff[0].commissionRate, 50);
    assert.deepEqual(state.products, createSeedState().products, 'products no era array → semilla');
    assert.equal(state.services[0].recipe.length, 0, 'receta con producto inexistente → fuera');
    assert.equal(state.currentTicket.items.length, 0, 'ticket basura → vacío');
    assert.equal(state.transactions.length, 0, 'fecha ilegible → fuera');
    assert.equal(state.posFilterCategory, 'all');
});

test('normalizeState: migra productos retail→sale y pagos card→debit', () => {
    const state = normalizeState({
        products: [{ id: 'p1', name: 'Shampoo', type: 'retail', unit: 'Unidades', stock: 3, minStock: 1, cost: 5, price: 10 }],
        transactions: [{
            id: 'TX-1', date: '2026-10-06T10:00:00.000Z', total: 20, method: 'card'
        }],
        currentTicket: {
            items: [],
            payments: [{ method: 'card', amountUSD: 5 }, { method: 'nope', amountUSD: 1 }]
        }
    });

    assert.equal(state.products[0].type, 'sale');
    assert.equal(state.transactions[0].method, 'debit');
    assert.deepEqual(state.transactions[0].payments, [{ method: 'debit', amountUSD: 20 }], 'sin detalle se sintetiza el pago');
    assert.deepEqual(state.currentTicket.payments, [{ method: 'debit', amountUSD: 5 }], 'pagando inválido se descarta');
});

test('sin backend disponible: semilla y recovered sin-storage', () => {
    const { state, recovered } = loadState(null);
    assert.equal(recovered, 'sin-storage');
    assert.equal(state.staff.length, 3);
    assert.equal(saveState(state, null), false);
});

test('normalizeState nunca lanza con entradas basura', () => {
    const basuras = [null, undefined, 42, 'texto', [], { staff: 'x', products: 3 }];
    for (const basura of basuras) {
        assert.doesNotThrow(() => normalizeState(basura));
    }
});

/* ------------------------------------------------------------ migración -- */

const estadoV1 = {
    staff: [{ id: 'st1', name: 'Valeria Gómez', role: 'Colorista Senior', commissionRate: 50, totalCommissions: 0, salesCount: 0 }],
    products: [{ id: 'p1', name: 'Tinte', type: 'internal', unit: 'Gramos', stock: 500, minStock: 100, cost: 0.08, price: 0 }],
    services: [{ id: 's1', name: 'Tinte Completo', price: 65, recipe: [] }],
    currentTicket: {
        items: [{ type: 'service', id: 's1', name: 'Tinte Completo', price: 65, qty: 2 }],
        staffId: 'st1'
    },
    transactions: [{
        id: 'TX-OLD-1', date: '2026-10-01T10:00:00.000Z', time: '10:00',
        staffId: 'st1', staffName: 'Valeria Gómez',
        items: [{ type: 'service', qty: 1 }],
        subtotal: 65, tax: 10.4, total: 75.4, commission: 32.5
    }],
    posFilterCategory: 'service'
};

test('migración v1 → v2: conserva las ventas y añade las colecciones nuevas', () => {
    const v1Text = JSON.stringify(estadoV1);
    const backend = createMemoryBackend({ [LEGACY_STORAGE_KEY]: v1Text });

    const { state, recovered } = loadState(backend);

    assert.equal(recovered, 'migrado');
    // v2 escrita con los datos antiguos dentro
    const v2 = JSON.parse(backend.getItem(STORAGE_KEY));
    assert.equal(v2.transactions.length, 1);
    assert.equal(v2.transactions[0].id, 'TX-OLD-1');
    // v1 intacta: sirve de respaldo
    assert.equal(backend.getItem(LEGACY_STORAGE_KEY), v1Text);
    // colecciones nuevas presentes
    assert.equal(state.users.length, 4);
    assert.ok(state.users.some(u => u.role === 'admin' && u.active));
    assert.deepEqual(state.settings, {
        currency: 'USD',
        theme: 'auto',
        rateSource: 'usd',
        ticket: {
            printerWidth: 58,
            businessName: 'Samantha Spa',
            businessLine: 'Sucursal Principal',
            footer: '¡Gracias por su preferencia!',
            showPrices: true
        }
    });
    assert.equal(state.cashSession.open, false);
    assert.deepEqual(state.closures, []);
    // el ticket viejo sigue siendo válido
    assert.equal(state.currentTicket.items[0].qty, 2);
});

test('migración: si ya existe v2, la v1 se ignora', () => {
    const backend = createMemoryBackend({
        [STORAGE_KEY]: JSON.stringify({ ...estadoV1, posFilterCategory: 'retail' }),
        [LEGACY_STORAGE_KEY]: JSON.stringify(estadoV1)
    });

    const { state, recovered } = loadState(backend);

    assert.equal(recovered, null);
    assert.equal(state.posFilterCategory, 'sale', 'el filtro "retail" viejo se migra a "sale"');
});

test('migración: v1 corrupta → respaldo y semilla (no queda a medias)', () => {
    const backend = createMemoryBackend({ [LEGACY_STORAGE_KEY]: '{roto' });

    const { state, recovered } = loadState(backend);

    assert.equal(recovered, 'corrupto');
    assert.equal(backend.getItem(STORAGE_BACKUP_KEY), '{roto');
    assert.equal(state.users.length, 4);
});

/* --------------------------------------------------------- normalización -- */

test('normalizeState: usuarios (dedupe, roles, staffId colgante)', () => {
    const state = normalizeState({
        users: [
            { id: 'u1', name: '  Admin  ', username: 'ADMIN', role: 'admin', pinHash: 'fnv1a:aa', salt: 's1', active: true, staffId: null },
            { id: 'u2', name: 'Dup', username: 'admin', role: 'stylist', pinHash: 'fnv1a:bb', salt: 's2' },
            { id: 'u3', name: 'SinHash', username: 'sinhash', role: 'stylist', salt: 's3' },
            { id: 'u4', name: 'Carlos', username: 'carlos', role: 'otro', pinHash: 'fnv1a:cc', salt: 's4', staffId: 'no-existe' }
        ]
    });

    assert.equal(state.users.length, 2, 'duplicado y sin hash se descartan');
    assert.equal(state.users[0].name, 'Admin');
    assert.equal(state.users[0].username, 'admin');
    assert.equal(state.users[0].role, 'admin');
    assert.equal(state.users[1].role, 'stylist', 'rol inválido → stylist');
    assert.equal(state.users[1].active, true, 'active ausente → true');
    assert.equal(state.users[1].staffId, null, 'staffId sin estilista detrás → null');
});

test('normalizeState: sin admin activo se recupera; usuarios basura → semilla', () => {
    const reactivado = normalizeState({
        users: [
            { id: 'u1', name: 'Admin', username: 'admin', role: 'admin', pinHash: 'fnv1a:aa', salt: 's1', active: false },
            { id: 'u9', name: 'Val', username: 'valeria', role: 'stylist', pinHash: 'fnv1a:bb', salt: 's2', active: true }
        ]
    });
    assert.equal(reactivado.users.find(u => u.username === 'admin').active, true, 'último admin desactivado → se reactiva');

    assert.equal(normalizeState({ users: 'basura' }).users.length, 4, 'no array → semilla');
    assert.equal(normalizeState({ users: [] }).users.length, 4, 'lista vacía → semilla');
});

test('normalizeState: ajustes, sesión de caja y cierres', () => {
    const state = normalizeState({
        settings: { currency: 'BTC' },
        cashSession: {
            open: true, // sin openedAt legible → debe quedar cerrada
            fondoInicial: 'x',
            withdrawals: [
                { amount: 20, note: 'Gaso', at: '2026-10-06T12:00:00.000Z', by: 'u1' },
                { amount: -5, note: 'negativo', at: '2026-10-06T12:00:00.000Z', by: 'u1' },
                { amount: 10, at: 'fecha-ilegible' }
            ]
        },
        closures: [
            { id: 'c1', closedAt: '2026-10-05T18:00:00.000Z', diferenciaUSD: -3.5, ventas: { cash: 50 }, rates: { usdBs: 900 } },
            { id: 'c2', closedAt: 'ilegible' }
        ]
    });

    assert.deepEqual(state.settings, {
        currency: 'USD',
        theme: 'auto',
        rateSource: 'usd',
        ticket: {
            printerWidth: 58,
            businessName: 'Samantha Spa',
            businessLine: 'Sucursal Principal',
            footer: '¡Gracias por su preferencia!',
            showPrices: true
        }
    }, 'moneda desconocida → USD');
    assert.equal(state.cashSession.open, false);
    assert.equal(state.cashSession.fondoInicial, 0);
    assert.equal(state.cashSession.withdrawals.length, 1, 'monto negativo y fecha mala se descartan');
    assert.equal(state.cashSession.withdrawals[0].amount, 20);
    assert.equal(state.closures.length, 1, 'cierre con fecha ilegible se descarta');
    assert.equal(state.closures[0].diferenciaUSD, -3.5, 'la diferencia negativa se conserva');
    assert.equal(state.closures[0].ventas.debit, 0, 'ventas faltantes → 0');
    assert.equal(state.closures[0].ventas.divisa, 0, 'los métodos nuevos también arrancan en 0');
    assert.equal(state.closures[0].rates.eurBs, null, 'tasas faltantes → null');
});

test('normalizeState: configuración del ticket de canje', () => {
    const defaults = normalizeState({}).settings.ticket;
    assert.deepEqual(defaults, {
        printerWidth: 58,
        businessName: 'Samantha Spa',
        businessLine: 'Sucursal Principal',
        footer: '¡Gracias por su preferencia!',
        showPrices: true
    });

    const custom = normalizeState({
        settings: { ticket: { printerWidth: 80, businessName: '  Mi Spa  ', showPrices: false } }
    }).settings.ticket;
    assert.equal(custom.printerWidth, 80);
    assert.equal(custom.businessName, 'Mi Spa');
    assert.equal(custom.showPrices, false);

    assert.equal(normalizeState({ settings: { ticket: { printerWidth: 42 } } }).settings.ticket.printerWidth, 58,
        'ancho inválido → 58');
});

test('normalizeState: tasa BCV de referencia', () => {
    assert.equal(normalizeState({}).settings.rateSource, 'usd', 'ausente → tasa USD (default)');
    assert.equal(normalizeState({ settings: { rateSource: 'eur' } }).settings.rateSource, 'eur', 'eur se conserva');
    assert.equal(normalizeState({ settings: { rateSource: 'EUR' } }).settings.rateSource, 'usd', 'case distinto → default');
    assert.equal(normalizeState({ settings: { rateSource: 'btc' } }).settings.rateSource, 'usd', 'desconocida → default');
    assert.equal(normalizeState({ settings: 'basura' }).settings.rateSource, 'usd', 'settings basura → default');
});

test('normalizeState: snapshot de ítems de una venta', () => {
    const state = normalizeState({
        transactions: [{
            id: 'TX-1', date: '2026-10-06T10:00:00.000Z', time: '10:00',
            staffId: 'st1', staffName: 'Valeria',
            items: [
                { type: 'service', id: 's1', name: 'Tinte', price: 65, qty: 2, staffId: 'st1', staffName: 'Valeria' },
                { type: 'product', qty: 1 }, // viejo sin detalle
                { type: 'basura', name: 'x', price: 1, qty: 1 } // se descarta
            ],
            total: 100, method: 'cash'
        }]
    });

    const items = state.transactions[0].items;
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { type: 'service', id: 's1', name: 'Tinte', price: 65, qty: 2, staffId: 'st1', staffName: 'Valeria' });
    assert.deepEqual(items[1], { type: 'product', id: null, name: null, price: null, qty: 1, staffId: null, staffName: null });
});

test('normalizeState: tema', () => {
    assert.equal(normalizeState({ settings: { theme: 'dark' } }).settings.theme, 'dark', 'dark se conserva');
    assert.equal(normalizeState({ settings: { theme: 'light' } }).settings.theme, 'light', 'light se conserva');
    assert.equal(normalizeState({ settings: { theme: 'auto' } }).settings.theme, 'auto', 'auto se conserva');
    assert.equal(normalizeState({ settings: { theme: 'neon' } }).settings.theme, 'auto', 'tema desconocido → auto');
    assert.equal(normalizeState({ settings: { currency: 'EUR' } }).settings.theme, 'auto', 'tema ausente → auto');
    assert.equal(normalizeState({ settings: 'basura' }).settings.theme, 'auto', 'settings basura → auto');
    assert.equal(normalizeState({}).settings.theme, 'auto', 'settings ausente → auto');
});

test('round trip del tema', () => {
    const backend = createMemoryBackend();
    const state = createSeedState();
    state.settings.theme = 'light';

    assert.equal(saveState(state, backend), true);
    const { state: cargado, recovered } = loadState(backend);

    assert.equal(recovered, null);
    assert.equal(cargado.settings.theme, 'light');
    assert.equal(cargado.settings.currency, 'USD');
});

test('round trip de las colecciones nuevas', () => {
    const backend = createMemoryBackend();
    const state = createSeedState();
    state.settings.currency = 'VES';
    state.cashSession = {
        open: true, openedAt: '2026-10-06T09:00:00.000Z', fondoInicial: 20,
        withdrawals: [{ amount: 5, note: 'Papelería', at: '2026-10-06T10:00:00.000Z', by: 'u1' }]
    };
    state.closures.push({
        id: 'c1', closedAt: '2026-10-05T18:00:00.000Z', closedById: 'u1', closedByName: 'Administrador',
        openedAt: '2026-10-05T09:00:00.000Z',
        fondoInicial: 20, ventas: { cash: 50, debit: 30, pago_movil: 0, divisa: 0, other: 0 }, totalUSD: 80,
        retirosUSD: 5, esperadoUSD: 65, contadoUSD: 65, diferenciaUSD: 0, txCount: 3,
        rates: { usdBs: 872.4, eurBs: 977.2, fecha: '2026-10-06T00:00:00-04:00' }
    });

    assert.equal(saveState(state, backend), true);
    const { state: cargado, recovered } = loadState(backend);

    assert.equal(recovered, null);
    assert.equal(cargado.settings.currency, 'VES');
    assert.deepEqual(cargado.cashSession, state.cashSession);
    assert.deepEqual(cargado.closures, state.closures);
    assert.equal(cargado.users.length, 4);
});

test('restoreDemo respalda el estado actual y devuelve la semilla', () => {
    const backend = createMemoryBackend();
    const state = createSeedState();
    state.products[0].name = 'Producto con historial';
    state.closures.push({
        id: 'c1', closedAt: '2026-10-05T18:00:00.000Z', closedById: 'u1', closedByName: 'Administrador',
        openedAt: '2026-10-05T09:00:00.000Z', fondoInicial: 20, ventas: { cash: 50, debit: 30, pago_movil: 0, divisa: 0, other: 0 },
        totalUSD: 80, retirosUSD: 5, esperadoUSD: 65, contadoUSD: 65, diferenciaUSD: 0, txCount: 3,
        rates: { usdBs: 872.4, eurBs: 977.2, fecha: '2026-10-06T00:00:00-04:00' }
    });
    saveState(state, backend);
    const prev = backend.getItem(STORAGE_KEY);

    const seed = restoreDemo(backend);

    assert.deepEqual(seed, createSeedState());
    assert.equal(backend.getItem(STORAGE_DEMO_BACKUP_KEY), prev, 'el estado previo queda respaldado');
    assert.equal(backend.getItem(STORAGE_KEY), JSON.stringify(seed), 'la clave principal queda en semilla');
    const { state: cargado, recovered } = loadState(backend);
    assert.equal(recovered, null);
    assert.equal(cargado.closures.length, 0);
    assert.equal(cargado.products[0].name, 'Tinte Rubio Ceniza 8.1');
});

test('restoreDemo sin storage previo no guarda respaldo fantasma', () => {
    const backend = createMemoryBackend();
    const seed = restoreDemo(backend);

    assert.deepEqual(seed, createSeedState());
    assert.equal(backend.getItem(STORAGE_DEMO_BACKUP_KEY), null);
    assert.equal(backend.getItem(STORAGE_KEY), JSON.stringify(seed));
});
