/* Dashboard: KPIs del día, últimas transacciones y alertas de stock.
 *
 * "Ventas del Día" y "Servicios Cobrados" filtran por fecha real (bug #12;
 * el original sumaba toda la sesión). "Comisiones Acumuladas" es histórico:
 * coincide con lo que muestran las tarjetas de la pestaña Comisiones.
 *
 * Con sesión de estilista el dashboard se acota a SUS ventas y SUS
 * comisiones, y las alertas de stock desaparecen: el inventario no es
 * de su rol. */

import { getState } from '../core/state.js';
import { escapeHtml, isToday, money } from '../core/utils.js';
import { can, getCurrentUser } from '../core/auth.js';
import { lowStockProducts } from '../domain/inventory.js';

export function renderDashboard() {
    const state = getState();
    const user = getCurrentUser(state);
    const role = user ? user.role : null;

    const misVentas = user && user.role === 'stylist'
        ? state.transactions.filter(t => t.staffId === user.staffId)
        : state.transactions;

    const today = misVentas.filter(t => isToday(t.date));

    const todaySales = today.reduce((acc, t) => acc + t.total, 0);
    const todayServices = today.reduce(
        (acc, t) => acc + t.items.filter(i => i.type === 'service').reduce((a, i) => a + i.qty, 0),
        0
    );
    const totalCommissions = misVentas.reduce((acc, t) => acc + t.commission, 0);
    const lowItems = lowStockProducts(state);

    document.getElementById('dash-today-sales').textContent = money(todaySales);
    document.getElementById('dash-services-count').textContent = String(todayServices);
    document.getElementById('dash-commissions').textContent = money(totalCommissions);
    document.getElementById('dash-low-stock').textContent = String(lowItems.length);

    renderTransactions(today);
    renderLowStockList(lowItems);

    // Solo el rol que gestiona inventario ve el widget de stock.
    const veStock = can(role, 'inventory');
    document.getElementById('dash-stock-card')?.classList.toggle('is-hidden', !veStock);
    document.getElementById('dash-alerts-card')?.classList.toggle('is-hidden', !veStock);
}

function renderTransactions(today) {
    const tbody = document.getElementById('dash-transactions-list');

    if (today.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No hay ventas registradas hoy.</td></tr>';
        return;
    }

    tbody.innerHTML = today.slice(0, 5).map(t => {
        const itemsCount = t.items.reduce((acc, i) => acc + i.qty, 0);
        return `
            <tr>
                <td data-label="ID" class="cell-mono">${escapeHtml(t.id)}</td>
                <td data-label="Cliente / Estilista">
                    <p class="cell-strong">${escapeHtml(t.staffName)}</p>
                    <p class="cell-muted">${escapeHtml(t.time)}</p>
                </td>
                <td data-label="Items" class="cell-muted">${itemsCount} ítems</td>
                <td data-label="Total" class="cell-amount">${money(t.total)}</td>
                <td data-label="Estado"><span class="badge badge--success">Completado</span></td>
            </tr>`;
    }).join('');
}

function renderLowStockList(lowItems) {
    const box = document.getElementById('dash-low-stock-list');

    if (lowItems.length === 0) {
        box.innerHTML = '<p class="all-ok">✓ Todo el stock está en niveles óptimos.</p>';
        return;
    }

    box.innerHTML = lowItems.map(p => `
        <div class="low-stock-item">
            <div>
                <p class="low-stock-item__name">${escapeHtml(p.name)}</p>
                <p class="low-stock-item__meta">Stock: ${p.stock} ${escapeHtml(p.unit)} (Mín: ${p.minStock})</p>
            </div>
            <span class="low-stock-item__action">Reordenar</span>
        </div>`).join('');
}
