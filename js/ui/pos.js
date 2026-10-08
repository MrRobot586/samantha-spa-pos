/* Catálogo del POS, ticket y resumen de pago (pago mixto). Sin lógica de
 * negocio: delega en domain/payments.js y domain/ticket.js. */

import { getState } from '../core/state.js';
import { money, escapeHtml } from '../core/utils.js';
import { toUSD, convert } from '../core/rates.js';
import { ticketTotals, setPaymentAmount } from '../domain/ticket.js';
import { activePaymentMethods, methodLabel, settlePayments } from '../domain/payments.js';

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

    if (cat === 'all' || cat === 'sale') {
        for (const p of state.products.filter(p => p.type === 'sale')) {
            if (!matches(p.name)) continue;
            const isLow = p.stock <= p.minStock;
            html += `
                <button type="button" data-action="add-item" data-type="product" data-id="${escapeHtml(p.id)}" class="catalog-card catalog-card--sale">
                    <div>
                        <div class="catalog-card__top">
                            <span class="badge badge--tag badge--sale-tag">Producto</span>
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
    // Mantén el stepper al día (habilita/deshabilita el paso 2 según la orden).
    renderPosStep();
}

export function updateTotals() {
    const { subtotal, tax, total, commission } = ticketTotals();
    document.getElementById('ticket-subtotal').textContent = money(subtotal);
    document.getElementById('ticket-tax').textContent = money(tax);
    document.getElementById('ticket-commission').textContent = money(commission);
    document.getElementById('ticket-total').textContent = money(total);
    renderCheckout({ subtotal, tax, total, commission });
    updatePaymentSummary();
}

/** Vuelca los pagos guardados a los inputs (montos en la moneda activa). */
export function renderPayment() {
    const state = getState();
    for (const method of activePaymentMethods(state)) {
        const input = paymentInput(method.id);
        if (!input) continue;
        const pago = state.currentTicket.payments.find(p => p.method === method.id);
        input.value = pago ? String(Number(convert(pago.amountUSD, state.settings.currency).toFixed(2))) : '';
    }
    updatePaymentSummary();
}

function paymentInput(method) {
    return document.querySelector(`[data-action="payment-amount"][data-method="${method}"]`);
}

/**
 * Lee los inputs, actualiza el ticket (en USD) y devuelve una copia de los
 * pagos. Un campo vacío o ilegible cuenta como 0 (método sin usar).
 */
export function collectPayments() {
    const state = getState();
    for (const method of activePaymentMethods(state)) {
        const input = paymentInput(method.id);
        const crudo = input ? input.value.trim() : '';
        const n = Number(crudo);
        const usd = crudo === '' || !Number.isFinite(n) || n <= 0
            ? 0
            : toUSD(n, state.settings.currency);
        setPaymentAmount(method.id, usd);
    }
    return state.currentTicket.payments.map(p => ({ ...p }));
}

/** Resumen Pagado / Falta / Vuelto en la moneda activa. */
export function updatePaymentSummary() {
    const state = getState();
    const { total } = ticketTotals();
    const paid = state.currentTicket.payments.reduce((a, p) => a + p.amountUSD, 0);
    const due = Math.max(total - paid, 0);

    let change = 0;
    try {
        change = settlePayments(state.currentTicket.payments, total).changeUSD;
    } catch {
        change = 0;
    }

    document.getElementById('ticket-paid').textContent = money(paid);
    document.getElementById('ticket-due').textContent = money(due);
    document.getElementById('ticket-change').textContent = money(change);
    document.getElementById('ticket-due-row').classList.toggle('is-hidden', due <= 0.0001);
}

/** Resumen de la venta para el modal de confirmación. */
export function renderSaleConfirm() {
    const state = getState();
    const { subtotal, tax, total } = ticketTotals();
    const staff = state.staff.find(s => s.id === state.currentTicket.staffId);
    const pagos = state.currentTicket.payments;

    let change = 0;
    try {
        change = settlePayments(pagos, total).changeUSD;
    } catch {
        change = 0;
    }

    const filasPago = pagos.length > 0
        ? pagos.map(p => `
            <div class="sale-confirm__row">
                <span>${escapeHtml(methodLabel(p.method, activePaymentMethods(state)))}</span>
                <span>${money(p.amountUSD)}</span>
            </div>`).join('')
        : '<div class="sale-confirm__row"><span>Sin pagos registrados</span><span>—</span></div>';

    document.getElementById('sale-confirm-preview').innerHTML = `
        <div class="sale-confirm__row">
            <span>Artículos</span>
            <span>${state.currentTicket.items.reduce((a, i) => a + i.qty, 0)}</span>
        </div>
        <div class="sale-confirm__row">
            <span>Estilista</span>
            <span>${escapeHtml(staff ? staff.name : 'N/A')}</span>
        </div>
        <div class="sale-confirm__row">
            <span>Subtotal</span>
            <span>${money(subtotal)}</span>
        </div>
        <div class="sale-confirm__row">
            <span>IVA (16%)</span>
            <span>${money(tax)}</span>
        </div>
        <div class="sale-confirm__row sale-confirm__row--total">
            <span>Total</span>
            <span>${money(total)}</span>
        </div>
        <div class="sale-confirm__sep"></div>
        ${filasPago}
        <div class="sale-confirm__row">
            <span>Vuelto</span>
            <span>${money(change)}</span>
        </div>`;
}

/* --- Wizard de cobro: 1 Orden → 2 Cobro → 3 Cierre -------------------------------
 * El paso vive en memoria (no se persiste): si la pestaña recarga, la orden
 * recupera sus ítems pero el usuario vuelve al paso 1. El paso 3 solo se
 * alcanza al concretar la venta. */
let posStep = 1;

export function getPosStep() {
    return posStep;
}

/**
 * Navega entre pasos con validación estricta:
 *  - 1 siempre se puede (volver o empezar de nuevo);
 *  - 2 exige al menos un ítem en la orden;
 *  - 3 no se puede elegir: solo se llega a él al concretar la venta.
 * Devuelve false si la transición no está permitida.
 */
export function goToPosStep(paso) {
    if (paso === 1) {
        posStep = 1;
        return true;
    }
    if (paso === 2) {
        if (getState().currentTicket.items.length === 0) return false;
        posStep = 2;
        return true;
    }
    // El cierre solo existe después de que la venta se haya concretado.
    return paso === 3 && posStep === 3;
}

/** Marca el paso 3: lo llama el cobro exitoso justo antes de repintar. */
export function completePosStep() {
    posStep = 3;
}

/** Muestra el panel del paso activo y sincroniza el stepper. */
export function renderPosStep() {
    const layout = document.querySelector('#tab-pos .pos-layout');
    const checkout = document.getElementById('pos-checkout');
    const done = document.getElementById('pos-done');
    if (!layout || !checkout || !done) return;

    const conItems = getState().currentTicket.items.length > 0;
    // Si la orden se quedó sin ítems estando en el cobro, volvemos a 1.
    if (posStep === 2 && !conItems) posStep = 1;

    layout.classList.toggle('is-hidden', posStep !== 1);
    checkout.classList.toggle('is-hidden', posStep !== 2);
    done.classList.toggle('is-hidden', posStep !== 3);

    document.querySelectorAll('[data-action="pos-step"]').forEach(btn => {
        const destino = Number(btn.dataset.step);
        btn.disabled = (destino === 2 && !conItems) || (destino === 3 && posStep !== 3);
        if (!btn.classList.contains('pos-step')) return;
        const activo = destino === posStep;
        btn.classList.toggle('is-active', activo);
        if (activo) btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
    });

    if (posStep === 2) renderCheckout();
}

/** Resumen del paso 2: ítems, estilista y totales de la orden. */
export function renderCheckout(totals) {
    const state = getState();
    const cont = document.getElementById('checkout-items');
    if (!cont) return;

    const { subtotal, tax, total, commission } = totals || ticketTotals();
    const staff = state.staff.find(s => s.id === state.currentTicket.staffId);

    cont.innerHTML = state.currentTicket.items.map(item => `
        <div class="checkout-item">
            <div class="checkout-item__info">
                <p class="checkout-item__name">${escapeHtml(item.name)}</p>
                <p class="checkout-item__unit">${money(item.price)} c/u</p>
            </div>
            <span class="checkout-item__qty">× ${item.qty}</span>
            <span class="checkout-item__price">${money(item.price * item.qty)}</span>
        </div>`).join('') || '<p class="empty-cell">La orden está vacía.</p>';

    const staffEl = document.getElementById('checkout-staff');
    if (staffEl) staffEl.textContent = staff ? staff.name : 'N/A';

    const put = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };
    put('ck-subtotal', money(subtotal));
    put('ck-tax', money(tax));
    put('ck-commission', money(commission));
    put('ck-total', money(total));
}

/** Actualiza los botones de filtro del catálogo según la categoría activa. */
export function renderFilters() {
    const cat = getState().posFilterCategory;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.cat === cat);
    });
}