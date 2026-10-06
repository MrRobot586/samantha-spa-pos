/* Persistencia en localStorage con normalización.
 *
 * Dos reglas importantes:
 *  1. El backend es inyectable: en producción usa localStorage, en tests una
 *     memoria falsa. Así esta capa se puede probar en node sin DOM.
 *  2. Nada de lo que salga de localStorage se da por bueno: el JSON se
 *     normaliza campo a campo (tipos, rangos, ids coherentes). Si el JSON no
 *     parsea, se guarda una copia cruda en STORAGE_BACKUP_KEY — nunca se
 *     borra a ciegas el historial de una caja — y se arranca de semilla.
 *  3. Si falta la clave actual (v2) pero existe la anterior (v1), los datos
 *     se leen desde v1, se normalizan y se guardan como v2. La v1 queda
 *     intacta: sirve de respaldo y cualquier día se puede volver atrás.
 */

import { STORAGE_KEY, LEGACY_STORAGE_KEY, STORAGE_BACKUP_KEY, CURRENCIES, THEMES } from './config.js';
import { createSeedState } from './seed.js';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

const num = (v, min = 0) => (isNum(v) && v >= min ? v : null);
const str = v => (typeof v === 'string' ? v : null);
/** Número que puede ser negativo (diferencias de caja). */
const signed = v => (isNum(v) ? v : 0);
const validDate = v => nonEmpty(v) && !Number.isNaN(new Date(v).getTime());

function normalizeStaff(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const clean = list
        .filter(s => isObject(s) && nonEmpty(s.id) && nonEmpty(s.name))
        .map(s => ({
            id: s.id,
            name: s.name,
            role: str(s.role) || 'Estilista',
            commissionRate: num(s.commissionRate, 0) ?? 0,
            totalCommissions: num(s.totalCommissions, 0) ?? 0,
            salesCount: num(s.salesCount, 0) ?? 0
        }));
    return clean.length || list.length === 0 ? clean : fallback;
}

function normalizeProducts(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const clean = list
        .filter(p => isObject(p) && nonEmpty(p.id) && nonEmpty(p.name))
        .map(p => ({
            id: p.id,
            name: p.name,
            type: p.type === 'internal' ? 'internal' : 'retail',
            unit: str(p.unit) || 'Unidades',
            stock: num(p.stock, 0) ?? 0,
            minStock: num(p.minStock, 0) ?? 0,
            cost: num(p.cost, 0) ?? 0,
            price: num(p.price, 0) ?? 0
        }));
    return clean.length || list.length === 0 ? clean : fallback;
}

function normalizeServices(list, fallback, products) {
    if (!Array.isArray(list)) return fallback;
    const clean = list
        .filter(s => isObject(s) && nonEmpty(s.id) && nonEmpty(s.name) && num(s.price, 0) !== null)
        .map(s => ({
            id: s.id,
            name: s.name,
            price: s.price,
            recipe: (Array.isArray(s.recipe) ? s.recipe : [])
                .filter(r => isObject(r) && nonEmpty(r.productId) && num(r.amount, 0.0001) !== null)
                .map(r => ({ productId: r.productId, amount: r.amount }))
                .filter(r => products.some(p => p.id === r.productId))
        }));
    return clean.length || list.length === 0 ? clean : fallback;
}

function normalizeTicket(raw, staff, products, services) {
    const fallback = { items: [], staffId: staff[0]?.id ?? '', paymentMethod: 'cash' };
    if (!isObject(raw)) return fallback;

    const items = (Array.isArray(raw.items) ? raw.items : [])
        .filter(i => isObject(i) && (i.type === 'service' || i.type === 'product'))
        .filter(i => nonEmpty(i.id) && num(i.price, 0) !== null && num(i.qty, 1) !== null && i.qty >= 1)
        .map(i => ({
            type: i.type,
            id: i.id,
            name: str(i.name) || i.id,
            price: i.price,
            qty: Math.floor(i.qty)
        }))
        // Un ítem sin catálogo detrás no se puede cobrar: fuera.
        .filter(i => i.type === 'service'
            ? services.some(s => s.id === i.id)
            : products.some(p => p.id === i.id));

    const staffId = staff.some(s => s.id === raw.staffId) ? raw.staffId : fallback.staffId;
    const paymentMethod = ['cash', 'card', 'other'].includes(raw.paymentMethod)
        ? raw.paymentMethod
        : 'cash';
    return { items, staffId, paymentMethod };
}

function normalizeTransactions(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter(t => isObject(t) && nonEmpty(t.id) && nonEmpty(t.date))
        .filter(t => !Number.isNaN(new Date(t.date).getTime()))
        .map(t => {
            const total = num(t.total, 0) ?? 0;
            const method = ['cash', 'card', 'other'].includes(t.method) ? t.method : 'cash';
            // Ventas viejas sin recibido: se asume pago exacto.
            const receivedUSD = Math.max(total, num(t.receivedUSD, 0) ?? total);
            const changeUSD = Math.max(0, num(t.changeUSD, 0) ?? 0);
            return {
                id: t.id,
                date: t.date,
                time: str(t.time) || '',
                staffId: str(t.staffId) || '',
                staffName: str(t.staffName) || 'N/A',
                items: (Array.isArray(t.items) ? t.items : [])
                    .filter(i => isObject(i) && (i.type === 'service' || i.type === 'product'))
                    .map(i => ({ type: i.type, qty: num(i.qty, 1) ?? 1 })),
                subtotal: num(t.subtotal, 0) ?? 0,
                tax: num(t.tax, 0) ?? 0,
                total,
                commission: num(t.commission, 0) ?? 0,
                method,
                receivedUSD,
                changeUSD,
                rates: isObject(t.rates)
                    ? {
                        usdBs: num(t.rates.usdBs, 0.0001) ?? null,
                        eurBs: num(t.rates.eurBs, 0.0001) ?? null,
                        fecha: str(t.rates.fecha) || null
                    }
                    : { usdBs: null, eurBs: null, fecha: null }
            };
        });
}

/** Usuarios: usernames únicos en minúsculas, roles válidos, salt+hash
 *  obligatorios. Nunca se devuelve una lista sin al menos un admin activo:
 *  si la lista guardada lo perdió, se repone el de la semilla para no
 *  dejar la app sin nadie que pueda entrar y administrarla. */
function normalizeUsers(list, fallback, staff) {
    if (!Array.isArray(list)) return fallback;

    const seen = new Set();
    const clean = [];
    for (const u of list) {
        if (!isObject(u) || !nonEmpty(u.id) || !nonEmpty(u.name) || !nonEmpty(u.username)) continue;
        if (!nonEmpty(u.pinHash) || !nonEmpty(u.salt)) continue;
        const username = u.username.trim().toLowerCase();
        if (seen.has(username)) continue;
        seen.add(username);
        clean.push({
            id: u.id,
            name: u.name.trim(),
            username,
            role: u.role === 'admin' ? 'admin' : 'stylist',
            pinHash: u.pinHash,
            salt: u.salt,
            active: u.active !== false,
            staffId: staff.some(s => s.id === u.staffId) ? u.staffId : null
        });
    }

    if (clean.length === 0) return fallback;
    if (!clean.some(u => u.role === 'admin' && u.active)) {
        const existing = clean.find(u => u.role === 'admin');
        if (existing) {
            existing.active = true;
        } else {
            const seedAdmin = fallback.find(f => f.role === 'admin' && f.active);
            if (seedAdmin && !seen.has(seedAdmin.username)) clean.push(seedAdmin);
            else return fallback;
        }
    }
    return clean;
}

function normalizeSettings(raw) {
    const currency = isObject(raw) && CURRENCIES.includes(raw.currency) ? raw.currency : 'USD';
    const theme = isObject(raw) && THEMES.includes(raw.theme) ? raw.theme : 'auto';
    return { currency, theme };
}

function normalizeCashSession(raw) {
    const closed = { open: false, openedAt: null, fondoInicial: 0, withdrawals: [] };
    if (!isObject(raw)) return closed;

    const withdrawals = (Array.isArray(raw.withdrawals) ? raw.withdrawals : [])
        .filter(w => isObject(w) && num(w.amount, 0.01) !== null && validDate(w.at))
        .map(w => ({
            amount: w.amount,
            note: str(w.note) || '',
            at: w.at,
            by: str(w.by) || 'N/A'
        }));

    // Sin fecha de apertura legible no hay período posible: caja cerrada.
    const openedAt = validDate(raw.openedAt) ? raw.openedAt : null;
    return {
        open: raw.open === true && openedAt !== null,
        openedAt,
        fondoInicial: num(raw.fondoInicial, 0) ?? 0,
        withdrawals
    };
}

function normalizeClosures(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter(c => isObject(c) && nonEmpty(c.id) && validDate(c.closedAt))
        .map(c => {
            const ventas = isObject(c.ventas) ? c.ventas : {};
            const rates = isObject(c.rates) ? c.rates : {};
            return {
                id: c.id,
                openedAt: validDate(c.openedAt) ? c.openedAt : null,
                closedAt: c.closedAt,
                closedById: str(c.closedById) || '',
                closedByName: str(c.closedByName) || 'N/A',
                fondoInicial: num(c.fondoInicial, 0) ?? 0,
                ventas: {
                    cash: num(ventas.cash, 0) ?? 0,
                    card: num(ventas.card, 0) ?? 0,
                    other: num(ventas.other, 0) ?? 0
                },
                totalUSD: num(c.totalUSD, 0) ?? 0,
                retirosUSD: num(c.retirosUSD, 0) ?? 0,
                esperadoUSD: num(c.esperadoUSD, 0) ?? 0,
                contadoUSD: num(c.contadoUSD, 0) ?? 0,
                diferenciaUSD: signed(c.diferenciaUSD),
                txCount: num(c.txCount, 0) ?? 0,
                rates: {
                    usdBs: num(rates.usdBs, 0.0001) ?? null,
                    eurBs: num(rates.eurBs, 0.0001) ?? null,
                    fecha: str(rates.fecha) || null
                }
            };
        });
}

/** Convierte cualquier JSON leído en un estado válido. Nunca lanza. */
export function normalizeState(raw) {
    const seed = createSeedState();
    if (!isObject(raw)) return seed;

    const products = normalizeProducts(raw.products, seed.products);
    const services = normalizeServices(raw.services, seed.services, products);
    const staff = normalizeStaff(raw.staff, seed.staff);

    return {
        users: normalizeUsers(raw.users, seed.users, staff),
        settings: normalizeSettings(raw.settings),
        cashSession: normalizeCashSession(raw.cashSession),
        closures: normalizeClosures(raw.closures),
        staff,
        products,
        services,
        currentTicket: normalizeTicket(raw.currentTicket, staff, products, services),
        transactions: normalizeTransactions(raw.transactions),
        posFilterCategory: ['all', 'service', 'retail'].includes(raw.posFilterCategory)
            ? raw.posFilterCategory
            : 'all'
    };
}

/** Backend por defecto: localStorage si existe (browser), null si no. */
export function defaultBackend() {
    try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage;
    } catch {
        // Acceso a localStorage puede lanzar (privacy mode). Sin persistencia.
    }
    return null;
}

/** Backend en memoria para tests. */
export function createMemoryBackend(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: key => { map.delete(key); },
        keys: () => [...map.keys()]
    };
}

/**
 * Carga y normaliza el estado. Si la clave v2 no existe pero sí la v1
 * (esquema anterior sin usuarios/cierre de caja), los datos se migran a v2
 * y la v1 se conserva intacta como respaldo.
 * @returns {{state: object, recovered: null | 'sin-storage' | 'corrupto' | 'migrado'}}
 */
export function loadState(backend = defaultBackend()) {
    if (!backend) return { state: normalizeState(null), recovered: 'sin-storage' };

    let rawText = backend.getItem(STORAGE_KEY);
    let migradoDesdeV1 = false;
    if (rawText === null || rawText === undefined || rawText === '') {
        const legacy = backend.getItem(LEGACY_STORAGE_KEY);
        if (legacy !== null && legacy !== undefined && legacy !== '') {
            rawText = legacy;
            migradoDesdeV1 = true;
        }
    }
    if (rawText === null || rawText === undefined || rawText === '') {
        return { state: normalizeState(null), recovered: null };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        // JSON roto: respaldar la cadena cruda y arrancar de semilla.
        try { backend.setItem(STORAGE_BACKUP_KEY, rawText); } catch { /* sin espacio */ }
        return { state: normalizeState(null), recovered: 'corrupto' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        try { backend.setItem(STORAGE_BACKUP_KEY, rawText); } catch { /* sin espacio */ }
        return { state: normalizeState(null), recovered: 'corrupto' };
    }

    const state = normalizeState(parsed);
    if (migradoDesdeV1) {
        saveState(state, backend); // la v1 queda donde está, como respaldo
        return { state, recovered: 'migrado' };
    }
    return { state, recovered: null };
}

/** Guarda el estado. Devuelve false si falla (cuota llena, sin backend). */
export function saveState(state, backend = defaultBackend()) {
    if (!backend) return false;
    try {
        backend.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}
