/* Constantes de configuración de la app. */

/** IVA aplicado al subtotal (México, 16%). */
export const TAX_RATE = 0.16;

/** Clave de persistencia en localStorage. El sufijo :v2 es la versión del
 *  esquema: si algún día cambia la forma de los datos, sube el número y la
 *  carga anterior puede migrarse en vez de romper. */
export const STORAGE_KEY = 'samantha-spa-pos:v2';

/** Esquema anterior: si v2 está vacía pero v1 existe, los datos se migran
 *  (v1 se conserva intacta como respaldo natural). */
export const LEGACY_STORAGE_KEY = 'samantha-spa-pos:v1';

/** Dónde se guarda una copia del JSON corrupto antes de descartarlo. */
export const STORAGE_BACKUP_KEY = 'samantha-spa-pos:backup-corrupto';

/** Respaldo del estado que «restaurar demo» reemplaza con la semilla. */
export const STORAGE_DEMO_BACKUP_KEY = 'samantha-spa-pos:backup-demo';

/** Minutos de inactividad antes de cerrar la sesión automáticamente. */
export const SESSION_IDLE_MIN = 20;

/** Clave de la sesión activa (usuario logueado). Va aparte del estado:
 *  es control de acceso de la UI, no datos del negocio. */
export const SESSION_KEY = 'samantha-spa-pos:session';

/** Caché de la tasa BCV (se refresca desde la API al arrancar). */
export const RATES_KEY = 'samantha-spa-pos:rates';

/** Monedas de visualización. La base de cálculo siempre es USD. */
export const CURRENCIES = ['USD', 'VES', 'EUR'];

/** Modos de tema en orden de ciclo del botón del topbar.
 *  'auto' sigue el sistema (prefers-color-scheme); dark/light son fijos. */
export const THEMES = ['auto', 'dark', 'light'];

/** Cierre de sesión por inactividad (la sesión local sobrevive a F5, así
 *  que en un equipo compartido conviene que caduque sola). */
export const SESSION_IDLE_MS = 20 * 60 * 1000;

/** Cada cuánto se revisa la inactividad. */
export const IDLE_CHECK_MS = 30 * 1000;

export const TABS = ['dashboard', 'pos', 'cash', 'services', 'inventory', 'commissions'];
