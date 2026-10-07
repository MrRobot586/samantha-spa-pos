/* Lista de ventas para reimprimir tickets de canje de servicios. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';
import { getCurrentUser } from '../core/auth.js';
import { hasServices } from '../domain/receipt.js';

function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getDate());
    const mm = String(d.getMonth() + 1);
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mn}`;
}

export function renderSales() {
    const state = getState();
    const tbody = document.getElementById('sales-list');
    const user = getCurrentUser(state);
    const role = user ? user.role : null;

    let ventas = state.transactions.slice();
    if (role === 'stylist' && user.staffId) {
        ventas = ventas.filter(t => t.staffId === user.staffId);
    }

    const from = document.getElementById('venta-from')?.value || '';
    const to = document.getElementById('venta-to')?.value || '';

    if (from) {
        const dFrom = new Date(from + 'T00:00:00');
        ventas = ventas.filter(t => new Date(t.date) >= dFrom);
    }
    if (to) {
        const dTo = new Date(to + 'T23:59:59');
        ventas = ventas.filter(t => new Date(t.date) <= dTo);
    }

    if (ventas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No hay ventas en el período.</td></tr>';
        return;
    }

    tbody.innerHTML = ventas.map(t => {
        const servicesCount = t.items.filter(i => i.type === 'service').reduce((a, i) => a + i.qty, 0);
        const canPrint = hasServices(t);
        return `
            <tr>
                <td>${formatDate(t.date)}</td>
                <td class="cell-mono">${escapeHtml(t.id)}</td>
                <td>${escapeHtml(t.staffName)}</td>
                <td>${servicesCount}</td>
                <td>${money(t.total)}</td>
                <td class="cell-right">
                    <button type="button" data-action="print-ticket" data-tx-id="${escapeHtml(t.id)}" class="btn btn--neutral btn--sm" ${canPrint ? '' : 'disabled'}>
                        <i class="fa-solid fa-print"></i> Imprimir ticket
                    </button>
                </td>
            </tr>`;
    }).join('');
}