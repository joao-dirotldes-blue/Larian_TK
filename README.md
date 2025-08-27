# Emissão de Bilhete — Login + Reserva (Gateway Larian)

Fluxo completo:
- Step 1: preencher Voo + Passageiro (ou auto-carregar via `?flightUrl=`).
- Step 2: confirmar pagamento (simulado) → BACKEND faz:
  1) Login no gateway Larian: `POST {LARIAN_BASE}/login` com `{ email, password }`
  2) Reserva: `POST {LARIAN_BASE}/travellink/reservations` com `Authorization: Bearer {access_token}`
- Se a reserva retornar sucesso de negócio: habilita “Emitir Bilhete (PDF)”.
- Step 3: Emissão do PDF com pdf-lib.

## Pastas/Arquivos

- Frontend: `index.html`, `styles.css`, `app.js`
- Backend: `api.js` (Node http nativo)
  - `POST /flight` e `GET /flight` → guarda/retorna JSON do voo (memória)
  - `POST /reservar` → faz login no Larian e cria a reserva com Bearer
  - `GET /config`, `GET /reservar/check`, `GET /health` → diagnósticos/saúde
  - CORS liberado

## Requisitos

- Node.js 18+ (usa `fetch` nativo)
- Python 3 (para `python3 -m http.server 5173`)

## Scripts

- API (porta 5180):
  `npm run api:5180`
- UI (porta 5173):
  `npm run dev`

## Configuração (.env)

Crie um arquivo `.env` na raiz:

```
# Backend Larian (gateway interno que usa Wooba por baixo)
LARIAN_BASE=http://34.72.225.221:8000/api/v1
LARIAN_EMAIL=seller_user@larian.local
LARIAN_PASSWORD=seller123

# Porta da API local (opcional)
PORT=5180
```

Observações:
- `api.js` carrega `.env` automaticamente no boot.
- Reinicie a API após alterar `.env`.
- Logs ao subir:
  - `Flight API listening on http://localhost:5180`
  - `Larian base: ...`
  - `Larian credentials: configured|missing`

## Endpoints de diagnóstico (API local)

- `GET /config` → verifica base e credenciais carregadas.
- `GET /reservar/check` → retorna 200 OK se e-mail/senha estão presentes no backend.

Exemplo:
```bash
curl -s http://localhost:5180/config
curl -i http://localhost:5180/reservar/check
```

## Fluxo de uso

1) Suba a API e a UI
- Terminal 1: `npm run api:5180`
- Terminal 2: `npm run dev`

2) Publique o voo na API
- POST `http://localhost:5180/flight`
- Exemplo:
```json
{
  "data": "26/08/2025",
  "valor": 943.71,
  "valor_formatado": "R$ 943,71",
  "companhia": "GOL LINHAS AÉREAS",
  "numero_voo": "G3 1574",
  "origem": "CGH",
  "destino": "SSA",
  "horario_partida": "19:40",
  "horario_chegada": "22:10",
  "duracao": "2h 30m",
  "escalas": "Direto",
  "bagagem": "Apenas bagagem de mão",
  "IdentificacaoDaViagem": "… (string longa informada)"
}
```

3) Abra a UI
- `http://localhost:5173/index.html?flightUrl=http://localhost:5180/flight&apiBase=http://localhost:5180`
- Ao confirmar pagamento, o backend irá:
  - `POST {LARIAN_BASE}/login` → recebe `{ access_token }`
  - `POST {LARIAN_BASE}/travellink/reservations` com `Authorization: Bearer {access_token}` e o body de reserva (mesmo formato informado)

4) Regras de habilitação da emissão
- Emissão só habilita se a reserva for sucesso real de negócio:
  - HTTP 2xx E sem `SessaoExpirada`/`Exception`/`Reservas` vazia (o frontend valida isso).
- Se houver falha (HTTP 4xx/5xx ou erro de negócio), a UI mostra o motivo em “Pagamento” e mantém o botão de emissão desabilitado.

## Testes diretos (opcionais)

- Verificar credenciais carregadas:
```bash
curl -s http://localhost:5180/config
```

- Checar disponibilidade de credenciais:
```bash
curl -i http://localhost:5180/reservar/check
```

- Disparar reserva (API local faz login e envia Bearer automaticamente):
```bash
curl -i -X POST http://localhost:5180/reservar \
  -H "Content-Type: application/json" \
  -d '{"IdentificacaoDaViagem":"…","passengers":[{"CPF":"51993969861","Nome":"LUCAS","Sexo":"M","Email":"l@larian.com.br","Telefone":{"NumeroDDD":"17","NumeroDDI":"55","NumeroTelefone":"991497968"},"Sobrenome":"SANTOS DA SILVA","Nascimento":"2002-01-01","FaixaEtaria":"ADT"}]}'
```

## Mapeamentos e validações (frontend)

- `IdentificacaoDaViagem` é lida do body e persistida em `state.flight.reservationId` e no hidden `#reservaId`.
- Nome/Sobrenome: derivados de `nomeCompleto` (primeira palavra → Nome; restante → Sobrenome; ambos em caps).
- CPF/Telefone: sanitizados para dígitos.
- Em falha da reserva, a UI exibe status com código/motivo e mantém emissão bloqueada.

---

## Produção (Cloudflare — Pages/Workers/Tunnel)

Consulte o guia detalhado em docs/cloudflare.md.

A partir da versão “Cloudflare-friendly”, o front descobre a base da API (`apiBase`) usando a seguinte heurística:

1) Se houver `?apiBase=...` na URL: usa exatamente esse valor.

2) Senão, se houver `?flightUrl=...`:
   - Se for absoluto (https://host/flight), usa o `origin` desse URL como `apiBase` (base do backend).
   - Se for relativo (`/api/flight`), o `apiBase` vira a mesma origem + o prefixo (`/api`).

3) Caso nenhum parâmetro exista:
   - Se a página estiver em HTTPS ou sem porta (produção): usa mesma origem com prefixo `/api`. Ex.: `https://seusite.pages.dev/api`
   - Se for ambiente local (porta 5173): usa `http://localhost:5174`.

Além disso, se a página estiver em `https:` e o `apiBase` for `http://…` (sem TLS), o front tenta “upar” para `https://…` para evitar mixed content.

### Cenários recomendados

A) Mesmo domínio (Cloudflare Pages + Functions/Workers)
- Configure um Worker/Function que atenda:
  - `GET /api/flight`, `POST /api/flight`
  - `POST /api/reservar` (proxy para seu backend real)
- Abra o app com:
```
https://SEU_SITE.pages.dev/?flightUrl=/api/flight
```
- O front chamará `POST https://SEU_SITE.pages.dev/api/reservar`.

B) API em subdomínio HTTPS (Cloudflare Tunnel/Worker dedicado)
- Tenha o backend exposto em `https://api.SEUDOMINIO/...`
- Abra o app com:
```
https://SEU_SITE.pages.dev/?apiBase=https://api.SEUDOMINIO&flightUrl=https://api.SEUDOMINIO/flight
```
- O front usará exatamente essas URLs (sem heurísticas).

C) Sem backend (demonstração)
- Use dados inline e reserva simulada no front:
```
https://SEU_SITE.pages.dev/?noback=1&flight={"companhia":"AZUL","numero_voo":"AD1234","origem":"GRU","destino":"REC","data":"30/09/2025","horario_partida":"08:15","horario_chegada":"11:45","duracao":"3h30","escalas":"Direto","bagagem":"1 x 23kg","valor_formatado":"R$ 1.234,56","IdentificacaoDaViagem":"ABCDEF123456"}
```
- Encode o JSON de `flight` para URL (percent-encode).

### Observações importantes
- Evite “mixed content”: se o site estiver em `https`, a API também deve estar em `https` ou atrás do mesmo domínio (Functions/Workers).
- Se usar Worker de proxy, o CORS não é problema (mesma origem). Se for domínio separado, certifique-se de que a API responda com CORS adequado.
- Parâmetros úteis:
  - `expiresIn=15m` para ajustar a validade do orçamento.
  - `debug=1` para exibir ferramentas de depuração no passo 3.
  - `noback=1` para simular reserva (sem servidor) — útil em demos.
