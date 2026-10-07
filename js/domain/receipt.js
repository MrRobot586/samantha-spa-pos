/* Ticket de canje: datos puros para el comprobante imprimible de una venta
 * ya realizada. El cliente lo entrega a la estilista para canjear los
 * servicios que ya pagó.
 *
 * Este módulo NO toca el DOM: devuelve una estructura y la capa de UI la
 * convierte a HTML (ui/receipt.js). Así se puede probar en node.
 *
 * Solo viajan los SERVICIOS (el ticket es de canje de servicios). Los
 * productos que acompañen la venta no se imprimen.
 *
 * Anchos de impresora térmica soportados: 58 mm y 80 mm. */

/** Anchos de papel térmico válidos (en milímetros). */
export const PRINTER_WIDTHS = [58, 80];

const DEFAULT_TICKET = {
    printerWidth: 58,
    businessName: 'Samantha Spa',
    businessLine: 'Sucursal Principal',
    footer: '¡Gracias por su preferencia!',
    showPrices: true
};

/** Normaliza la configuración del ticket con valores por defecto. */
export function ticketSettings(settings) {
    const raw = settings && typeof settings === 'object' ? settings.ticket : null;
    const src = raw && typeof raw === 'object' ? raw : {};

    const width = Number(src.printerWidth);
    const text = (v, fallback) =>
        typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 80) : fallback;

    return {
        printerWidth: PRINTER_WIDTHS.includes(width) ? width : DEFAULT_TICKET.printerWidth,
        businessName: text(src.businessName, DEFAULT_TICKET.businessName),
        businessLine: text(src.businessLine, DEFAULT_TICKET.businessLine),
        footer: text(src.footer, DEFAULT_TICKET.footer),
        showPrices: src.showPrices !== false
    };
}

/** true si la venta tiene al menos un servicio (condición para imprimir). */
export function hasServices(tx) {
    return Boolean(tx) && Array.isArray(tx.items) && tx.items.some(i => i.type === 'service');
}

/** Código de canje legible y determinista derivado del id de la venta. */
export function redeemCode(id) {
    const limpio = String(id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (limpio.length === 0) return 'C-------';
    const ultimos = limpio.slice(-6);
    if (ultimos.length === 6) return 'C-' + ultimos;
    // si el ID original tiene muy pocos caracteres válidos
    if (limpio.length < 6) {
        return 'C' + limpio.padStart(6, '-');
    }
    return 'C-' + ultimos;
}

const pad = (n) => String(n).padStart(2, '0');
function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate());
    const mm = String(d.getMonth() + 1);
    return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Estructura del ticket de canje de una venta.
 * @param {object} tx transacción guardada
 * @param {object} [settings] settings del estado (usa settings.ticket)
 * @returns {object|null} null si la venta no tiene servicios
 */
export function receiptTicketData(tx, settings = {}) {
    if (!hasServices(tx)) return null;

    const cfg = ticketSettings(settings);

    const grupos = new Map();
    for (const item of tx.items) {
        if (item.type !== 'service') continue;
        const staffId = item.staffId || tx.staffId || 'na';
        const staffName = item.staffName || tx.staffName || 'N/A';
        if (!grupos.has(staffId)) {
            grupos.set(staffId, { staffId, staffName, services: [], subtotal: 0, sinPrecio: false });
        }
        const grupo = grupos.get(staffId);
        const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
        const lineTotal = price === null ? null : price * item.qty;
        grupo.services.push({
            name: item.name || 'Servicio',
            qty: item.qty,
            price,
            lineTotal
        });
        if (lineTotal === null) grupo.sinPrecio = true;
        else grupo.subtotal += lineTotal;
    }

    const groups = [...grupos.values()].map(g => ({
        ...g,
        subtotal: g.sinPrecio ? null : g.subtotal
    }));

    const totalServices = groups.every(g => g.subtotal === null)
        ? null
        : groups.reduce((a, g) => a + (g.subtotal || 0), 0);

    return {
        code: redeemCode(tx.id),
        id: tx.id,
        date: formatDate(tx.date),
        time: tx.time || '',
        business: {
            name: cfg.businessName,
            line: cfg.businessLine,
            footer: cfg.footer
        },
        widthMM: cfg.printerWidth,
        showPrices: cfg.showPrices,
        groups,
        totalServices
    };
}