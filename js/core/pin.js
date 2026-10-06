/* Hash de PINs para la autenticación local.
 *
 * Al ser una app sin backend, esto es OFUSCACIÓN, no seguridad: evita que
 * el PIN se lea en claro abriendo el localStorage, pero no protege contra
 * alguien con acceso al equipo. La semilla necesita un hash determinista y
 * síncrono (WebCrypto no existe fuera de contextos seguros y su resultado
 * no se puede fijar en los datos de prueba), así que se usa FNV-1a en dos
 * rondas con salt, etiquetado para poder cambiar el algoritmo algún día
 * sin romper los hashes ya guardados. */

function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

const hex = n => n.toString(16).padStart(8, '0');

/** Devuelve `fnv1a:<hex16>` para el PIN con su salt. */
export function hashPin(pin, salt) {
    const first = fnv1a(`${salt}:${pin}`);
    const second = fnv1a(`${salt}:${pin}:${first}`);
    return `fnv1a:${hex(first)}${hex(second)}`;
}

/** Compara un PIN con un hash guardado. Cualquier entrada malformada → false. */
export function verifyPin(pin, salt, stored) {
    if (typeof pin !== 'string' || typeof salt !== 'string' || typeof stored !== 'string') {
        return false;
    }
    const separator = stored.indexOf(':');
    if (separator === -1) return false;
    const algorithm = stored.slice(0, separator);
    if (algorithm !== 'fnv1a') return false;
    return hashPin(pin, salt) === `${algorithm}:${stored.slice(separator + 1)}`;
}
