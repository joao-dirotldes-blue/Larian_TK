# Guia de Implantação — Cloudflare (Pages / Functions / Tunnel)

Este guia mostra passo a passo como publicar o frontend no Cloudflare Pages e fazer o front falar com o backend usando:
- A) Pages + Functions (proxy em `/api`, mesma origem) — Recomendado
- B) Pages + API em subdomínio HTTPS via Cloudflare Tunnel
- C) Somente Pages, sem backend (dados inline e reserva simulada)

A versão atual do front já contém heurísticas para ambientes HTTPS/Cloudflare:
- Se a página estiver em HTTPS (produção) e você não passar `apiBase`, o front usa `location.origin + "/api"` por padrão.
- Se você passar `flightUrl`, o front deriva o `apiBase` a partir dele (absoluto ou relativo).
- Se a página for HTTPS e o `apiBase` vier em HTTP, o front tenta fazer upgrade para HTTPS para evitar mixed content.

## 0) Pré-requisitos

- Conta no Cloudflare
- Repositório no GitHub (`fabioperesblue/ticket-larian` ou fork)
- Opcional (para B): `cloudflared` instalado e um domínio gerenciado pelo Cloudflare

---

## A) Pages + Functions (proxy `/api`) — Recomendado

Arquitetura: o Pages serve os arquivos estáticos e uma Function lida com `/api/*` (proxy para seu backend real). Assim, o front e a API ficam na mesma origem/HTTPS, sem CORS nem mixed content.

### Passo a passo

1. Crie o projeto Pages
   - Dashboard Cloudflare → Pages → Create a project → Conecte o GitHub e selecione o repositório.
   - Build command: (vazio)
   - Output directory: (raiz) ou `/` (o projeto é estático puro).
   - Salve e deixe o primeiro deploy ocorrer.

2. Adicione uma Function de proxy
   - Você pode versionar as Functions no próprio repo.
   - Estrutura sugerida:
     ```
     functions/
       api/
         [[path]].js
     ```
   - Conteúdo de `functions/api/[[path]].js` (proxy genérico):
     ```js
     export async function onRequest(context) {
       const { request, env } = context;
       const url = new URL(request.url);

       // Configure no Pages > Settings > Environment Variables
       // ex.: UPSTREAM_API_BASE = https://api-seuapp.exemplo.com
       const upstreamBase = env.UPSTREAM_API_BASE;
       if (!upstreamBase) {
         return new Response(JSON.stringify({ error: "Missing UPSTREAM_API_BASE" }), {
           status: 500,
           headers: { "Content-Type": "application/json" },
         });
       }

       // Remove prefixo /api e repassa o path+query
       const upstream = new URL(upstreamBase.replace(/\/+$/, "") + url.pathname.replace(/^\/api/, ""));
       upstream.search = url.search;

       const init = {
         method: request.method,
         headers: new Headers(request.headers),
       };

       // Copia body para métodos com payload
       if (!["GET", "HEAD"].includes(request.method)) {
         init.body = request.body;
       }

       // Evita enviar host original
       init.headers.delete("host");

       const res = await fetch(upstream.toString(), init);

       // Retorna a resposta tal qual (streaming)
       return new Response(res.body, {
         status: res.status,
         headers: res.headers,
       });
     }
     ```
   - Commit e push (o Pages redeployará automaticamente).

3. Configure a variável UPSTREAM_API_BASE
   - Pages → seu projeto → Settings → Environment Variables
   - Adicione `UPSTREAM_API_BASE` com a base do seu backend.
     - Exemplos:
       - Backend próprio exposto em HTTPS (VM/serviço gerenciado): `https://api.seu-dominio.com`
       - Cloudflare Tunnel apontando para sua API local: `https://api-seuapp.ngrok-free.app` (ou o hostname do Tunnel)
   - Faça um novo deploy.

4. Teste no navegador
   - Acesse: `https://SEU_SITE.pages.dev/?flightUrl=/api/flight`
   - O front chamará:
     - `GET https://SEU_SITE.pages.dev/api/flight` (Function → proxy → `UPSTREAM_API_BASE/flight`)
     - `POST https://SEU_SITE.pages.dev/api/reservar` para reservar

5. Publicar um voo
   - Envie um JSON para o seu backend real (ele precisa oferecer `/flight`):
     ```
     POST ${UPSTREAM_API_BASE}/flight
     Content-Type: application/json

     {
       "companhia": "AZUL",
       "numero_voo": "AD1234",
       "origem": "GRU",
       "destino": "REC",
       "data": "30/09/2025",
       "horario_partida": "08:15",
       "horario_chegada": "11:45",
       "duracao": "3h30",
       "escalas": "Direto",
       "bagagem": "1 x 23kg",
       "valor_formatado": "R$ 1.234,56",
       "IdentificacaoDaViagem": "ABCDEF123456"
     }
     ```
   - Abra o app: `https://SEU_SITE.pages.dev/?flightUrl=/api/flight`

Dicas:
- Se seu backend ainda não estiver HTTPS, coloque-o atrás de um Tunnel (seção B) e use o hostname HTTPS do Tunnel em `UPSTREAM_API_BASE`.
- O front aceita `expiresIn=15m` (ex.: `?flightUrl=/api/flight&expiresIn=15m`) e `debug=1`.

---

## B) Pages + API em subdomínio via Cloudflare Tunnel

Arquitetura: o Pages serve o front; a API fica em um subdomínio HTTPS (ex.: `https://api.seu-dominio.com`) publicado com Cloudflare Tunnel.

### Passo a passo (resumo)

1. Instale e autentique o cloudflared
   ```bash
   brew install cloudflared   # macOS
   cloudflared tunnel login
   ```

2. Crie um Tunnel
   ```bash
   cloudflared tunnel create api-ticket
   ```

3. Configure o Tunnel para apontar ao seu backend
   - Backend local: `http://localhost:5174` (onde roda `api.js`)
   - Arquivo de config (ex.: `~/.cloudflared/config.yml`):
     ```yaml
     tunnel: api-ticket
     credentials-file: /Users/SEU_USUARIO/.cloudflared/<id-do-tunnel>.json
     ingress:
       - hostname: api.seu-dominio.com
         service: http://localhost:5174
       - service: http_status:404
     ```
   - No painel Cloudflare, crie um DNS para `api.seu-dominio.com` apontando ao Tunnel.

4. Inicie o Tunnel
   ```bash
   cloudflared tunnel run api-ticket
   ```

5. Abra o app Pages com parâmetros
   ```
   https://SEU_SITE.pages.dev/?apiBase=https://api.seu-dominio.com&flightUrl=https://api.seu-dominio.com/flight
   ```

---

## C) Somente Pages (sem backend) — Demonstração

- Use dados inline na query string e simule a reserva no front:
  ```
  https://SEU_SITE.pages.dev/?noback=1&flight={"companhia":"AZUL","numero_voo":"AD1234","origem":"GRU","destino":"REC","data":"30/09/2025","horario_partida":"08:15","horario_chegada":"11:45","duracao":"3h30","escalas":"Direto","bagagem":"1 x 23kg","valor_formatado":"R$ 1.234,56","IdentificacaoDaViagem":"ABCDEF123456"}
  ```
- Recomenda-se percent-encode do JSON para evitar problemas de caracteres.

---

## Como o front descobre a API (resumo técnico)

1. `?apiBase=...` → vence sempre.
2. Senão, se `?flightUrl=...`:
   - Absoluto: `apiBase = origin(flightUrl)` (ex.: `https://api.seu-dominio.com`)
   - Relativo: `apiBase = location.origin + prefixo` (ex.: `/api/flight` → `apiBase = location.origin + "/api"`)
3. Senão:
   - HTTPS/sem porta (produção): `apiBase = location.origin + "/api"`
   - Local 5173: `apiBase = http://localhost:5174`
4. Se a página é HTTPS e `apiBase` começa com HTTP, o front tenta atualizar para HTTPS.

---

## URLs de teste rápidas

- Pages + Functions (proxy):
  ```
  https://SEU_SITE.pages.dev/?flightUrl=/api/flight
  ```
- Pages + Tunnel (API dedicada):
  ```
  https://SEU_SITE.pages.dev/?apiBase=https://api.seu-dominio.com&flightUrl=https://api.seu-dominio.com/flight
  ```
- Sem backend:
  ```
  https://SEU_SITE.pages.dev/?noback=1&flight=... (JSON)
  ```

---

## Troubleshooting

- 404 no console:
  - Se for `favicon.ico`, é esperado e inofensivo.
  - Se for `/api/...`, verifique Function/UPSTREAM_API_BASE ou o Tunnel.
- Mixed content:
  - Se o site é HTTPS e a API é HTTP, o navegador bloqueia. Use HTTPS (Tunnel, Worker/Function, ou backend com TLS).
- CORS:
  - Pages + Functions (mesma origem) evita CORS.
  - Se usar domínio separado, o backend precisa responder com CORS adequado.
- Verifique logs:
  - Pages → Deployments (logs do Functions)
  - Tunnel: `cloudflared` logs

---

## Segurança

- Não exponha segredos no front. Se preciso, faça chamadas a serviços externos via Functions/Workers (server-side).
- Para credenciais do gateway Larian, mantenha-as restritas no backend (não no front). Functions podem atuar como camada de proxy se necessário.
