/**
 * Minimal API to accept a POST body with flight data and expose it via GET.
 * Usage:
 *   node api.js
 * Endpoints:
 *   POST /flight    -> body: JSON (conforme contrato); salva em memória
 *   GET  /flight    -> retorna o último JSON salvo
 *   GET  /health    -> 200 ok
 * CORS: liberado para origens externas (site pode usar ?flightUrl=http://localhost:5174/flight)
 */
const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

// Carrega .env (opcional) para preencher process.env antes de ler variáveis
(function loadDotEnv() {
  try {
    if (fs.existsSync(".env")) {
      const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (!line || /^\s*#/.test(line)) continue;
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) {
          const key = m[1];
          let val = m[2];
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) process.env[key] = val;
        }
      }
    }
  } catch {}
})();

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;

// API Larian (gateway interno que usa Wooba por baixo)
// Login:        POST {base}/login          -> { email, password }  => { access_token }
// Reservar:     POST {base}/travellink/reservations  (Bearer {token})
const LARIAN_BASE = process.env.LARIAN_BASE || "http://34.72.225.221:8000/api/v1";
const LARIAN_EMAIL = process.env.LARIAN_EMAIL || "seller_user@larian.local";
const LARIAN_PASSWORD = process.env.LARIAN_PASSWORD || "seller123";

// Timeouts (ms) - aumentados para evitar timeouts prematuros
const LOGIN_TIMEOUT = Number(process.env.LARIAN_LOGIN_TIMEOUT_MS || 30000); // 30s
const RESERVE_TIMEOUT = Number(process.env.LARIAN_RESERVE_TIMEOUT_MS || 240000); // 240s (4 min)
const ISSUE_TIMEOUT = Number(process.env.LARIAN_ISSUE_TIMEOUT_MS || 120000); // 120s (2 min)

// Mock de IdentificacaoDaViagem (para testes) com possibilidade de override por .env e por endpoint
const DEFAULT_MOCK_IDENTIFICACAO =
  process.env.DEFAULT_MOCK_IDENTIFICACAO ||
  "qQwAAB+LCAAAAAAABADlVmtv4jgU/Ssj70egxBRKQJoPJmkoUx4pJEw7o6oyiYFMkzi1k/Ko+t/XdtKyMKw0VNrZlTbicX3v9bHv8fFVXgACbVgGBmhrZdBRv9YatOc45KQMJgEH7Rq8UFbPB+1GTeQGGLQBMkEZDB6T91xbDbQzgTAWcRl2aMYM6pOej5Iw8LBP1QJOkFC1qkl4GsRUrPH9BYzEpAkaiWmmsMY9adnCqmm1RgVqFa3laFpbfUC+hKZpsKI+u8jrvSgDc2KEmHMiklyQOxzMgrn4yr27Rn/0tabLHSqvQ1McgnazpTaPpkUZplsYFiGFleePEsJEMQzvisfCgbkqz+jJAvxz7aJBGk2xu5ZeqbdgqzJrNhuVJm5ctHSo69iXdUxpUf6gywR9QLj64g+CPZ6FOSqiPi/82ywUQyRpM7pX0pTLTkxZsDk5IK7ZhgVxVzKkNaG0TeMgTd+lyZCm52kZwx6m0gHz6DCLxOhCa8jBhCwiEqcy3pN7pfGOlv1BKBkCU3mw4kgEl3IENc2AnS7YU1Dnp2CnmC1NS/xbJWnZb1bPo7E87mWaJrxdra4oneEKx7E/o+uzlOFnEoZB/Hjm0ehsxqpuElLsV0O6oBFmHuZVEUhwvAxw4FEI4VkSLwSuhaMglIS/gCGNyI54oetgQd+Wz0e9OCUsfnfajMyDtRyib65KkjX9odUhqdfysUXFFOmcqwe8Cq9Sbi4KY1zwZRn7bFiYEWeTiKnfheDf+bAHmD1mbyTaBirieRFmcQl+YzH7l6l+cJvCgKeqzikOFdzkyn7wFwihTqlvoPzpINQ3Ue26paeboe3AwWVob7ZDaDj9XmB7Q2+y3freY6brcMPsm74fbM+f9Kdn3XZX5k24MfTRjX7udTb67S3qhSuKrNGNi/DT9ULnAzYceT/u4DC+hTMv6HulR9s4719v6+mX7bkJoXWbru6QF9/dVa/u5HY+q66xEJsdzeeE9eT1HBNhkdgLsI3XuUZ78RzHaRAW6n8t74ps1d8h0oy5ceBjn3DVU7yAxjjgyCOcU9lwT8XegxY9OyUR5g9592UOXmODRrNMdF1xHX4N/F7CKx267psQd/3zZx3a44/ocCCq/nQoRgV1KMYc/12MJfTtL2IUj2UdiNFSz39SjNGKox9O6dJYLL52l3NWXy55NK0uLyKHXnZniZWQySzE06j0hTUayfPVcvtUnw5vOnXWXzfV3tDn/58g748c1j+wjnBJ2YPftN7fHkhO/sMHyJcX6tOQPtMjcOrinQp4BMflmbjM9GSorlBXeARvTLyM8V/HO5xvMOKrSeEHCDtGO3LQyTiWdBwBy9siEqo4nTCbME+8ZmVHWcuB1Yv1qbhaWb3SHUfMk/71hnL/+ic2g7WWqQwAAA==";
let fallbackIdentificacao =
  process.env.LARIAN_MOCK_IDENTIFICACAO ||
  process.env.MOCK_IDENTIFICACAO ||
  DEFAULT_MOCK_IDENTIFICACAO;

let lastReserveDebug = null;

// Armazenamento em memória para ofertas com expiração
const ofertaStore = new Map();
const OFERTA_TTL_MS = 1 * 60 * 60 * 1000; // 1 hora

let lastFlightBody = null;
let lastUpdatedAt = null;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mock-Identificacao");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

function sendJson(res, status, obj) {
  setCors(res);
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendText(res, status, text) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

// Envio de PDF (binário) com headers apropriados
function sendPdf(res, pdfBytes, filename) {
  try {
    setCors(res);
    const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename || "bilhete.pdf"}"`,
      "Content-Length": buf.length
    });
    return res.end(buf);
  } catch (e) {
    return sendJson(res, 500, { error: "PDF_SEND_ERROR", details: String(e.message || e) });
  }
}

// Helpers compartilhados com o front para geração de PDF no servidor
function sanitizeFilename(name) {
  return (name || "")
    .trim()
    .replace(/[^\p{L}\p{N}\-_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "documento";
}

function toIsoDate(dmy) {
  if (!dmy) return "";
  const m = String(dmy).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function pdfSafe(s) {
  return String(s ?? "")
    .replace(/\u2192/g, "->")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u00A0/g, " ");
}

function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [""];
  const words = String(text).replace(/\r\n/g, "\n").split(/\s+/);
  const lines = [];
  let currLine = "";
  const flush = () => {
    if (currLine.length > 0) lines.push(currLine.trim());
    currLine = "";
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.includes("\n")) {
      const parts = word.split("\n");
      for (let j = 0; j < parts.length; j++) {
        const piece = parts[j];
        const testLine = currLine ? currLine + " " + piece : piece;
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width <= maxWidth) {
          currLine = testLine;
        } else {
          flush();
          currLine = piece;
        }
        if (j < parts.length - 1) flush();
      }
      continue;
    }
    const testLine = currLine ? currLine + " " + word : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currLine = testLine;
    } else {
      if (!currLine) {
        let partial = "";
        for (const ch of word) {
          const t = partial + ch;
          const w = font.widthOfTextAtSize(t, fontSize);
          if (w <= maxWidth) partial = t;
          else {
            lines.push(partial);
            partial = ch;
          }
        }
        currLine = partial;
      } else {
        flush();
        currLine = word;
      }
    }
  }
  flush();
  return lines.length ? lines : [""];
}

async function generateTicketPdf(opt, pax, pay) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 retrato
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const contentWidth = width - margin * 2;

  const title = "Bilhete Aéreo";
  const titleSize = 20;
  page.drawText(title, {
    x: margin,
    y: height - margin - titleSize,
    size: titleSize,
    font: fontBold,
    color: rgb(0.18, 0.2, 0.6),
  });

  page.drawRectangle({
    x: margin,
    y: height - margin - titleSize - 11,
    width: width - margin * 2,
    height: 1,
    color: rgb(0.8, 0.82, 0.95),
  });

  let cursorY = height - margin - titleSize - 26;
  const labelSize = 10;
  const textSize = 12;
  const lineGap = 6;
  const blockGap = 12;

  function drawLabel(label) {
    page.drawText(pdfSafe(label), {
      x: margin,
      y: cursorY,
      size: labelSize,
      font: fontBold,
      color: rgb(0.35, 0.37, 0.45),
    });
    cursorY -= labelSize + 2;
  }

  function drawValue(value) {
    const safeText = pdfSafe(value || "-");
    const lines = wrapText(safeText, font, textSize, contentWidth);
    lines.forEach((ln) => {
      page.drawText(pdfSafe(ln), {
        x: margin,
        y: cursorY,
        size: textSize,
        font,
        color: rgb(0.05, 0.07, 0.1),
      });
      cursorY -= textSize + lineGap;
    });
    cursorY -= blockGap - lineGap;
  }

  drawLabel("Voo selecionado");
  drawValue(
    [
      opt?.airlineLine,
      opt?.routeLine || (opt?.origin && opt?.destination ? `${opt.origin} → ${opt.destination}` : ""),
      `Data: ${opt?.date || "-"}`,
      `Horário: ${opt?.depart || "-"} -> ${opt?.arrive || "-"}`,
      `Duração: ${opt?.duration || "-"}`,
      `Escalas: ${opt?.stops || "-"}`,
      `Bagagem: ${opt?.baggage || "-"}`,
      `Total: ${opt?.total || "-"}`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  drawLabel("Passageiro");
  drawValue(
    [
      `Nome: ${pax?.nomeCompleto || "-"}`,
      `CPF: ${pax?.cpf || "-"}`,
      `Telefone: ${pax?.telefone || "-"}`,
      `E-mail: ${pax?.email || "-"}`,
    ].join("\n")
  );

  drawLabel("Pagamento");
  drawValue(
    [
      `Método: ${pay?.method || "-"}`,
      `Status: ${pay?.confirmed ? "Confirmado" : "Pendente"}`,
    ].join("\n")
  );

  const footer = `Emitido em ${new Date().toLocaleString("pt-BR")}`;
  const footerSize = 9;
  page.drawText(footer, {
    x: margin,
    y: margin - 6,
    size: footerSize,
    font,
    color: rgb(0.45, 0.48, 0.55),
  });

  return pdfDoc.save();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }

    if (method === "GET" && pathname === "/health") {
      return sendText(res, 200, "ok");
    }

    // Endpoints para criar e buscar ofertas
    if (pathname.startsWith("/api/oferta")) {
      if (method === "POST" && pathname === "/api/oferta") {
        let rawBody = "";
        req.on("data", (c) => (rawBody += c));
        req.on("end", () => {
          try {
            const body = JSON.parse(rawBody || "{}");
            if (!body || typeof body !== 'object' || !body.ida) {
              return sendJson(res, 400, { error: "INVALID_PAYLOAD", message: "Payload da oferta é inválido." });
            }
            const id = Math.random().toString(36).slice(2, 8);
            const expiry = Date.now() + OFERTA_TTL_MS;
            ofertaStore.set(id, { payload: body, expiry });
            console.log(`[oferta] Oferta criada com ID: ${id}. Expira em: ${new Date(expiry).toLocaleTimeString()}`);
            
            // Agendamento para limpar a oferta expirada
            setTimeout(() => {
              console.log(`[oferta] Oferta ${id} expirou e foi removida.`);
              ofertaStore.delete(id);
            }, OFERTA_TTL_MS);

            return sendJson(res, 201, { id });
          } catch (e) {
            return sendJson(res, 400, { error: "JSON_PARSE_ERROR" });
          }
        });
        return;
      }

      if (method === "GET") {
        const match = pathname.match(/^\/api\/oferta\/([a-zA-Z0-9]+)$/);
        if (match) {
          const id = match[1];
          console.log(`[oferta] Buscando oferta com ID: ${id}`);
          const record = ofertaStore.get(id);
          if (record && record.expiry > Date.now()) {
            console.log(`[oferta] Oferta encontrada para o ID: ${id}`);
            return sendJson(res, 200, record.payload);
          } else {
            if (record) {
              console.log(`[oferta] Oferta encontrada para o ID: ${id}, mas está expirada.`);
              ofertaStore.delete(id); // Limpa se expirou
            } else {
              console.log(`[oferta] Nenhuma oferta encontrada para o ID: ${id}`);
            }
            return sendJson(res, 404, { error: "NOT_FOUND", message: "Oferta não encontrada ou expirada." });
          }
        }
      }
      
      return sendJson(res, 404, { error: "Not Found" });
    }

    // Debug simples para verificar se as credenciais foram carregadas
    if (method === "GET" && pathname === "/config") {
      return sendJson(res, 200, {
        larianBase: LARIAN_BASE,
        hasEmail: !!LARIAN_EMAIL,
        hasPassword: !!LARIAN_PASSWORD,
        hasFallbackIdentificacao: !!fallbackIdentificacao,
        fallbackPreview: fallbackIdentificacao
          ? String(fallbackIdentificacao).slice(0, 24) + "…"
          : null,
        timeouts: {
          loginMs: LOGIN_TIMEOUT,
          reserveMs: RESERVE_TIMEOUT
        }
      });
    }

    // Verificação rápida do /reservar (sem chamar a Larian)
    if (method === "GET" && (pathname === "/reservar/check" || pathname === "/api/reservar/check")) {
      if (!LARIAN_EMAIL || !LARIAN_PASSWORD) {
        return sendJson(res, 401, {
          error: "Credenciais ausentes (defina LARIAN_EMAIL e LARIAN_PASSWORD).",
          code: "MISSING_CREDENTIALS"
        });
      }
      return sendJson(res, 200, {
        ok: true,
        hasEmail: true,
        hasPassword: true,
        hasFallbackIdentificacao: !!fallbackIdentificacao,
        timeouts: {
          loginMs: LOGIN_TIMEOUT,
          reserveMs: RESERVE_TIMEOUT
        }
      });
    }

    // Última reserva (debug)
    if (method === "GET" && pathname === "/debug/last-reserve") {
      if (!lastReserveDebug) {
        return sendJson(res, 404, { error: "Nenhuma reserva registrada ainda." });
      }
      return sendJson(res, 200, lastReserveDebug);
    }

    // Endpoint para configurar/consultar IdentificacaoDaViagem mock via automação (ex.: n8n)
    if (pathname === "/identificacao") {
      if (method === "GET") {
        return sendJson(res, 200, {
          IdentificacaoDaViagem: fallbackIdentificacao || null,
          preview: fallbackIdentificacao ? String(fallbackIdentificacao).slice(0, 24) + "…" : null,
        });
      }
      if (method === "POST") {
        let rawBody = "";
        req.on("data", (c) => (rawBody += c));
        req.on("end", () => {
          try {
            const b = JSON.parse(rawBody || "{}");
            const v = b.IdentificacaoDaViagem || b.identificacaoDaViagem || b.identificacao_viagem || b.identificacao || b.value || "";
            if (!v || typeof v !== "string" || v.length < 20) {
              return sendJson(res, 400, { error: "IdentificacaoDaViagem inválida." });
            }
            fallbackIdentificacao = v;
            return sendJson(res, 200, {
              ok: true,
              preview: String(fallbackIdentificacao).slice(0, 24) + "…",
            });
          } catch (e) {
            return sendJson(res, 400, { error: "JSON inválido" });
          }
        });
        return;
      }
      return sendJson(res, 405, { error: "Method Not Allowed" });
    }

    // PDF: gera bilhete PDF no servidor (POST /pdf)
    if (method === "POST" && pathname === "/pdf") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) req.destroy();
      });
      req.on("end", async () => {
        try {
          const body = JSON.parse(raw || "{}");
          const flight = body.flight || body.voo || body;
          const pax = body.passenger || body.passageiro || {};
          const pay = body.payment || body.pagamento || { method: "pix", confirmed: true };

          const pdfBytes = await generateTicketPdf(flight || {}, pax || {}, pay || {});
          const route =
            (flight?.origin && flight?.destination) ? `${flight.origin}-${flight.destination}` :
            (flight?.routeLine ? String(flight.routeLine).replace(/\s*→\s*/g, "-") : "voo");
          const dateIso = toIsoDate(flight?.date) || new Date().toISOString().slice(0, 10);
          const filename = `bilhete_${sanitizeFilename(pax?.nomeCompleto || "passageiro")}_${route}_${dateIso}.pdf`;

          return sendPdf(res, Buffer.from(pdfBytes), filename);
        } catch (e) {
          return sendJson(res, 400, { error: "INVALID_BODY", details: String(e.message || e) });
        }
      });
      return;
    }

    // Proxy: realiza login no gateway Larian e, em seguida, cria a reserva com Bearer token
    if (method === "POST" && (pathname === "/reservar" || pathname === "/api/reservar")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) req.destroy();
      });
      req.on("end", async () => {
        try {
          const reqId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
          const payload = raw ? JSON.parse(raw) : {};
          // Normaliza identificador (aceita IdentificacaoDaViagem, identificacaoDaViagem, identificacao_viagem)
          function getIdent(obj) {
            if (!obj || typeof obj !== "object") return "";
            return (
              obj.IdentificacaoDaViagem ||
              obj.identificacaoDaViagem ||
              obj.identificacao_viagem ||
              ""
            );
          }
          const headerIdent = req.headers["x-mock-identificacao"];
          const identParam = url.searchParams.get("ident");
          const source =
            getIdent(payload)
              ? "payload"
              : getIdent(lastFlightBody)
              ? "lastFlightBody"
              : headerIdent
              ? "header"
              : identParam
              ? "query"
              : "fallback";
          const selectedIdent =
            getIdent(payload) ||
            getIdent(lastFlightBody) ||
            headerIdent ||
            identParam ||
            fallbackIdentificacao;

          if (!getIdent(payload) && selectedIdent) {
            payload.IdentificacaoDaViagem = selectedIdent;
          }

          console.log("[reservar][" + reqId + "] start", {
            IdentificacaoDaViagem: (payload?.IdentificacaoDaViagem || "").toString().slice(0, 24) + "…",
            source,
            timeouts: { loginMs: LOGIN_TIMEOUT, reserveMs: RESERVE_TIMEOUT }
          });
          
          if (!LARIAN_EMAIL || !LARIAN_PASSWORD) {
            return sendJson(res, 401, {
              error: "Credenciais ausentes (defina LARIAN_EMAIL e LARIAN_PASSWORD).",
              code: "MISSING_CREDENTIALS",
            });
          }

          // Mock de sucesso opcional para testes rápidos
          const forceMock = url.searchParams.get("mock") === "1" || process.env.RESERVAR_FORCE_MOCK === "1";
          if (forceMock) {
            const mockId = (reqId.replace(/[^A-Za-z0-9]/g, "").toUpperCase()).slice(0, 6) || "PNRMOCK";
            lastReserveDebug = {
              reqId,
              source,
              selectedIdentPreview: String(payload?.IdentificacaoDaViagem || "").slice(0, 24) + "…",
              payloadPreview: JSON.stringify(payload).slice(0, 400),
              loginDuration: 0,
              reserveDuration: 0,
              totalDuration: 0,
              reserveStatus: 200,
              timeouts: { loginMs: LOGIN_TIMEOUT, reserveMs: RESERVE_TIMEOUT },
              mock: true
            };
            return sendJson(res, 200, {
              Reservas: [{ CodigoReserva: mockId }],
              Mensagem: "MOCK_OK",
              _mock: true
            });
          }

          // 1) Login para obter access_token (com timeout)
          const loginController = new AbortController();
          const loginStart = Date.now();
          const loginTimer = setTimeout(() => {
            console.log("[reservar][" + reqId + "] login timeout after", LOGIN_TIMEOUT, "ms");
            loginController.abort();
          }, LOGIN_TIMEOUT);
          
          let loginRes;
          try {
            console.log("[reservar][" + reqId + "] login attempt to", `${LARIAN_BASE}/login`);
            loginRes = await fetch(`${LARIAN_BASE}/login`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ email: LARIAN_EMAIL, password: LARIAN_PASSWORD }),
              signal: loginController.signal,
            });
          } catch (e) {
            clearTimeout(loginTimer);
            if (e && e.name === "AbortError") {
              console.log("[reservar][" + reqId + "] login timeout");
              return sendJson(res, 504, { 
                error: "Login timeout", 
                timeoutMs: LOGIN_TIMEOUT,
                details: "O servidor de autenticação não respondeu a tempo"
              });
            }
            console.error("[reservar][" + reqId + "] login network error:", e.message);
            throw e;
          } finally {
            clearTimeout(loginTimer);
          }
          
          const loginText = await loginRes.text();
          const loginDuration = Date.now() - loginStart;
          console.log("[reservar][" + reqId + "] login status", loginRes.status, "ms", loginDuration, "body", loginText.slice(0, 400));
          
          let loginJson;
          try {
            loginJson = JSON.parse(loginText);
          } catch {
            loginJson = { raw: loginText };
          }
          if (!loginRes.ok) {
            return sendJson(res, loginRes.status, {
              error: "Falha no login",
              details: loginJson,
              duration: loginDuration
            });
          }
          const token = loginJson?.access_token || loginJson?.accessToken || loginJson?.token;
          console.log("[reservar][" + reqId + "] token len", token ? String(token).length : 0);
          if (!token) {
            return sendJson(res, 502, {
              error: "Token de acesso não retornado pelo login",
              details: loginJson,
            });
          }

          // 2) Criar reserva com Bearer token
          console.log("[reservar][" + reqId + "] calling", `${LARIAN_BASE}/travellink/reservations`, "with timeout", RESERVE_TIMEOUT, "ms");
          const reserveController = new AbortController();
          const reserveStart = Date.now();
          const reserveTimer = setTimeout(() => {
            console.log("[reservar][" + reqId + "] reserve timeout after", RESERVE_TIMEOUT, "ms");
            reserveController.abort();
          }, RESERVE_TIMEOUT);
          
          let reserveRes;
          try {
            reserveRes = await fetch(`${LARIAN_BASE}/travellink/reservations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                IdentificacaoDaViagem: payload.IdentificacaoDaViagem,
                IdentificacaoDaViagemVolta: payload.IdentificacaoDaViagemVolta || undefined,
                passengers: (payload.passengers || []).map(p => ({
                  Nome: p.Nome,
                  Sobrenome: p.Sobrenome,
                  Nascimento: p.Nascimento,
                  Sexo: p.Sexo,
                  FaixaEtaria: p.FaixaEtaria || "ADT",
                  CPF: p.CPF,
                  Telefone: p.Telefone ? {
                    NumeroDDD: p.Telefone.NumeroDDD,
                    NumeroTelefone: p.Telefone.NumeroTelefone,
                    NumeroDDI: p.Telefone.NumeroDDI || "55"
                  } : undefined,
                  Email: p.Email
                })),
                CobrancaDeServico: payload.CobrancaDeServico || undefined
              }),
              signal: reserveController.signal,
            });
          } catch (e) {
            clearTimeout(reserveTimer);
            if (e && e.name === "AbortError") {
              console.log("[reservar][" + reqId + "] reserve timeout");
              return sendJson(res, 504, { 
                error: "Reserva timeout", 
                timeoutMs: RESERVE_TIMEOUT,
                details: "A API de reservas não respondeu a tempo. Tente novamente."
              });
            }
            console.error("[reservar][" + reqId + "] reserve network error:", e.message);
            throw e;
          } finally {
            clearTimeout(reserveTimer);
          }

          const reserveText = await reserveRes.text();
          const reserveDuration = Date.now() - reserveStart;
          console.log("[reservar][" + reqId + "] reserve status", reserveRes.status, "ms", reserveDuration, "body", reserveText.slice(0, 400));
          
          let reserveJson;
          try {
            reserveJson = JSON.parse(reserveText);
          } catch {
            reserveJson = { raw: reserveText };
          }
          
          // Salva informações de depuração da última tentativa
          lastReserveDebug = {
            reqId,
            source,
            selectedIdentPreview: String(payload?.IdentificacaoDaViagem || "").slice(0, 24) + "…",
            payloadPreview: JSON.stringify(payload).slice(0, 400),
            loginDuration,
            reserveDuration,
            totalDuration: Date.now() - loginStart,
            reserveStatus: reserveRes.status,
            timeouts: { loginMs: LOGIN_TIMEOUT, reserveMs: RESERVE_TIMEOUT }
          };

          // Reclassifica erro de negócio (mesmo com HTTP 200) como 422 para ficar explícito no cliente
          const businessError =
            reserveJson &&
            (reserveJson.SessaoExpirada === true ||
              reserveJson.Exception ||
              ("Reservas" in reserveJson &&
                (reserveJson.Reservas == null ||
                  (Array.isArray(reserveJson.Reservas) && reserveJson.Reservas.length === 0))));
          if (businessError) {
            const code =
              (reserveJson.Exception && (reserveJson.Exception.Code || reserveJson.Exception.code)) ||
              reserveJson.Code ||
              reserveJson.code ||
              null;
            const baseMsg =
              (reserveJson.Exception && (reserveJson.Exception.Message || reserveJson.Exception.message)) ||
              reserveJson.Mensagem ||
              reserveJson.mensagem ||
              reserveJson.error ||
              reserveJson.Error ||
              "Erro de negócio";
            const msg = code ? `(Code: ${code}) ${baseMsg}` : baseMsg;
            try {
              lastReserveDebug = {
                ...(lastReserveDebug || {}),
                businessCode: code || null,
                businessMessage: baseMsg || null
              };
            } catch {}
            return sendJson(res, 422, {
              error: "BUSINESS_ERROR",
              code: code || undefined,
              message: msg,
              data: reserveJson,
              _debug: lastReserveDebug
            });
          }
          
          return sendJson(res, reserveRes.ok ? 200 : reserveRes.status, reserveJson);
        } catch (e) {
          console.error("[reservar] error", e);
          return sendJson(res, 500, {
            error: "Forward error",
            details: String(e.message || e),
          });
        }
      });
      return;
    }

    // Emissão: exige localizador (PNR) já criado previamente pela reserva
    if (method === "POST" && (pathname === "/emitir" || pathname === "/api/emitir")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) req.destroy();
      });
      req.on("end", async () => {
        try {
          const body = JSON.parse(raw || "{}");
          const localizador = body.localizador || body.Localizador;

          if (!localizador) {
            return sendJson(res, 400, { error: "MISSING_LOCATOR", message: "Informe 'localizador' para emitir." });
          }
          if (!LARIAN_EMAIL || !LARIAN_PASSWORD) {
            return sendJson(res, 401, {
              error: "MISSING_CREDENTIALS",
              message: "Defina LARIAN_EMAIL e LARIAN_PASSWORD no ambiente.",
            });
          }

          // 1) Login para obter access_token
          const loginController = new AbortController();
          const loginTimer = setTimeout(() => loginController.abort(), LOGIN_TIMEOUT);
          let loginRes;
          try {
            loginRes = await fetch(`${LARIAN_BASE}/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ email: LARIAN_EMAIL, password: LARIAN_PASSWORD }),
              signal: loginController.signal,
            });
          } catch (e) {
            clearTimeout(loginTimer);
            if (e && e.name === "AbortError") {
              return sendJson(res, 504, { error: "LOGIN_TIMEOUT", timeoutMs: LOGIN_TIMEOUT });
            }
            throw e;
          } finally {
            clearTimeout(loginTimer);
          }
          const loginTxt = await loginRes.text();
          let loginJson;
          try {
            loginJson = JSON.parse(loginTxt);
          } catch {
            loginJson = { raw: loginTxt };
          }
          if (!loginRes.ok) {
            return sendJson(res, loginRes.status, { error: "LOGIN_FAILED", details: loginJson });
          }
          const token = loginJson?.access_token || loginJson?.accessToken || loginJson?.token;
          if (!token) {
            return sendJson(res, 502, { error: "MISSING_TOKEN", details: loginJson });
          }

          // 2) Iniciar emissão (tolerante a falhas)
          try {
            await fetch(`${LARIAN_BASE}/travellink/issuance/${encodeURIComponent(localizador)}:initiate`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch {
            // não bloqueia o fluxo
          }

          // 3) Emitir
          const issueController = new AbortController();
          const issueTimer = setTimeout(() => issueController.abort(), ISSUE_TIMEOUT);
          let issueRes;
          try {
            issueRes = await fetch(`${LARIAN_BASE}/travellink/issuance`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                Localizador: localizador,
                Pagamento: { FormaDePagamento: 1 },
              }),
              signal: issueController.signal,
            });
          } catch (e) {
            clearTimeout(issueTimer);
            if (e && e.name === "AbortError") {
              return sendJson(res, 504, { error: "ISSUE_TIMEOUT", timeoutMs: ISSUE_TIMEOUT });
            }
            throw e;
          } finally {
            clearTimeout(issueTimer);
          }

          const issueTxt = await issueRes.text();
          let issueJson;
          try {
            issueJson = JSON.parse(issueTxt);
          } catch {
            issueJson = { raw: issueTxt };
          }

          // Reclassifica erros de negócio (mesmo com HTTP 200)
          const businessError =
            issueJson &&
            (issueJson.SessaoExpirada === true ||
              issueJson.Exception ||
              issueJson.error === true ||
              issueJson.Error === true);
          if (businessError) {
            const code =
              (issueJson.Exception && (issueJson.Exception.Code || issueJson.Exception.code)) ||
              issueJson.Code ||
              issueJson.code ||
              undefined;
            const baseMsg =
              (issueJson.Exception && (issueJson.Exception.Message || issueJson.Exception.message)) ||
              issueJson.Mensagem ||
              issueJson.mensagem ||
              issueJson.error ||
              issueJson.Error ||
              "Erro de negócio";
            return sendJson(res, 422, {
              error: "BUSINESS_ERROR",
              code,
              message: baseMsg,
              data: issueJson,
            });
          }

          return sendJson(res, issueRes.ok ? 200 : issueRes.status, issueJson);
        } catch (e) {
          return sendJson(res, 500, { error: "ISSUE_FORWARD_ERROR", details: String(e.message || e) });
        }
      });
      return;
    }

    // Compatibilidade: tentar emitir diretamente; se não houver localizador, cria reserva e emite
    if (method === "POST" && (pathname === "/emitir-direct" || pathname === "/api/emitir-direct")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) req.destroy();
      });
      req.on("end", async () => {
        try {
          const body = JSON.parse(raw || "{}");
          let localizador = body.localizador || body.Localizador;

          if (!LARIAN_EMAIL || !LARIAN_PASSWORD) {
            return sendJson(res, 401, {
              error: "MISSING_CREDENTIALS",
              message: "Defina LARIAN_EMAIL e LARIAN_PASSWORD no ambiente.",
            });
          }

          // 1) Login
          const loginController = new AbortController();
          const loginTimer = setTimeout(() => loginController.abort(), LOGIN_TIMEOUT);
          let loginRes;
          try {
            loginRes = await fetch(`${LARIAN_BASE}/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ email: LARIAN_EMAIL, password: LARIAN_PASSWORD }),
              signal: loginController.signal,
            });
          } catch (e) {
            clearTimeout(loginTimer);
            if (e && e.name === "AbortError") {
              return sendJson(res, 504, { error: "LOGIN_TIMEOUT", timeoutMs: LOGIN_TIMEOUT });
            }
            throw e;
          } finally {
            clearTimeout(loginTimer);
          }
          const loginTxt = await loginRes.text();
          let loginJson;
          try {
            loginJson = JSON.parse(loginTxt);
          } catch {
            loginJson = { raw: loginTxt };
          }
          if (!loginRes.ok) {
            return sendJson(res, loginRes.status, { error: "LOGIN_FAILED", details: loginJson });
          }
          const token = loginJson?.access_token || loginJson?.accessToken || loginJson?.token;
          if (!token) {
            return sendJson(res, 502, { error: "MISSING_TOKEN", details: loginJson });
          }

          // 2) Se não houver localizador, reservar primeiro (usando corpo recebido)
          let reserveJson = null;
          if (!localizador) {
            const passengers =
              Array.isArray(body.passengers)
                ? body.passengers
                : typeof body.Passageiros === "string"
                ? (() => {
                    try {
                      return JSON.parse(body.Passageiros);
                    } catch {
                      return [];
                    }
                  })()
                : Array.isArray(body.Passageiros)
                ? body.Passageiros
                : [];

            const ident = body.IdentificacaoDaViagem || body.identificacaoDaViagem || body.identificacao_viagem || fallbackIdentificacao;

            const reserveController = new AbortController();
            const reserveTimer = setTimeout(() => reserveController.abort(), RESERVE_TIMEOUT);
            let reserveRes;
            try {
              reserveRes = await fetch(`${LARIAN_BASE}/travellink/reservations`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  IdentificacaoDaViagem: ident,
                  IdentificacaoDaViagemVolta: body.IdentificacaoDaViagemVolta || undefined,
                  passengers: (passengers || []).map((p) => ({
                    Nome: p.Nome,
                    Sobrenome: p.Sobrenome,
                    Nascimento: p.Nascimento,
                    Sexo: p.Sexo,
                    FaixaEtaria: p.FaixaEtaria || "ADT",
                    CPF: p.CPF,
                    Telefone: p.Telefone
                      ? {
                          NumeroDDD: p.TELEFONE?.NumeroDDD || p.Telefone.NumeroDDD,
                          NumeroTelefone: p.TELEFONE?.NumeroTelefone || p.Telefone.NumeroTelefone,
                          NumeroDDI: p.TELEFONE?.NumeroDDI || p.Telefone.NumeroDDI || "55",
                        }
                      : undefined,
                    Email: p.Email,
                  })),
                  CobrancaDeServico: body.CobrancaDeServico || undefined,
                }),
                signal: reserveController.signal,
              });
            } catch (e) {
              clearTimeout(reserveTimer);
              if (e && e.name === "AbortError") {
                return sendJson(res, 504, { error: "RESERVE_TIMEOUT", timeoutMs: RESERVE_TIMEOUT });
              }
              throw e;
            } finally {
              clearTimeout(reserveTimer);
            }

            const reserveTxt = await reserveRes.text();
            try {
              reserveJson = JSON.parse(reserveTxt);
            } catch {
              reserveJson = { raw: reserveTxt };
            }

            // Checa erro de negócio na reserva
            const businessReserveError =
              reserveJson &&
              (reserveJson.SessaoExpirada === true ||
                reserveJson.Exception ||
                ("Reservas" in reserveJson &&
                  (reserveJson.Reservas == null ||
                    (Array.isArray(reserveJson.Reservas) && reserveJson.Reservas.length === 0))));
            if (businessReserveError) {
              const code =
                (reserveJson.Exception && (reserveJson.Exception.Code || reserveJson.Exception.code)) ||
                reserveJson.Code ||
                reserveJson.code ||
                undefined;
              const baseMsg =
                (reserveJson.Exception &&
                  (reserveJson.Exception.Message || reserveJson.Exception.message)) ||
                reserveJson.Mensagem ||
                reserveJson.mensagem ||
                reserveJson.error ||
                reserveJson.Error ||
                "Erro de negócio (reserva)";
              return sendJson(res, 422, {
                error: "BUSINESS_ERROR_RESERVE",
                code,
                message: baseMsg,
                data: reserveJson,
              });
            }

            localizador =
              (reserveJson && reserveJson.Reservas && Array.isArray(reserveJson.Reservas) && reserveJson.Reservas[0] && (reserveJson.Reservas[0].Localizador || reserveJson.Reservas[0].CodigoReserva)) ||
              reserveJson?.Localizador ||
              reserveJson?.CodigoReserva ||
              null;

            if (!localizador) {
              return sendJson(res, 502, { error: "MISSING_LOCATOR_FROM_RESERVE", data: reserveJson });
            }
          }

          // 3) Initiate emissão (tolerante a falhas)
          try {
            await fetch(`${LARIAN_BASE}/travellink/issuance/${encodeURIComponent(localizador)}:initiate`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch {
            // não bloqueia
          }

          // 4) Issue
          const issueController = new AbortController();
          const issueTimer = setTimeout(() => issueController.abort(), ISSUE_TIMEOUT);
          let issueRes;
          try {
            issueRes = await fetch(`${LARIAN_BASE}/travellink/issuance`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                Localizador: localizador,
                Pagamento: { FormaDePagamento: 1 },
              }),
              signal: issueController.signal,
            });
          } catch (e) {
            clearTimeout(issueTimer);
            if (e && e.name === "AbortError") {
              return sendJson(res, 504, { error: "ISSUE_TIMEOUT", timeoutMs: ISSUE_TIMEOUT, localizador });
            }
            throw e;
          } finally {
            clearTimeout(issueTimer);
          }

          const issueTxt = await issueRes.text();
          let issueJson;
          try {
            issueJson = JSON.parse(issueTxt);
          } catch {
            issueJson = { raw: issueTxt };
          }

          const businessIssueError =
            issueJson &&
            (issueJson.SessaoExpirada === true ||
              issueJson.Exception ||
              issueJson.error === true ||
              issueJson.Error === true);
          if (businessIssueError) {
            const code =
              (issueJson.Exception && (issueJson.Exception.Code || issueJson.Exception.code)) ||
              issueJson.Code ||
              issueJson.code ||
              undefined;
            const baseMsg =
              (issueJson.Exception && (issueJson.Exception.Message || issueJson.Exception.message)) ||
              issueJson.Mensagem ||
              issueJson.mensagem ||
              issueJson.error ||
              issueJson.Error ||
              "Erro de negócio (emissão)";
            return sendJson(res, 422, {
              error: "BUSINESS_ERROR_ISSUE",
              code,
              message: baseMsg,
              localizador,
              data: issueJson,
            });
          }

          return sendJson(res, 200, {
            localizador,
            reserve: reserveJson || undefined,
            issue: issueJson,
          });
        } catch (e) {
          return sendJson(res, 500, { error: "EMITIR_DIRECT_FORWARD_ERROR", details: String(e.message || e) });
        }
      });
      return;
    }

    if (pathname === "/flight") {
      if (method === "GET") {
        if (!lastFlightBody) {
          return sendJson(res, 404, { error: "Nenhum corpo de voo foi recebido ainda." });
        }
        return sendJson(res, 200, {
          ...lastFlightBody,
          _meta: { lastUpdatedAt },
        });
      }

      if (method === "POST") {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
          // proteção simples contra corpo exagerado
          if (raw.length > 10 * 1024 * 1024) {
            req.destroy();
          }
        });
        req.on("end", () => {
          try {
            const body = JSON.parse(raw || "{}");
            lastFlightBody = body;
            lastUpdatedAt = new Date().toISOString();
            return sendJson(res, 200, { ok: true, lastUpdatedAt });
          } catch (e) {
            return sendJson(res, 400, { error: "JSON inválido", details: String(e.message || e) });
          }
        });
        return;
      }

      // método não suportado
      setCors(res);
      res.writeHead(405, { Allow: "GET,POST,OPTIONS" });
      return res.end();
    }

    // rota não encontrada
    return sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    return sendJson(res, 500, { error: "Internal Server Error", details: String(err.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`Flight API listening on http://localhost:${actualPort}`);
  console.log(`POST /flight  -> enviar o body (JSON)`);
  console.log(`GET  /flight  -> retornar o último body salvo`);
  console.log(`GET  /health  -> ok`);
  console.log(`Larian base: ${LARIAN_BASE}`);
  console.log(`Larian credentials: ${LARIAN_EMAIL && LARIAN_PASSWORD ? "configured" : "missing"}`);
  console.log(`Timeouts: login=${LOGIN_TIMEOUT}ms, reserve=${RESERVE_TIMEOUT}ms`);
});
