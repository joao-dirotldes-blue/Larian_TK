#!/usr/bin/env bash
# ticket-up.sh - Sobe/valida a stack Docker (backend+frontend) e imprime links finais
# Uso:
#   sudo ./scripts/ticket-up.sh [IP_PUBLICO] [ARQUIVO_JSON_SEED]
# Ex:
#   sudo ./scripts/ticket-up.sh 34.46.233.197 /opt/seed.json
# Se IP_PUBLICO não for informado, tenta detectar via metadata do GCP; se falhar, via ipify.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/ticket-larian}"
BRANCH="${BRANCH:-feat/docker-compose-gcp}"
PORT_EXPECTED="${PORT_EXPECTED:-5174}"

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
note()  { printf "\033[36m%s\033[0m\n" "$*"; }
ok()    { printf "\033[32m%s\033[0m\n" "$*"; }
warn()  { printf "\033[33m%s\033[0m\n" "$*"; }
err()   { printf "\033[31m%s\033[0m\n" "$*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Comando obrigatório não encontrado: $1"; exit 1; }
}

need_cmd curl
need_cmd docker
need_cmd git
need_cmd sed

EXT_IP="${1:-}"
SEED_FILE="${2:-}"

bold "1) Garantindo código e .env ($REPO_DIR)"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  err "Repositório não encontrado em $REPO_DIR"
  err "Clone primeiro: sudo git clone https://github.com/fabioperesblue/ticket-larian.git $REPO_DIR"
  exit 1
fi
cd "$REPO_DIR"
git fetch origin >/dev/null 2>&1 || true
git checkout "$BRANCH" >/dev/null 2>&1 || true
git pull --ff-only || true

if [[ ! -f .env ]]; then
  cp .env.example .env
  warn "Arquivo .env criado a partir de .env.example; ajuste credenciais se necessário."
fi

# Garante PORT=5174 para casar com Nginx (proxy /api -> backend:5174)
if grep -q '^PORT=' .env; then
  if ! grep -q '^PORT=5174' .env; then
    sed -i 's/^PORT=.*/PORT=5174/' .env
    note "Ajustado PORT=5174 no .env"
  fi
else
  echo "PORT=5174" >> .env
  note "Adicionado PORT=5174 ao .env"
fi

bold "2) Subindo stack com Docker Compose"
docker compose up -d --build

bold "3) Aguardando saúde do backend via Nginx (/api/health)"
ATTEMPTS=0
until curl -fsS http://127.0.0.1/api/health | grep -qi '^ok$'; do
  ATTEMPTS=$((ATTEMPTS+1))
  if (( ATTEMPTS > 120 )); then
    err "Timeout aguardando /api/health (via Nginx)."
    note "Dicas: docker compose logs -f backend | frontend"
    exit 1
  fi
  sleep 2
done
ok "Backend respondeu OK via Nginx"

bold "4) Detectando IP público"
if [[ -z "$EXT_IP" ]]; then
  # Tenta metadata GCP
  if curl -fsS -H "Metadata-Flavor: Google" \
      "http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" >/dev/null 2>&1; then
    EXT_IP="$(curl -fsS -H 'Metadata-Flavor: Google' \
      'http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip')"
  else
    # Fallback: ipify
    EXT_IP="$(curl -fsS https://api.ipify.org || true)"
  fi
fi

if [[ -z "$EXT_IP" ]]; then
  err "Não foi possível detectar IP público automaticamente."
  err "Informe manualmente: sudo ./scripts/ticket-up.sh 34.46.233.197"
  exit 1
fi
ok "IP público detectado: $EXT_IP"

bold "5) (Opcional) Semear /api/flight"
if [[ -n "${SEED_FILE}" ]]; then
  if [[ -f "$SEED_FILE" ]]; then
    note "Publicando voo a partir de ${SEED_FILE}"
    HTTP_CODE="$(curl -sS -o /tmp/seed.out -w '%{http_code}' -X POST \
      "http://${EXT_IP}/api/flight" -H 'Content-Type: application/json' \
      --data-binary @"${SEED_FILE}")" || true
    if [[ "$HTTP_CODE" == "200" ]]; then
      ok "Seed publicado com sucesso"
    else
      warn "Falha ao semear (HTTP ${HTTP_CODE}). Corpo:"
      cat /tmp/seed.out || true
    fi
  else
    warn "Arquivo de seed não encontrado: ${SEED_FILE} (ignorando)"
  fi
else
  note "Nenhum arquivo de seed informado; pulando este passo."
fi

bold "6) Links finais"
USER_LINK="http://${EXT_IP}/?flightUrl=/api/flight&expiresIn=15m"
USER_LINK_DEMO="http://${EXT_IP}/?flightUrl=/api/flight&expiresIn=15m&noback=1"
N8N_ENDPOINT="http://${EXT_IP}/api/flight"
HEALTH="http://${EXT_IP}/api/health"

echo ""
ok "Health check: ${HEALTH}"
ok "Endpoint para o n8n (POST JSON sem stringify): ${N8N_ENDPOINT}"
ok "Link para o usuário (produção): ${USER_LINK}"
ok "Link para o usuário (demo sem backend de reserva): ${USER_LINK_DEMO}"
echo ""

bold "Pronto! Se o usuário abrir o link acima, verá o orçamento com os dados de /api/flight."
bold "No n8n: configure o nó HTTP Request para POST ${N8N_ENDPOINT} com body JSON (objeto, sem stringify)."
