/* Generador del HTML del ticket de canje para imprimir.
 * Toma la estructura devuelta por domain/receipt.js y pinta un HTML
 * escapado, listo para inyectarse en #print-area. */

import { escapeHtml } from '../core/utils.js';

export function renderReceiptHtml(data) {
    if (!data) return '';

    const w = data.widthMM || 58;
    const lines = [];

    lines.push(`<div class="receipt" style="--receipt-width:${w}mm;">`);

    lines.push('<div class="receipt__head">');
    lines.push(`<div class="receipt__center"><strong>${escapeHtml(data.business.name)}</strong></div>`);
    if (data.business.line) {
        lines.push(`<div class="receipt__center">${escapeHtml(data.business.line)}</div>`);
    }
    lines.push(`<div class="receipt__center">${escapeHtml(data.date)}${data.time ? ' ' + escapeHtml(data.time) : ''}</div>`);
    lines.push('</div>');

    lines.push(`<div class="receipt__code">${escapeHtml(data.code)}</div>`);

    for (const grupo of data.groups) {
        lines.push('<div class="receipt__body">');
        lines.push(`<div class="receipt__group"><strong>Estilista: ${escapeHtml(grupo.staffName)}</strong></div>`);
        for (const svc of grupo.services) {
            const name = escapeHtml(svc.name);
            const qty = svc.qty;
            lines.push('<div class="receipt__service">');
            lines.push(`<div class="receipt__name">${name}</div>`);
            if (data.showPrices && svc.price !== null && svc.lineTotal !== null) {
                lines.push('<div class="receipt__row receipt__row--sub">');
                lines.push(`<div class="receipt__qty">${qty} x ${svc.price.toFixed(2)}</div>`);
                lines.push(`<div class="receipt__total-line">${svc.lineTotal.toFixed(2)}</div>`);
                lines.push('</div>');
            } else {
                lines.push('<div class="receipt__row receipt__row--sub">');
                lines.push(`<div class="receipt__qty">Cantidad: ${qty}</div>`);
                lines.push('</div>');
            }
            lines.push('</div>');
        }
        lines.push('</div>');
    }

    lines.push('<div class="receipt__row--sep"></div>');
    lines.push('<div class="receipt__total">');
    if (data.totalServices !== null) {
        lines.push(`<div class="receipt__row"><span>Total Servicios</span><span>${data.totalServices.toFixed(2)}</span></div>`);
    }
    lines.push('</div>');

    if (data.business.footer) {
        lines.push('<div class="receipt__footer receipt__center">' + escapeHtml(data.business.footer) + '</div>');
    }

    lines.push('</div>');
    return lines.join('');
}