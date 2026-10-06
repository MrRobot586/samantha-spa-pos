/* Toasts: reemplazan los alert()/confirm() nativos del original.
 * El mensaje va por textContent (nunca innerHTML), así que un error que
 * incluya el nombre de un producto con HTML se muestra literal.
 */

export function toast(message, type = 'info', duration = 3500) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    stack.appendChild(el);

    setTimeout(() => {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

export const toastSuccess = message => toast(message, 'success');
export const toastError = message => toast(message, 'danger', 5000);
