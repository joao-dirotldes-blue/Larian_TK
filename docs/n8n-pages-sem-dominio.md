# Guia passo a passo — n8n + Cloudflare (sem domínio próprio)
Objetivo: publicar o front no Cloudflare Pages e usar uma Function (/api) que proxya para seu backend local exposto por um Quick Tunnel (trycloudflare.com). Assim:
- n8n envia POST para https://SEU-PROJETO.pages.dev/api/flight (estável)
- O front abre com https://SEU-PROJETO.pages.dev/?flightUrl=/api/flight
- O UPSTREAM_API_BASE (trycloudflare do backend) pode mudar, e você só atualiza a env var no Pages (os endpoints para n8n e front continuam iguais)

Pré‑requisitos
- Conta Cloudflare (gratuita)
- Repositório GitHub conectado (este projeto)
- Node 18+ e Python 3 instalados localmente
- cloudflared instalado: macOS → `brew install cloudflared`

Arquivos já incluídos neste repo
- `functions/api/[[path]].js`: Function de proxy que encaminha /api/* para `env.UPSTREAM_API_BASE`.
- Front responsivo (index.html, styles.css, app.js) com heurística para Cloudflare.
- Documentação auxiliar: `docs/cloudflare.md`.

Passo 0 — Subir o backend local (porta 5174)
Abra um terminal:
```bash
cd ticket-larian
PORT=5174 node api.js
```
Saída esperada:
```
Flight API listening on http://localhost:5174
GET /health -> ok
...
```
Teste:
```bash
curl -s http://localhost:5174/health
# ok
```

Passo 1 — Criar um Quick Tunnel para o backend (trycloudflare)
Em outro terminal:
```bash
cloudflared tunnel --url http://localhost:5174
```
Copie a URL HTTPS exibida, por exemplo:
```
https://abc123-def456.trycloudflare.com
```
Teste:
```bash
curl -s https://abc123-def456.trycloudflare.com/health
# ok
```

Passo 2 — Conectar o projeto ao Cloudflare Pages
- Cloudflare Dashboard → Pages → Create a project → Conecte seu GitHub e selecione o repositório
- Build command: (deixe em branco)
- Output directory: `/` (raiz)
- Concluir para fazer o primeiro deploy

Passo 3 — Configurar a variável de ambiente no Pages
- Pages → seu projeto → Settings → Environment Variables
- Adicione:
  - Name: `UPSTREAM_API_BASE`
  - Value: `https://abc123-def456.trycloudflare.com` (sua URL do Passo 1)
- Faça um novo deploy (ou Re-deploy with new variables)

Passo 4 — Validar a Function /api
No navegador:
```
https://SEU-PROJETO.pages.dev/api/health
```
Deve retornar `ok` (proxyou para o backend via UPSTREAM_API_BASE).

Passo 5 — Configurar o n8n (node “SiteOrçamento”)
No seu workflow, ajuste o nó HTTP Request para enviar o objeto JSON (sem stringify):

- Method: `POST`
- URL: `https://SEU-PROJETO.pages.dev/api/flight`
- Headers:
  - `Content-Type: application/json`
- Send Body: `true`
- Body Content Type: `JSON`
- JSON Body (envie o objeto):
  ```
  ={{$('Buscar/Criar Sessão').item.json.detalhes_opcao_selecionada}}
  ```

Importante: não use `JSON.stringify(...)`. O n8n serializa automaticamente quando o tipo é JSON.

Caso precise testar manualmente, use este payload real (exemplo que você forneceu):
```bash
curl -i -X POST https://SEU-PROJETO.pages.dev/api/flight \
  -H "Content-Type: application/json" \
  -d '{"ida":{"data":"28/08/2025","valor":464.01,"origem":"GIG","bagagem":"Apenas bagagem de mão","destino":"SJK","duracao":"1h 05m","escalas":"Direto","IdViagem":196657,"companhia":"GOL LINHAS AÉREAS","numero_voo":"G3 2116","horario_chegada":"22:45","horario_partida":"21:40","valor_formatado":"R$ 464,01","IdentificacaoDaViagem":"NgoAAB+LCAAAAAAABAC9Vu1u4joQfZXK+5ePhCZ85F8aFDb3QokoVCutqpVJHLBq7MgOu72q+kD3Oe6L3bETQmGzEnSlRRDGM+PjOWfsJK/IR57dQgHyrBa6M9fwBXkZZoq00ANVyBtYxohS5DkjSKUYeWhyi1po9pzXqbEZWB1IXkB8DOGl2MtApCRK/ZzRBKcCeS64aS7MomOiCsoFLPH1Fc1h0iKaw7QxWA++tmKwelbPbVvDdm+wtCzPfFG5hGVZdtt8j5G3J2CBFQkYVopA0gqVjiWWNIOfrn1170f+xJnoEo17KQrMkHc7HHZGun7/sWIyXlVGSEhllTPmOZHAR+IjfwwOrIyCQaQ5kHToDPqOBQWOhm0nc3B75Pbh0ndvndTJhv3eAEp4FJUCs4kEBZEmPtXE0YnWYM7zwyBVVUSwmynlW6xu/P/+lQTWbyFfSzmJND3faPnX31rVh1Mxe7bnVGJ+NiHb0fY4OEvreY5bpZlQz3F12l7iBAvdBduztOd+vzModh8GD2SzI7zQ8UjXLvhRp9MB05KZLsXQJhC37k9PE3i3q+5+Ct5Vs7UZwv90qa34YEWJ4HoLbIsiV163+0OINW4rzNO1eOkUEn8njFH+3EnErrOW3VXOBE67TGzEDssEqy4Ecsy3FNNEuJ0NzQA1xDvKtPiv6F7sNP6UbraFYZnSjTisXo4iXhDJa2csSUZfzND0JxCa0id7hAfDtByHAqZoZ2Y+6A28ZjOXmyRYVHKFwakYIZZk+U8OU7/CGajliGdYPu8PGsaBX8VLFuPqXPxJNqenyzk7XoyqQpf41mrmetvMNZ5+hGvM9uo9VYNyTrWErqnG09WR6hCvnZRcSnXUGYyu4eo0c519+QjXGX55T9WAnFMtkWuqM//LkWq2dtd2diHVvvMrqk+1/YoeMTPYtrkRb8AKmd59EU+JLnZBMiIJTyiOoXhzziOeYV5QVt1BNFyklUONwDXu4Ul0GWjriNB3a4xiL/2EKCW+RenVOJP59ObzfDafzicNgKZFV0MuVnfjBrCV2kPvxfV48ERjDXgLkuyluhzvfH4gSWomsQ/o1qS+v/Svxgm1owGsPEV+Qb9fL9g94Vt46P0K1LzmXItptcyjthmxTPq9LbziNMUpUeYFJqGCY6rKRdSl7Xl6+x/cbDR3NgoAAA=="},"numero":2,"tipo_viagem":"somente_ida","valor_total":464.01,"valor_total_formatado":"R$ 464,01"}'
```

Passo 6 — Abrir o front e validar
- Abra:
```
https://SEU-PROJETO.pages.dev/?flightUrl=/api/flight&expiresIn=15m
```
- Resultado esperado:
  - Etapa 1 preenchida com dados (GIG → SJK, etc.)
  - Contador de validade funcionando
  - Botão para avançar de etapa

Passo 7 — Fluxo de reserva (duas opções)
- Demonstração sem backend de reserva:
  - Acrescente `&noback=1` na URL do front
  - No passo 3 (pagamento), a reserva é simulada e você vai para o resumo (passo 4), com “Baixar PDF”.
- Reserva real via backend:
  - O front chamará `POST /api/reservar` (proxy) → `UPSTREAM_API_BASE/reservar`
  - Garanta que seu backend local (api.js) esteja com credenciais Larian válidas em `.env`
  - Se der erro de negócio, a UI mostra a mensagem no passo 3

Boas práticas e observações
- HTTPS end‑to‑end: Pages e trycloudflare entregam TLS, evitando “mixed content”.
- Estabilidade dos URLs:
  - `SEU-PROJETO.pages.dev` é estável; `UPSTREAM_API_BASE` (trycloudflare) pode mudar. Se mudar, só atualize a env var e faça redeploy.
- CORS:
  - Por mesma origem (Pages + Function), o front não sofre CORS; o n8n faz server→server e também não sofre.
- Erros comuns:
  - 404 no console por favicon → pode ignorar.
  - 4xx em /api/reservar → verifique credenciais Larian e o body enviado; /debug/last-reserve do backend ajuda.

Checklist de validação final (n8n + front)
- [ ] `https://SEU-PROJETO.pages.dev/api/health` retorna `ok`
- [ ] n8n POST `https://SEU-PROJETO.pages.dev/api/flight` com JSON de exemplo retorna `{ ok: true }`
- [ ] Front `https://SEU-PROJETO.pages.dev/?flightUrl=/api/flight` exibe os dados
- [ ] (Opcional) `?noback=1` permite simular reserva e baixar PDF
- [ ] (Opcional) Reserva real via `/api/reservar` concluída com sucesso

Notas de custo
- Tudo acima funciona no plano gratuito do Cloudflare (Pages, Functions e quick tunnel).
