/* Tasas de cambio en vivo (BCV vía ve.dolarapi.com) y formato multi-moneda.
 *
 * Los precios SIEMPRE se guardan en USD: Bs y € son solo visualización
 * derivada (settings.currency), nunca se reescribe lo almacenado.
 *
 * La tasa llega de la API, se cachea en localStorage y se pinta primero la
 * caché (*stale-while-revalidate*): si no hay red, se usa la última guardada
 * y el badge lo indica. La API es gratuita, sin clave, con CORS abierto. */

import { RATES_KEY } from './config.js';
import { getState } from './state.js';
import { defaultBackend } from './storage.js';

const API_URL = 'https://ve.dolarapi.com/v1/cotizaciones';

/** Validez de la caché: 1 hora (el BCV publica una vez al día). */
export const RATES_TTL = 60 * 60 * 1000;

let snapshot = { usdBs: null, eurBs: null, fecha: null, fetchedAt: 0, offline: false };

/** Copia del snapshot actual, para guardarla dentro de una transacción. */
export function getSnapshot() {
    return { ...snapshot };
}

function isPositive(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Normaliza la respuesta de la API. Devuelve null si no trae tasas
 *  utilizables (payload roto o cambiado por el proveedor). */
export function normalizeRates(payload, fetchedAt = Date.now()) {
    if (!Array.isArray(payload)) return null;
    const usd = payload.find(c => c && c.moneda === 'USD');
    const eur = payload.find(c => c && c.moneda === 'EUR');
    const usdBs = Number(usd && usd.promedio);
    const eurBs = Number(eur && eur.promedio);
    if (!isPositive(usdBs) || !isPositive(eurBs)) return null;

    const fecha = usd && typeof usd.fechaActualizacion === 'string'
        ? usd.fechaActualizacion
        : null;
    return { usdBs, eurBs, fecha, fetchedAt, offline: false };
}

/** Convierte un monto en USD a la moneda dada; sin tasa válida se queda en USD. */
export function convert(usd, currency, rates = snapshot) {
    const amount = Number.isFinite(usd) ? usd : 0;
    if (currency === 'VES' && isPositive(rates && rates.usdBs)) {
        return amount * rates.usdBs;
    }
    if (currency === 'EUR' && isPositive(rates && rates.usdBs) && isPositive(rates && rates.eurBs)) {
        return (amount * rates.usdBs) / rates.eurBs;
    }
    return amount;
}

/** Inverso de convert: monto en la moneda dada → USD (p. ej. el efectivo
 *  recibido se ingresa en la moneda activa pero se guarda en USD). */
export function toUSD(amount, currency, rates = snapshot) {
    const n = Number.isFinite(amount) ? amount : 0;
    if (currency === 'VES' && isPositive(rates && rates.usdBs)) {
        return n / rates.usdBs;
    }
    if (currency === 'EUR' && isPositive(rates && rates.usdBs) && isPositive(rates && rates.eurBs)) {
        return (n * rates.eurBs) / rates.usdBs;
    }
    return n;
}

/**
 * Formato monetario en la moneda activa (base USD).
 * USD conserva el formato histórico `$1,234.56` — es el que se usaba antes
 * de la multi-moneda y lo que esperan los datos y el checklist.
 */
export function formatMoney(usd, currency = getState().settings.currency, rates = snapshot) {
    const n = Number.isFinite(usd) ? usd : 0;

    if (currency === 'VES' && isPositive(rates && rates.usdBs)) {
        return 'Bs ' + convert(n, 'VES', rates).toLocaleString('es-VE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    if (currency === 'EUR' && isPositive(rates && rates.usdBs) && isPositive(rates && rates.eurBs)) {
        return convert(n, 'EUR', rates).toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + ' €';
    }
    return '$' + n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/** Carga la caché al arrancar (pintado inmediato antes del fetch). */
export function loadRatesCache(backend = defaultBackend()) {
    if (!backend) return false;
    try {
        const raw = backend.getItem(RATES_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return false;
        const usdBs = Number(parsed.usdBs);
        const eurBs = Number(parsed.eurBs);
        if (!isPositive(usdBs) || !isPositive(eurBs)) return false;

        snapshot = {
            usdBs,
            eurBs,
            fecha: typeof parsed.fecha === 'string' ? parsed.fecha : null,
            fetchedAt: Number.isFinite(Number(parsed.fetchedAt)) ? Number(parsed.fetchedAt) : 0,
            offline: false
        };
        return true;
    } catch {
        return false;
    }
}

function saveRatesCache(backend) {
    if (!backend) return;
    try {
        backend.setItem(RATES_KEY, JSON.stringify(snapshot));
    } catch {
        // Sin espacio: la tasa vive en memoria hasta recargar.
    }
}

export function isStale(now = Date.now()) {
    return snapshot.fetchedAt === 0 || now - snapshot.fetchedAt > RATES_TTL;
}

/**
 * Consulta la API y actualiza el snapshot. Devuelve true si hubo tasa nueva.
 * Cualquier fallo (red, payload roto) conserva lo que había y marca
 * `offline` para que el badge lo revele. El fetcher es inyectable en tests.
 */
export async function refreshRates({ fetcher = fetch, backend = defaultBackend() } = {}) {
    try {
        const res = await fetcher(API_URL, { cache: 'no-store' });
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '?'}`);
        const next = normalizeRates(await res.json());
        if (!next) throw new Error('respuesta sin tasas válidas');
        snapshot = next;
        saveRatesCache(backend);
        return true;
    } catch {
        snapshot = { ...snapshot, offline: true };
        return false;
    }
}
