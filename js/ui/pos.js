/* Vista de Caja/POS: selector de estilista, catálogo y ticket.
 * Todo render con escapeHtml en los nombres de usuario (bug #10).
 */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';
import { toUSD } from '../core/rates.js';
import { ticketTotals } from '../domain/ticket.js';

export function renderStaffSelect() {
    const state = getState();
    const select = document.getElementById('pos-staff-select');
    select.innerHTML = state.staff
        .map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.role)}</option>`)
        .join('');
    select.value = state.currentTicket.staffId;
}

export function renderCatalog() {
    const state = getState();
    const grid = document.getElementById('pos-catalog-grid');
    const search = document.getElementById('pos-search').value.trim().toLowerCase();
    const cat = state.posFilterCategory;
    const matches = name => name.toLowerCase().includes(search);

    let html = '';

    if (cat === 'all' || cat === 'service') {
        for (const s of state.services) {
            if (!matches(s.name)) continue;
            html += `
                <button type="button" data-action="add-item" data-type="service" data-id="${escapeHtml(s.id)}" class="catalog-card">
                    <div>
                        <span class="badge badge--tag badge--service">Servicio</span>
                        <h4 class="catalog-card__name">${escapeHtml(s.name)}</h4>
                    </div>
                    <div class="catalog-card__bottom">
                        <span class="catalog-card__meta">Insumos: ${s.recipe.length}</span>
                        <span class="catalog-card__price">${money(s.price)}</span>
                    </div>
                </button>`;
        }
    }

    if (cat === 'all' || cat === 'retail') {
        for (const p of state.products.filter(p => p.type === 'retail')) {
            if (!matches(p.name)) continue;
            const isLow = p.stock <= p.minStock;
            html += `
                <button type="button" data-action="add-item" data-type="product" data-id="${escapeHtml(p.id)}" class="catalog-card catalog-card--retail">
                    <div>
                        <div class="catalog-card__top">
                            <span class="badge badge--tag badge--retail-tag">Retail</span>
                            <span class="catalog-card__stock ${isLow ? 'catalog-card__stock--low' : ''}">Stock: ${p.stock}</span>
                        </div>
                        <h4 class="catalog-card__name">${escapeHtml(p.name)}</h4>
                    </div>
                    <div class="catalog-card__bottom">
                        <span class="catalog-card__meta">${escapeHtml(p.unit)}</span>
                        <span class="catalog-card__price">${money(p.price)}</span>
                    </div>
                </button>`;
        }
    }

    grid.innerHTML = html ||
        '<p class="empty-cell" style="grid-column: 1 / -1;">No se encontraron ítems.</p>';
}

export function renderTicket() {
    const state = getState();
    const container = document.getElementById('ticket-items-container');
    const items = state.currentTicket.items;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-basket-shopping"></i>
                <p>El ticket está vacío.</p>
                <p class="empty-state__hint">Haz clic en los ítems del catálogo para agregarlos.</p>
            </div>`;
    } else {
        container.innerHTML = items.map((item, idx) => `
            <div class="ticket-item">
                <div class="ticket-item__info">
                    <p class="ticket-item__name">${escapeHtml(item.name)}</p>
                    <p class="ticket-item__unit">${money(item.price)} c/u</p>
                </div>
                <div class="ticket-item__qty">
                    <button type="button" data-action="qty" data-idx="${idx}" data-delta="-1"
                            class="qty-btn qty-btn--minus" aria-label="Quitar uno">−</button>
                    <span>${item.qty}</span>
                    <button type="button" data-action="qty" data-idx="${idx}" data-delta="1"
                            class="qty-btn qty-btn--plus" aria-label="Agregar uno">+</button>
                </div>
            </div>`).join('');
    }

    updateTotals();
}

export function updateTotals() {
    const { subtotal, tax, total, commission } = ticketTotals();
    document.getElementById('ticket-subtotal').textContent = money(subtotal);
    document.getElementById('ticket-tax').textContent = money(tax);
    document.getElementById('ticket-commission').textContent = money(commission);
    document.getElementById('ticket-total').textContent = money(total);
    updateChange();
}

/**
 * Pinta el método de pago activo, muestra/oculta el recibido (solo efectivo)
 * y recalcula el cambio en la moneda activa de visualización.
 */
export function renderPayment() {
    const state = getState();
    const method = state.currentTicket.paymentMethod || 'cash';

    document.querySelectorAll('[data-action="set-payment-method"]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.method === method);
    });

    const esEfectivo = method === 'cash';
    document.getElementById('ticket-received-row').classList.toggle('is-hidden', !esEfectivo);
    document.getElementById('ticket-change-row').classList.toggle('is-hidden', !esEfectivo);

    updateChange();
}

/** Cambio = recibido (traducido a USD con la tasa vigente) − total. */
export function updateChange() {
    const state = getState();
    const changeEl = document.getElementById('ticket-change');
    if (!changeEl) return;

    if ((state.currentTicket.paymentMethod || 'cash') !== 'cash') {
        changeEl.textContent = money(0);
        return;
    }

    const { total } = ticketTotals();
    const crudo = document.getElementById('ticket-received').value.trim();
    const receivedUSD = crudo === '' ? 0 : toUSD(Number(crudo), state.settings.currency);
    changeEl.textContent = money(Math.max(receivedUSD - total, 0));
}

/** Actualiza los botones de filtro del catálogo según la categoría activa. */
export function renderFilters() {
    const cat = getState().posFilterCategory;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.cat === cat);
    });
}
