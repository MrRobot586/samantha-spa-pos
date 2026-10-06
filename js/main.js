/* Punto de entrada.
 *
 * Arranque: 1) cargar y normalizar el estado de localStorage;
 * 2) pintar todo; 3) delegar los eventos del HTML, que — igual que en
 * DuoTracker — ya no llevan manejadores en línea: todo pasa por
 * data-action + listeners en document.
 */

import { getState, replaceState } from './core/state.js';
import { loadState, saveState } from './core/storage.js';
import { login, logout, getCurrentUser } from './core/auth.js';
import { loadRatesCache, refreshRates, isStale, toUSD } from './core/rates.js';
import { CURRENCIES, THEMES } from './core/config.js';
import { money } from './core/utils.js';

import { switchTab, renderNav, ensureAllowedTab } from './ui/navigation.js';
import { showLogin, showApp, showLoginError } from './ui/login-view.js';
import { renderHeader, applyTheme } from './ui/header.js';
import { renderUsersList, fillUserForm, resetUserForm } from './ui/users-view.js';
import { toast, toastSuccess, toastError } from './ui/dialogs.js';
import { openModal, closeModal, initModals } from './ui/modals.js';
import { renderStaffSelect, renderCatalog, renderTicket, renderFilters, updateTotals, renderPayment, updateChange } from './ui/pos.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderServicesCards } from './ui/services-view.js';
import { renderInventoryTable } from './ui/inventory-view.js';
import { renderCommissions } from './ui/commissions-view.js';
import { renderCash, fillCashClosePreview } from './ui/cash-view.js';

import { addItem, changeQty, clearTicket, setTicketStaff, setPaymentMethod } from './domain/ticket.js';
import { processPayment } from './domain/checkout.js';
import { addProduct, restock, findProduct } from './domain/inventory.js';
import { addService } from './domain/services.js';
import { createUser, updateUser } from './domain/users.js';
import { openCashSession, addWithdrawal, closeCashSession } from './domain/cash.js';

const persist = () => saveState(getState());

/** Revisión de staleness para sesiones largas (la tasa vive en memoria). */
const STALE_CHECK_MS = 10 * 60 * 1000;

function renderAll() {
    renderHeader();
    renderDashboard();
    renderCatalog();
    renderTicket();
    renderPayment();
    renderServicesCards();
    renderInventoryTable();
    renderCommissions();
    renderCash();
    renderUsersList();
}

/** Chip del usuario en el topbar + nav filtrada por rol. */
function renderSessionChrome() {
    const user = getCurrentUser(getState());
    if (!user) return;

    const iniciales = user.name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    document.getElementById('user-initials').textContent = iniciales;
    document.getElementById('user-chip-name').textContent = user.name;
    document.getElementById('user-chip').title =
        `${user.name} · ${user.role === 'admin' ? 'Administrador' : 'Estilista'}`;
    renderNav(user.role);
}

/* ------------------------------------------------------------ acciones -- */

let restockTargetId = null;

function handleAction(el, action) {
    switch (action) {
        case 'switch-tab':
            switchTab(el.dataset.tab);
            break;

        case 'filter-cat': {
            const cat = el.dataset.cat;
            if (!['all', 'service', 'retail'].includes(cat)) return;
            getState().posFilterCategory = cat;
            renderFilters();
            renderCatalog();
            persist();
            break;
        }

        case 'add-item':
            try {
                addItem(el.dataset.type, el.dataset.id);
                renderTicket();
                persist();
            } catch (err) {
                toastError(err.message);
            }
            break;

        case 'qty':
            changeQty(Number(el.dataset.idx), Number(el.dataset.delta));
            renderTicket();
            persist();
            break;

        case 'clear-ticket':
            clearTicket();
            document.getElementById('ticket-received').value = '';
            renderTicket();
            renderPayment();
            persist();
            break;

        case 'set-payment-method':
            try {
                setPaymentMethod(el.dataset.method);
                renderPayment();
                persist();
            } catch (err) {
                toastError(err.message);
            }
            break;

        case 'pay': {
            try {
                const state = getState();
                const method = state.currentTicket.paymentMethod || 'cash';
                let receivedUSD;
                if (method === 'cash') {
                    const crudo = document.getElementById('ticket-received').value.trim();
                    // Vacío = pago exacto; si se indicó, se traduce a USD.
                    if (crudo !== '') {
                        receivedUSD = toUSD(Number(crudo), state.settings.currency);
                    }
                }
                const tx = processPayment(state, { method, receivedUSD });
                document.getElementById('ticket-received').value = '';
                toastSuccess(tx.changeUSD > 0
                    ? `Pago de ${money(tx.total)} procesado · cambio ${money(tx.changeUSD)}.`
                    : `Pago de ${money(tx.total)} procesado: inventario descontado y comisión asignada.`);
                renderAll();
                persist();
            } catch (err) {
                toastError(err.message);
            }
            break;
        }

        case 'open-modal':
            openModal(el.dataset.target);
            break;

        case 'close-modal':
            closeModal(el.dataset.target);
            break;

        case 'logout':
            logout();
            showLogin();
            break;

        case 'set-currency': {
            const cur = el.dataset.currency;
            if (!CURRENCIES.includes(cur)) return;
            getState().settings.currency = cur;
            renderAll();
            persist();
            break;
        }

        case 'set-theme': {
            const actual = getState().settings.theme;
            const siguiente = THEMES[(THEMES.indexOf(actual) + 1) % THEMES.length] || 'auto';
            getState().settings.theme = siguiente;
            applyTheme();
            renderHeader();
            persist();
            break;
        }

        case 'refresh-rates':
            refreshRates().then(actualizada => {
                if (actualizada) {
                    renderAll();
                } else {
                    renderHeader();
                    toastError('No se pudo actualizar la tasa de cambio (sin conexión).');
                }
            });
            break;

        case 'edit-user':
            fillUserForm(el.dataset.id);
            break;

        case 'new-user':
            resetUserForm();
            document.getElementById('user-name')?.focus();
            break;

        case 'restock': {
            const prod = findProduct(el.dataset.id);
            if (!prod) {
                toastError('Producto no encontrado.');
                return;
            }
            restockTargetId = prod.id;
            document.getElementById('restock-name').value = prod.name;
            document.getElementById('restock-amount').value = '10';
            openModal('modal-restock');
            break;
        }

        case 'cash-open-modal':
            document.getElementById('cash-open-fondo').value = '';
            openModal('modal-cash-open');
            document.getElementById('cash-open-fondo').focus();
            break;

        case 'cash-withdraw-modal':
            document.getElementById('cash-withdraw-amount').value = '';
            document.getElementById('cash-withdraw-note').value = '';
            openModal('modal-cash-withdraw');
            document.getElementById('cash-withdraw-amount').focus();
            break;

        case 'cash-close-modal':
            fillCashClosePreview();
            document.getElementById('cash-close-contado').value = '';
            openModal('modal-cash-close');
            document.getElementById('cash-close-contado').focus();
            break;
    }
}

function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    handleAction(el, el.dataset.action);
}

function onChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'staff-change') {
        try {
            setTicketStaff(el.value);
            updateTotals();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }
}

function onInput(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'pos-search') {
        renderCatalog();
    } else if (el.dataset.action === 'ticket-received') {
        updateChange();
    }
}

function fieldValue(id) {
    return document.getElementById(id).value.trim();
}

function onSubmit(e) {
    const form = e.target;
    e.preventDefault();

    if (form.id === 'form-login') {
        try {
            const user = login(fieldValue('login-user'), fieldValue('login-pin'));
            showApp();
            renderSessionChrome();
            switchTab('dashboard');
            if (user.staffId) {
                try {
                    setTicketStaff(user.staffId);
                    persist();
                } catch {
                    // El estilista vinculado ya no existe: se queda el actual.
                }
            }
            renderStaffSelect();
            renderAll();
            toastSuccess(`Hola, ${user.name}.`);
        } catch (err) {
            showLoginError(err.message);
            document.getElementById('login-pin')?.select();
        }
        return;
    }

    if (form.id === 'form-user') {
        try {
            const id = fieldValue('user-id');
            const data = {
                name: fieldValue('user-name'),
                username: fieldValue('user-username'),
                role: document.getElementById('user-role').value,
                pin: fieldValue('user-pin'),
                staffId: document.getElementById('user-staff').value || null,
                active: document.getElementById('user-active').checked
            };
            const guardado = id ? updateUser(id, data) : createUser(data);
            persist();
            resetUserForm();
            renderAll();

            // La sesión pudo cambiar de rol o quedar inválida (auto-desactivación).
            if (getCurrentUser(getState())) {
                renderSessionChrome();
                ensureAllowedTab();
            } else {
                logout();
                showLogin();
            }
            toastSuccess(id
                ? `Usuario "${guardado.name}" actualizado.`
                : `Usuario "${guardado.name}" creado.`);
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-add-product') {
        try {
            const product = addProduct({
                name: fieldValue('prod-name'),
                type: document.getElementById('prod-type').value,
                unit: document.getElementById('prod-unit').value,
                stock: parseFloat(fieldValue('prod-stock')),
                minStock: parseFloat(fieldValue('prod-min')),
                cost: parseFloat(fieldValue('prod-cost')),
                price: parseFloat(fieldValue('prod-price'))
            });
            form.reset();
            closeModal('modal-product');
            toastSuccess(`"${product.name}" agregado al inventario.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-add-service') {
        try {
            const service = addService({
                name: fieldValue('serv-name'),
                price: parseFloat(fieldValue('serv-price'))
            });
            form.reset();
            closeModal('modal-service');
            toastSuccess(`Servicio "${service.name}" agregado al catálogo.`);
            renderServicesCards();
            renderCatalog();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-restock') {
        try {
            const amount = parseFloat(fieldValue('restock-amount'));
            const prod = restock(restockTargetId, amount);
            restockTargetId = null;
            closeModal('modal-restock');
            toastSuccess(`Stock de ${prod.name}: ${prod.stock} ${prod.unit}.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-cash-open') {
        try {
            const fondo = toUSD(parseFloat(fieldValue('cash-open-fondo')), getState().settings.currency);
            openCashSession(fondo);
            closeModal('modal-cash-open');
            toastSuccess(`Caja abierta con fondo ${money(fondo)}.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-cash-withdraw') {
        try {
            const monto = toUSD(parseFloat(fieldValue('cash-withdraw-amount')), getState().settings.currency);
            addWithdrawal(monto, fieldValue('cash-withdraw-note'));
            closeModal('modal-cash-withdraw');
            toastSuccess(`Retiro de ${money(monto)} registrado en caja.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-cash-close') {
        try {
            const contado = toUSD(parseFloat(fieldValue('cash-close-contado')), getState().settings.currency);
            const corte = closeCashSession(contado);
            closeModal('modal-cash-close');
            const dif = corte.diferenciaUSD;
            if (Math.abs(dif) < 1e-9) {
                toastSuccess('Caja cerrada: el contado cuadra exacto.');
            } else if (dif < 0) {
                toastError(`Caja cerrada con faltante de ${money(Math.abs(dif))}.`);
            } else {
                toastSuccess(`Caja cerrada con sobrante de ${money(dif)}.`);
            }
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }
}

/* -------------------------------------------------------------- arranque -- */

function boot() {
    const { state, recovered } = loadState();
    replaceState(state);
    loadRatesCache(); // pinta la tasa guardada al instante; el fetch llega después
    applyTheme(); // reafirma el tema pre-paint con el settings real (y 'auto' resuelto)

    initModals();

    if (recovered === 'corrupto') {
        toast('Los datos guardados estaban corruptos. Se respaldaron y se reinició el inventario.', 'danger', 6000);
    } else if (recovered === 'migrado') {
        toast('Datos actualizados a la nueva versión. La copia anterior se conservó como respaldo.', 'success', 5000);
    }

    document.getElementById('current-date').textContent = new Date()
        .toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });

    // Puerta de acceso: sin sesión válida, solo se ve la pantalla de login.
    const usuario = getCurrentUser(state);
    if (usuario) {
        showApp();
        renderSessionChrome();
        switchTab('dashboard');
    } else {
        showLogin();
    }

    renderStaffSelect();
    renderFilters();
    renderAll();

    // Revalida la tasa (si falla, el badge queda marcado como sin conexión).
    refreshRates().then(actualizada => {
        if (actualizada) renderAll();
        else renderHeader();
    }).catch(() => {});
    setInterval(() => {
        if (!isStale()) return;
        refreshRates()
            .then(actualizada => { if (actualizada) renderAll(); else renderHeader(); })
            .catch(() => {});
    }, STALE_CHECK_MS);

    // Si el tema es 'auto', re-aplica cuando el sistema cambia de claro a oscuro.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (getState().settings.theme === 'auto') applyTheme();
    });

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('submit', onSubmit);
}

boot();
