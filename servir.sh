#!/usr/bin/env bash
#
# servir.sh — sirve Samantha Spa POS desde la carpeta donde vive este script.
#
# Uso:
#   ./servir.sh              puerto 8000, abre el navegador
#   ./servir.sh 9000         otro puerto
#   PORT=9000 ./servir.sh    también sirve por la variable de entorno
#   ./servir.sh --no-open    no abre el navegador
#
# Sin instalar nada: usa el http.server de Python; si no hay Python, un
# servidor estático mínimo de Node (sin dependencias).
set -u

comando() { command -v "$1" >/dev/null 2>&1; }

# Carpeta real de la app: se resuelve el origen real del script (BASH_SOURCE
# y detrás de los enlaces simbólicos). Así, invocarlo por alias, desde otra
# carpeta o por un symlink nunca puede servir el index de otro proyecto.
ORIGEN="${BASH_SOURCE[0]}"
if comando readlink; then
    ORIGEN="$(readlink -f "$ORIGEN")"
fi
RAIZ="$(cd "$(dirname "$ORIGEN")" && pwd)"
PUERTO="${PORT:-8000}"
ABRIR=1
PUERTO_DADO=0

uso() {
    cat <<'EOF'
Uso: ./servir.sh [puerto] [--no-open]

  puerto     número del 1 al 65535 (por defecto 8000, o $PORT)
  --no-open  no abre el navegador al arrancar
EOF
}

for arg in "$@"; do
    case "$arg" in
        -h | --help)
            uso
            exit 0
            ;;
        --no-open)
            ABRIR=0
            ;;
        *)
            if [[ "$PUERTO_DADO" -eq 0 ]] && [[ "$arg" =~ ^[0-9]+$ ]]; then
                PUERTO="$arg"
                PUERTO_DADO=1
            fi
            ;;
    esac
done

if [[ "$PUERTO" =~ ^[0-9]+$ ]] && ((PUERTO >= 1 && PUERTO <= 65535)); then
    :
else
    echo "El puerto '$PUERTO' no es un número válido."
    uso
    exit 1
fi

# Comprueba si el puerto está libre antes de arrancar, para dar un mensaje
# claro en lugar del traceback del servidor. Se prueba IPv4 e IPv6: quedarse
# solo en 127.0.0.1 dejaba escapar servidores viejos atados a ::1.
puerto_libre() {
    if comando python3; then
        python3 - "$PUERTO" <<'PY'
import socket, sys
p = int(sys.argv[1])
for familia, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
    try:
        s = socket.socket(familia, socket.SOCK_STREAM)
    except OSError:
        continue
    try:
        try:
            s.bind((host, p))
        except OSError:
            sys.exit(1)
    finally:
        s.close()
PY
    elif comando node; then
        node -e '
const net = require("net");
const p = Number(process.argv[1]);
let libre = true;
const probar = host => {
    const t = net.createServer();
    t.once("error", () => { libre = false; });
    t.once("listening", () => t.close());
    t.listen(p, host);
};
probar("127.0.0.1");
probar("::1");
setTimeout(() => process.exit(libre ? 0 : 1), 400);
' "$PUERTO"
    else
        return 0
    fi
}

if ! puerto_libre; then
    echo "El puerto $PUERTO ya está en uso."
    echo "Prueba con otro: ./servir.sh 8001"
    exit 1
fi

# Antes de abrir el navegador se comprueba que esta copia del script vive
# junto a la app. Si alguien ejecuta una copia vieja o copiada a otro
# proyecto, aborta con un mensaje claro en lugar de servir otro index.
verificar_app() {
    local idx="$RAIZ/index.html"
    if [[ ! -f "$idx" ]] || ! grep -q 'Samantha Spa' "$idx"; then
        echo "Este script no apunta a Samantha Spa POS: la raíz es '$RAIZ'."
        echo "Ejecuta la copia de ~/Projects/samantha-spa-pos/servir.sh (o mueve"
        echo "este script junto al index.html de la app) y repite."
        exit 1
    fi
}

verificar_app

info() { printf '\n  %s\n' "$*"; }

printf '\n═══════════════════════════════════════\n'
printf '  Samantha Spa POS se sirve localmente\n'
printf '═══════════════════════════════════════\n'
info "Ruta:      $RAIZ"
info "App:       http://127.0.0.1:$PUERTO/"
info "Apagar:    Ctrl+C"
printf '\n'

SERVER_PID=0
SERVIDOR_TMP=""

limpiar() {
    if [[ -n "$SERVIDOR_TMP" ]] && [[ -f "$SERVIDOR_TMP" ]]; then
        rm -f "$SERVIDOR_TMP"
    fi
    if [[ "$SERVER_PID" -ne 0 ]]; then
        kill "$SERVER_PID" 2>/dev/null
    fi
}
trap limpiar INT TERM EXIT

if comando python3; then
    ( cd "$RAIZ" && exec python3 -m http.server "$PUERTO" --bind 127.0.0.1 ) &
    SERVER_PID=$!
elif comando node; then
    SERVIDOR_TMP="$(mktemp)"
    cat > "$SERVIDOR_TMP" <<'JS'
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.argv[2]);
const ROOT = path.resolve(process.argv[3]);
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json'
};
function servir(fp, res) {
    fs.readFile(fp, (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('500');
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream'
        });
        res.end(data);
    });
}
http.createServer((req, res) => {
    let ruta;
    try {
        ruta = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
        res.writeHead(400);
        return res.end('400');
    }
    const rel = path.normalize(ruta).replace(/^(\.\.[/\\])+/, '');
    const fp = path.join(ROOT, rel);
    if (!fp.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end('403');
    }
    fs.stat(fp, (err, st) => {
        if (err || !st.isFile()) {
            const base = path.join(fp, 'index.html');
            fs.stat(base, (err2, st2) => {
                if (err2 || !st2.isFile()) {
                    res.writeHead(404);
                    return res.end('404');
                }
                servir(base, res);
            });
            return;
        }
        servir(fp, res);
    });
}).listen(PORT, '127.0.0.1');
JS
    ( cd "$RAIZ" && exec node "$SERVIDOR_TMP" "$PUERTO" "$RAIZ" ) &
    SERVER_PID=$!
else
    echo "No encuentro ni python3 ni node para servir el proyecto."
    echo "Instala uno de los dos y vuelve a intentarlo."
    exit 1
fi

sleep 1

# Si el servidor hijo murió en el primer segundo (puerto secuestrado, falta
# de permisos...), avisar en lugar de abrir el navegador sobre un puerto
# muerto que mostraría otra página.
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "El servidor no pudo quedarse escuchando en el puerto $PUERTO."
    echo "Comprueba quién lo ocupa (ss -tln) y vuelve a intentarlo."
    exit 1
fi

if [[ "$ABRIR" -eq 1 ]] && comando xdg-open; then
    ( sleep 1; xdg-open "http://127.0.0.1:$PUERTO/" >/dev/null 2>&1 & ) 2>/dev/null
fi

wait "$SERVER_PID"