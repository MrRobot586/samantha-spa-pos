/* Utilidades puras: escapado, formato monetario, ids y fechas. */

import { formatMoney } from './rates.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa HTML para insertar texto de usuario con innerHTML.
 *  Todo lo que venga de un input (nombres de producto, servicio, etc.)
 *  pasa por aquí: sin esto, un nombre como <img src=x onerror=...>
 *  se ejecutaría en la caja (bug #10). */
export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/** Formato monetario en la moneda activa de visualización (base USD:
 *  guarda $, muestra $, Bs o € según settings.currency — ver rates.js). */
export function money(amount) {
    return formatMoney(amount);
}

/** Identificador único para productos, servicios, etc. */
export function uid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    // Reserva: navegadores sin crypto.randomUUID (http no seguro muy viejo).
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

let txSeq = 0;

/** ID de transacción legible y sin colisiones (bug #7): timestamp en base36
 *  (crece monótonamente) + secuencia de la sesión. */
export function nextTransactionId() {
    txSeq += 1;
    return 'TX-' + Date.now().toString(36).toUpperCase() + '-' + txSeq;
}

/** Solo para tests: reinicia la secuencia de transacciones. */
export function resetTransactionSeq() {
    txSeq = 0;
}

/** Clave de día local (YYYY-MM-DD) para filtrar "ventas del día". */
export function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** true si la fecha ISO guardada cae en el día local de hoy (bug #12:
 *  "Ventas del Día" debe filtrar por fecha, no contar toda la sesión). */
export function isToday(isoString) {
    if (!isoString) return false;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return false;
    return dayKey(date) === dayKey();
}
