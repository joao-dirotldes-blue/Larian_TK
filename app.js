/* app.js - Fluxo simplificado: Dados do voo + passageiro -> Pagamento (simulado) -> Emissão de bilhete PDF */
(function () {
  "use strict";

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

  // Utils DOM
  const $ = (sel) => document.querySelector(sel);
  const byId = (id) => document.getElementById(id);

  const statusEl = byId("status");

  function setStatus(msg, type = "") {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = type ? `status ${type}` : "status";
  }

  // Log util (para depuração no console do navegador)
  function log(...args) {
    try {
      console.log("[UI]", ...args);
    } catch {}
  }

  function sanitizeFilename(name) {
    return (name || "")
      .trim()
      .replace(/[^\p{L}\p{N}\-_]+/gu, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "documento";
  }

  // Helpers de timeouts
  function parseMs(input) {
    try {
      if (input == null) return null;
      const s = String(input).trim().toLowerCase();
      const m = s.match(/^(\d+)(ms|s|m)?$/);
      if (!m) return null;
      const n = Number(m[1]);
      const unit = m[2] || "ms";
      if (unit === "ms") return n;
      if (unit === "s") return n * 1000;
      if (unit === "m") return n * 60_000;
      return null;
    } catch {
      return null;
    }
  }

  // Helpers de data
  function formatDateBRFromISO(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function toIsoDate(dmy) {
    // "26/08/2025" -> "2025-08-26"
    if (!dmy) return "";
    const m = dmy.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return "";
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  // Utilidades de texto para PDF
  function pdfSafe(s) {
    return String(s ?? "")
      .replace(/\u2192/g, "->") // → to ->
      .replace(/\u2013|\u2014/g, "-") // – — to -
      .replace(/\u2022/g, "-") // • to -
      .replace(/\u00A0/g, " "); // nbsp to space
  }

  // Formatação de moeda BRL
  function formatBRL(value) {
    try {
      const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
      if (!isFinite(n)) return String(value ?? "");
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
    } catch {
      return String(value ?? "");
    }
  }

  // Preenchimento automático a partir de um "body" injetado
  function getInjectedFlightBody() {
    // 1) Objeto global
    if (typeof window.__flightBody === "object" && window.__flightBody) return window.__flightBody;

    // 2) sessionStorage/localStorage: flightBody
    try {
      const s = sessionStorage.getItem("flightBody") || localStorage.getItem("flightBody");
      if (s) return JSON.parse(s);
    } catch {}

    // 3) Query param ?flight=... (JSON direto ou base64)
    try {
      const params = new URLSearchParams(location.search);
      const raw = params.get("flight");
      if (raw) {
        try {
          return JSON.parse(decodeURIComponent(raw));
        } catch {
          // tenta base64
          const txt = atob(raw);
          return JSON.parse(txt);
        }
      }
    } catch {}

    return null;
  }

  function parseFlightBody(body) {
    if (!body || typeof body !== "object") return null;

    // Se vier no formato { ida: {...}, volta: {...} }
    const main = body.ida || body.voo || body;

    const dataBR = String(main.data ?? "").trim();
    const airline = String(main.companhia ?? "").trim();
    const voo = String(main.numero_voo ?? "").trim();
    const airlineLine = [airline, voo].filter(Boolean).join(" ").trim();

    const total =
      main.valor_formatado
        ? String(main.valor_formatado)
        : (main.valor != null ? formatBRL(main.valor) : "");
    const reservationId = String(
      main.IdentificacaoDaViagem ??
      main.identificacaoDaViagem ??
      main.identificacao_viagem ??
      main.identificacao ??
      ""
    ).trim();

    return {
      airlineLine,
      date: dataBR,
      origin: String(main.origem ?? "").toUpperCase(),
      destination: String(main.destino ?? "").toUpperCase(),
      depart: String(main.horario_partida ?? ""),
      arrive: String(main.horario_chegada ?? ""),
      duration: String(main.duracao ?? ""),
      stops: String(main.escalas ?? ""),
      baggage: String(main.bagagem ?? ""),
      total,
      reservationId,
      routeLine: main.origem && main.destino ? `${String(main.origem).toUpperCase()} → ${String(main.destino).toUpperCase()}` : "",
      meta: {
        id_viagem: main.id_viagem ?? main.IdViagem ?? null,
        numero: main.numero ?? null,
        reservaId: reservationId || null
      }
    };
  }

  function setReadOnlyFlightFields(readonly = true) {
    const ids = ["ciaVoo", "dataVoo", "origem", "destino", "partida", "chegada", "duracao", "escalas", "bagagem", "total"];
    ids.forEach((id) => {
      const el = byId(id);
      if (!el) return;
      // Agora os campos do voo ficam sempre somente leitura (não editáveis)
      el.readOnly = true;
      el.disabled = true;
      el.setAttribute("data-prefilled", "1");
    });
  }

function populateFormWithFlight(f) {
  // salva como fonte de verdade
  try { 
    state.flight = f;
    console.log("[Debug] state.flight atualizado:", JSON.parse(JSON.stringify(state.flight)));
  } catch {}
  const setVal = (id, v) => {
    const el = byId(id);
    if (!el) return;
    el.value = v ?? "";
  };

    setVal("ciaVoo", f.airlineLine);
    // dataVoo espera ISO yyyy-mm-dd; converte se vier dd/mm/yyyy
    if (f.date && /^\d{2}\/\d{2}\/\d{4}$/.test(f.date)) {
      setVal("dataVoo", toIsoDate(f.date));
    } else {
      setVal("dataVoo", f.date); // se já for ISO, mantém
    }
    setVal("origem", f.origin);
    setVal("destino", f.destination);
    setVal("partida", f.depart);
    setVal("chegada", f.arrive);
    setVal("duracao", f.duration);
    setVal("escalas", f.stops);
    setVal("bagagem", f.baggage);
    setVal("total", f.total);
    // reservaId hidden (usado na API da Wooba)
    setVal("reservaId", f.reservationId || "");

  // Trava campos do voo para usuário apenas completar os dados pessoais (se existirem)
  setReadOnlyFlightFields(true);
  // Renderiza orçamento visual (Step 1)
  try { renderQuote(f); } catch {}
  // Atualiza resumos
  updateAmountDue();
  updateReservationCode(f.reservationId || "");
  try { initQuoteExpiry(f); } catch {}
}

  function autoPopulateFormFromInjectedFlight() {
    const body = getInjectedFlightBody();
    if (!body) return null;
    const f = parseFlightBody(body);
    if (!f) return null;
    populateFormWithFlight(f);
    return f;
  }

  // Aceita body diretamente (objeto) e preenche/trava os campos do voo
  function acceptFlightBody(body) {
    const f = parseFlightBody(body);
    if (!f) return false;
    populateFormWithFlight(f);
    return true;
  }

  // Suporte a receber os dados via postMessage
  // Exemplo: window.postMessage({ type: 'flightBody', payload: { ...body... } }, '*');
  window.addEventListener(
    "message",
    (event) => {
      try {
        const msg = event.data;
        if (!msg) return;
        let payload = null;

        if (typeof msg === "object" && (msg.type === "flightBody" || msg.kind === "flightBody")) {
          payload = msg.payload || msg.body || msg.data;
        } else if (typeof msg === "object" && (msg.companhia || msg.numero_voo || msg.origem || msg.destino)) {
          // mensagem já é o body no formato esperado
          payload = msg;
        }

        if (payload) acceptFlightBody(payload);
      } catch (e) {
        console.warn("Falha ao processar postMessage de flightBody:", e);
      }
    },
    false
  );

  async function fetchFlightFromUrl(url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Falha ao buscar dados do voo (${res.status})`);
    const body = await res.json();
    return body;
  }

  // Controle de passos (3 etapas)
  const steps = [byId("step1"), byId("step2"), byId("step3"), byId("step4")];
  const dots = [byId("step1-dot"), byId("step2-dot"), byId("step3-dot"), byId("step4-dot")];

  function showStep(n) {
    // Garante que nenhum overlay fique ativo ao trocar de etapa
    try { hideOverlay(); } catch {}
    
    const currentStep = steps.findIndex(el => !el.classList.contains("hidden"));
    
    // Animação de transição entre steps
    if (typeof anime !== "undefined") {
      const timeline = anime.timeline({
        duration: 250,
        easing: 'easeOutCubic'
      });

      if (currentStep > -1 && steps[currentStep]) {
        timeline.add({
          targets: steps[currentStep],
          opacity: [1, 0],
          translateY: [0, -10],
          complete: () => {
            steps[currentStep].classList.add("hidden");
          }
        });
      }

      timeline.add({
        targets: steps[n - 1],
        begin: () => {
          steps[n - 1].classList.remove("hidden");
          steps[n - 1].style.opacity = 0;
          steps[n - 1].style.transform = 'translateY(10px)';
        },
        opacity: [0, 1],
        translateY: [10, 0]
      });
    } else {
      // Fallback sem animação
      steps.forEach((el, i) => {
        if (!el) return;
        if (i === n - 1) el.classList.remove("hidden");
        else el.classList.add("hidden");
      });
    }

    dots.forEach((dot, i) => {
      if (!dot) return;
      dot.classList.remove("active", "done");
      if (i < n - 1) dot.classList.add("done");
      if (i === n - 1) dot.classList.add("active");
    });
    // Atualiza o resumo de pagamento ao entrar na etapa 2
    if (n === 2) {
      updateAmountDue();
      // Garante que não haja emissão sem reserva válida
      state.reserved = false;
      if (typeof toStep3Btn !== "undefined" && toStep3Btn) toStep3Btn.disabled = true;
    }
  }

  // Estado global do fluxo
  const state = {
    flight: null,
    passenger: null,
    payment: { method: "pix", confirmed: false },
    apiBase: null,
    reserved: false,
    sellerName: "João Diroteldes",
    timeouts: {
      reserveMs: 180000, // aumentado para 180s (3 minutos)
    },
    expiry: { key: null, expiryAt: null, totalMs: 3600000, timer: null },
  };

  // Vendedor (mock por padrão, com override por query ?seller= ou ?vendedor=)
  function getSellerFromParams() {
    try {
      const p = new URLSearchParams(location.search);
      const s = p.get("seller") || p.get("vendedor") || p.get("atendente") || "";
      return (s && s.trim()) ? s.trim() : null;
    } catch {
      return null;
    }
  }
  function initSeller() {
    try {
      const override = getSellerFromParams();
      if (override) state.sellerName = override;
      const pill = byId("sellerName");
      if (pill) pill.textContent = state.sellerName || "João Diroteldes";
      const bp = byId("bp-seller");
      if (bp) bp.textContent = state.sellerName || "João Diroteldes";
    } catch {}
  }

  // Atualiza o valor exibido na etapa de pagamento
  function updateAmountDue() {
    const el = byId("amountDue");
    if (!el) return;
    const total = state.flight?.total || byId("total")?.value || "";
    el.textContent = (total && String(total).trim()) ? String(total) : "—";
  }

  // Atualiza exibição do código/identificador de reserva
function updateReservationCode(code) {
  // Atualiza preview abreviado (5 chars) e mantém o valor completo em #reservaId/state
  const prev = byId("reservationCodePreview");
  if (prev) {
    prev.textContent = abbreviateId(code, 5);
  }
  const hidden = byId("reservaId");
  if (hidden && code) hidden.value = code;
  try {
    if (!state.flight) state.flight = {};
    if (code) state.flight.reservationId = code;
  } catch {}
  // Reajusta o contador de validade ao trocar de cotação
  try { maybeResetExpiryForNewKey(); } catch {}
}

// Abrevia um identificador longo para exibição
function abbreviateId(code, visible = 5) {
  if (!code) return "—";
  const s = String(code).trim();
  if (s.length <= visible) return s;
  return s.slice(0, visible) + "…";
}

// Copiar identificador completo para a área de transferência
async function copyReservationId() {
  try {
    const full = byId("reservaId")?.value || state.flight?.reservationId || "";
    if (!full) return;
    await navigator.clipboard.writeText(full);
    const btn = byId("copyReservaBtn");
    const prev = byId("reservationCodePreview");
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => { if (btn) btn.textContent = old || "Copiar"; }, 1500);
    }
    if (prev) {
      prev.classList.add("copied");
      setTimeout(() => { if (prev) prev.classList.remove("copied"); }, 1500);
    }
  } catch (e) {
    alert("Não foi possível copiar o identificador");
  }
}

// Overlay de processamento (reserva + emissão)
function showOverlay(text) {
  const o = byId("overlay");
  if (!o) return;
  if (text) {
    const t = byId("overlayText");
    if (t) t.textContent = text;
  }
  o.hidden = false;
  document.body.style.overflow = "hidden";
  
  // Animação de decolagem com anime.js
  if (typeof anime !== "undefined") {
    const plane = o.querySelector(".plane");
    if (plane) {
      // Reseta o estado antes de animar
      anime.set(plane, {
        translateX: -20,
        translateY: 10,
        rotate: 0,
        opacity: 1
      });
      anime({
        targets: plane,
        translateX: [
          { value: 10, duration: 540, easing: 'easeInCubic' },
          { value: 100, duration: 1260, easing: 'easeOutSine' }
        ],
        translateY: [
          { value: -5, duration: 540, easing: 'easeInCubic' },
          { value: -80, duration: 1260, easing: 'easeOutSine' }
        ],
        rotate: [
          { value: -5, duration: 540, easing: 'easeInCubic' },
          { value: -15, duration: 1260, easing: 'easeOutSine' }
        ],
        opacity: [
          { value: 1, duration: 1080 },
          { value: 0, duration: 720, easing: 'easeInQuad' }
        ],
        loop: true,
        duration: 1800
      });
    }
  }
}
function hideOverlay() {
  const o = byId("overlay");
  if (!o) return;
  o.hidden = true;
  document.body.style.overflow = "";
}

// Renderiza a vitrine de orçamento da etapa 1 (sem inputs)
function renderQuote(f) {
  if (!f || typeof f !== "object") return;
  const setText = (id, v) => {
    const el = byId(id);
    if (!el) return;
    el.textContent = v != null && String(v).trim() !== "" ? String(v) : "—";
  };
  setText("q-origin", (f.origin || "").toUpperCase());
  setText("q-destination", (f.destination || "").toUpperCase());
  setText("q-airline", f.airlineLine || "");
  setText("q-date", f.date || "");
  setText("q-depart", f.depart || "");
  setText("q-arrive", f.arrive || "");
  setText("q-duration", f.duration || "");
  setText("q-stops", f.stops || "");
  setText("q-baggage", f.baggage || "");
  const totalEl = byId("q-total");
  if (totalEl) totalEl.textContent = f.total || "—";
}

/* ====== Validade do orçamento (contador de 1h, sutil) ====== */
function getFlightKey(f) {
  try {
    if (f?.reservationId && String(f.reservationId).trim()) return `rid:${String(f.reservationId).trim()}`;
    const o = String(f?.origin || "").toUpperCase();
    const d = String(f?.destination || "").toUpperCase();
    const dt = String(f?.date || "");
    const al = String(f?.airlineLine || "");
    const key = `${o}|${d}|${dt}|${al}`.trim();
    return key ? `mix:${key}` : "mix:unknown";
  } catch {
    return "mix:unknown";
  }
}

function parseExpiryOptions() {
  try {
    const params = new URLSearchParams(location.search);
    const inStr = params.get("expiresIn");
    const atStr = params.get("expiresAt");
    const expiresInMs = parseMs(inStr);
    const expiresAt = atStr ? Number(atStr) : null;
    return {
      expiresInMs: (expiresInMs && expiresInMs > 0 ? expiresInMs : null),
      expiresAt: (Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null)
    };
  } catch {
    return { expiresInMs: null, expiresAt: null };
  }
}

function initQuoteExpiry(flight) {
  try {
    const el = byId("quoteExpiry");
    if (!el) return; // sem UI, não inicializa
    const key = getFlightKey(flight || state.flight || {});
    const { expiresInMs, expiresAt } = parseExpiryOptions();
    const defaultMs = expiresInMs || 3600000; // 1h padrão

    // Usa storage por cotação
    const aKey = `expiryAt:${key}`;
    const tKey = `expiryTotal:${key}`;
    let storedAt = Number(localStorage.getItem(aKey) || "");
    let totalMs = Number(localStorage.getItem(tKey) || "");
    if (!Number.isFinite(totalMs) || totalMs <= 0) totalMs = defaultMs;

    let finalAt;
    if (expiresAt && expiresAt > Date.now()) {
      finalAt = expiresAt;
      localStorage.setItem(aKey, String(finalAt));
      localStorage.setItem(tKey, String(totalMs));
    } else if (Number.isFinite(storedAt) && storedAt > Date.now()) {
      finalAt = storedAt;
      if (!Number.isFinite(totalMs) || totalMs <= 0) totalMs = defaultMs;
    } else {
      finalAt = Date.now() + totalMs;
      localStorage.setItem(aKey, String(finalAt));
      localStorage.setItem(tKey, String(totalMs));
    }

    startExpiryTick(key, totalMs, finalAt);
  } catch (e) {
    console.warn("initQuoteExpiry failed:", e);
  }
}

function maybeResetExpiryForNewKey() {
  try {
    const curKey = getFlightKey(state.flight || {});
    if (state.expiry?.key && curKey === state.expiry.key) return;
    // Troca de cotação → reinicia 1h (ou conforme ?expiresIn)
    clearIntervalSafe(state.expiry?.timer);
    state.expiry = state.expiry || {};
    state.expiry.key = null;
    initQuoteExpiry(state.flight || {});
  } catch (e) {
    console.warn("maybeResetExpiryForNewKey failed:", e);
  }
}

function clearIntervalSafe(t) {
  try { if (t) clearInterval(t); } catch {}
}

function startExpiryTick(key, totalMs, expiryAt) {
  try {
    clearIntervalSafe(state.expiry?.timer);
    state.expiry.key = key;
    state.expiry.totalMs = totalMs;
    state.expiry.expiryAt = expiryAt;

    const tick = () => {
      try {
        const now = Date.now();
        const remain = Math.max(0, expiryAt - now);
        updateExpiryUI(remain, totalMs);
        if (remain <= 0) {
          handleExpiryExpired();
          clearIntervalSafe(state.expiry?.timer);
          state.expiry.timer = null;
        }
      } catch {}
    };

    state.expiry.timer = setInterval(tick, 1000);
    tick();
  } catch (e) {
    console.warn("startExpiryTick failed:", e);
  }
}

function updateExpiryUI(remainingMs, totalMs) {
  const wrap = byId("quoteExpiry");
  const out = byId("expiryCountdown");
  const bar = byId("expiryProgressBar");
  if (!wrap || !out) return;

  // thresholds
  const warnMs = 10 * 60 * 1000; // 10m
  const dangerMs = 60 * 1000;    // 1m

  // texto relativo (mm:ss ou hh:mm:ss)
  out.textContent = formatRemain(remainingMs);

  // texto absoluto (até HH:mm ou DD/MM HH:mm)
  const exactEl = byId("expiryExact");
  if (exactEl && state.expiry && state.expiry.expiryAt) {
    const d = new Date(state.expiry.expiryAt);
    const pad = (n) => String(n).padStart(2, "0");
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    exactEl.textContent = sameDay
      ? `(até ${hm})`
      : `(até ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm})`;
  }

  // classes
  wrap.classList.remove("warn", "danger");
  if (remainingMs <= dangerMs) wrap.classList.add("danger");
  else if (remainingMs <= warnMs) wrap.classList.add("warn");

  // progress
  const pct = Math.max(0, Math.min(1, remainingMs / (totalMs || 1)));
  if (bar) {
    bar.style.setProperty("--pct", String(pct));
  }
}

function formatRemain(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);   s -= m * 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function handleExpiryExpired() {
  const wrap = byId("quoteExpiry");
  const out = byId("expiryCountdown");
  if (wrap) {
    wrap.classList.remove("warn");
    wrap.classList.add("danger");
  }
  if (out) out.textContent = "expirada";
  // Desabilita ações
  try {
    const b1 = byId("toStep2");
    if (b1) { b1.disabled = true; b1.title = "Cotação expirada. Obtenha uma nova."; }
    const b2 = byId("btnPay");
    if (b2) { b2.disabled = true; b2.title = "Cotação expirada. Obtenha uma nova."; }
  } catch {}
}

/* Renderiza resumo da Etapa 4 (confirmação) — estilo boarding pass */
function renderStep4Summary() {
  try {
    const f = state.flight || {};
    const p = state.passenger || {};

    const setText = (id, v) => {
      const el = byId(id);
      if (el) el.textContent = v != null && String(v).trim() !== "" ? String(v) : "—";
    };

    // Cabeçalho/rota
    const origin = (f.origin || "").toUpperCase();
    const destination = (f.destination || "").toUpperCase();
    setText("bp-route", origin && destination ? `${origin} → ${destination}` : "—");
    setText("bp-origin", origin || "—");
    setText("bp-destination", destination || "—");

    // Infos de voo
    setText("bp-airline", f.airlineLine || "");
    setText("bp-date", f.date || "");
    setText("bp-depart", f.depart || "");
    setText("bp-arrive", f.arrive || "");
    setText("bp-duration", f.duration || "");
    setText("bp-stops", f.stops || "");
    setText("bp-baggage", f.baggage || "");

    // Passageiro e total
    setText("bp-pax", p?.nomeCompleto || "—");
    const totalEl = byId("bp-total");
    if (totalEl) totalEl.textContent = f.total || "—";

    // PNR/Identificador (abreviado) no talão
    const fullId = f.reservationId || byId("reservaId")?.value || "";
    setText("bp-pnr", abbreviateId(fullId, 5));

    // Código de barras simples (placeholder CSS) — opcionalmente poderíamos injetar texto
    const barcode = byId("bp-barcode");
    if (barcode) {
      // Apenas garante re-render (sem dependências externas)
      barcode.setAttribute("data-code", abbreviateId(fullId, 5));
    }
    // Vendedor
    const bpSeller = byId("bp-seller");
    if (bpSeller) bpSeller.textContent = state.sellerName || "João Diroteldes";
  } catch (e) {
    console.warn("Falha ao renderizar resumo da etapa 4:", e);
  }
}

  // Tenta extrair um identificador de reserva comum de uma resposta arbitrária
  function extractReservationId(obj) {
    try {
      if (!obj || typeof obj !== "object") return "";

      // Caminho prioritário e exato, conforme a resposta da API
      if (obj?.Reservas?.[0]?.Localizador) {
        return obj.Reservas[0].Localizador;
      }
      
      // Se não encontrar, retorna vazio para evitar enviar dados errados para a emissão
      return "";
    } catch {
      return "";
    }
  }

  // Sucesso/erro de negócio na resposta da Wooba (mesmo com HTTP 200)
  function isReservationSuccess(data) {
    if (!data || typeof data !== "object") return false;
    if (data.SessaoExpirada === true) return false;
    if (data.Exception) return false;
    if ("Reservas" in data && (data.Reservas == null || (Array.isArray(data.Reservas) && data.Reservas.length === 0))) return false;
    return true;
  }
  function reservationErrorReason(data) {
  try {
    if (!data || typeof data !== "object") return "Resposta inválida";
    if (data.Exception && (data.Exception.Message || data.Exception.message)) {
      return data.Exception.Message || data.Exception.message;
    }
    if (data.Mensagem || data.mensagem) return data.Mensagem || data.mensagem;
    if (data.SessaoExpirada === true) return "Sessão expirada";
    if ("Reservas" in data && (data.Reservas == null || (Array.isArray(data.Reservas) && data.Reservas.length === 0))) {
      return "Resposta sem reservas";
    }
    return "Erro de negócio";
  } catch {
    return "Erro de negócio";
  }
}
  
  // Ajuda/Debug: exibe ferramentas e mensagens específicas para erros de negócio
  function showDebugTools() {
    const dt = byId("debugTools");
    if (dt) dt.classList.remove("hidden");
  }
  function buildBusinessErrorHelp(msg) {
    const m = String(msg || "").toUpperCase();
    const tips = [];
    if (m.includes("VALUE CANNOT BE NULL") && m.includes("SOURCE")) {
      tips.push("Dica: forneça uma IdentificacaoDaViagem válida (com tarifa/segmentos). Use as Ferramentas de Debug para salvar um fallback (/identificacao) ou aplicar no formulário.");
    }
    if (m.includes("PAST DATE SEGMENT")) {
      tips.push("Dica: o itinerário contém segmento com data passada. Ajuste a pesquisa/identificador para uma data futura.");
    }
    if (m.includes("SESSAOEXPIRADA")) {
      tips.push("Dica: sessão expirada. Tente novamente ou verifique as credenciais.");
    }
    return tips.join(" ");
  }

  // Função para limpar completamente qualquer referência a TEST
  function sanitizeForApi(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/TEST/gi, "USER").replace(/TESTE/gi, "USUARIO");
  }

  // Função melhorada para gerar nomes seguros
  function generateSafeNames(nomeCompleto) {
    const SAFE_NAMES = ["JOAO", "MARIA", "LUCAS", "ANA", "PAULO", "CARLA", "PEDRO", "JULIA"];
    const SAFE_SURNAMES = ["SILVA", "SOUZA", "OLIVEIRA", "ALMEIDA", "COSTA", "SANTOS", "PEREIRA", "LIMA"];
    
    let parts = [];
    
    if (nomeCompleto && typeof nomeCompleto === "string") {
      parts = nomeCompleto
        .trim()
        .split(/\s+/)
        .filter(p => p.length > 1)
        .map(p => p.toUpperCase())
        .filter(p => !/TEST/i.test(p)); // Remove qualquer parte com TEST
    }
    
    // Se não temos partes válidas ou restaram menos que 2, usa nomes seguros
    if (parts.length === 0) {
      parts = [
        SAFE_NAMES[Math.floor(Math.random() * SAFE_NAMES.length)],
        SAFE_SURNAMES[Math.floor(Math.random() * SAFE_SURNAMES.length)]
      ];
    } else if (parts.length === 1) {
      // Adiciona um sobrenome seguro
      let surname = SAFE_SURNAMES[Math.floor(Math.random() * SAFE_SURNAMES.length)];
      // Garante que sobrenome seja diferente do nome
      while (surname === parts[0]) {
        surname = SAFE_SURNAMES[Math.floor(Math.random() * SAFE_SURNAMES.length)];
      }
      parts.push(surname);
    }
    
    const nome = parts[0];
    const sobrenome = parts.slice(1).join(" ");
    
    // Validação final
    const finalNome = /^[A-Z]{2,}$/.test(nome) ? nome : SAFE_NAMES[0];
    const finalSobrenome = /^[A-Z\s]{2,}$/.test(sobrenome) && sobrenome !== finalNome 
      ? sobrenome 
      : SAFE_SURNAMES.find(s => s !== finalNome) || "SILVA";
    
    return { nome: finalNome, sobrenome: finalSobrenome };
  }

  // Elementos Step 1 (form)
  const detailsForm = byId("detailsForm");
  const toStep2Btn = byId("toStep2");
  const toStepPaymentBtn = byId("toStepPayment");

  // Step 3 (pagamento)
  const backTo1Btn = byId("backTo1");
  const btnPay = byId("btnPay");
  const toStep3Btn = byId("toStep3");
  const paymentStatus = byId("paymentStatus");

  // Step 4
  const btnEmitirNovamente = byId("btnEmitirNovamente");
  const btnReiniciar = byId("btnReiniciar");

function readDetailsFromForm() {
  const get = (id) => byId(id)?.value?.trim() || "";

  // Passageiro (Step 2)
  const nomeCompleto = get("nomeCompleto");
  const cpf = get("cpf");
  const telefone = get("telefone");
  const email = get("email");
  const reservaId = get("reservaId");

  // Voo vem do estado (preenchido a partir do flightUrl/flight/base64)
  const flight = { ...(state.flight || {}) };
  if (reservaId) {
    flight.reservationId = reservaId;
    if (!flight.meta) flight.meta = {};
    flight.meta.reservaId = reservaId;
  }
  if (!flight.routeLine && flight.origin && flight.destination) {
    flight.routeLine = `${String(flight.origin).toUpperCase()} → ${String(flight.destination).toUpperCase()}`;
  }

  const passenger = { nomeCompleto, cpf, telefone, email };

  return { flight, passenger };
}

  // Step 1 -> Step 2
  if (toStep2Btn) {
    toStep2Btn.addEventListener("click", () => {
      // Na tela 1 não há mais formulário editável, apenas exibição dos dados do voo
      // Então não precisamos validar nada aqui, apenas avançar para a tela 2
      const { flight } = readDetailsFromForm();
      state.flight = flight;
      showStep(2);
      setStatus("");
    });
  }

  // Step 2 -> Step 3
  if (toStepPaymentBtn) {
    toStepPaymentBtn.addEventListener("click", () => {
      const { passenger } = readDetailsFromForm();
      state.passenger = passenger;
      showStep(3);
      setStatus("");
    });
  }

  // Step 3 eventos
  if (backTo1Btn) backTo1Btn.addEventListener("click", () => showStep(1));

  if (btnPay) {
  btnPay.addEventListener("click", async () => {
    btnPay.disabled = true;

    // Define método escolhido e considera pagamento confirmado
    const method = document.querySelector('input[name="payMethod"]:checked')?.value || "pix";
    state.payment.method = method;
    state.payment.confirmed = true;
    state.reserved = false;

    setPaymentStatus(`Processando pagamento (${method})…`, "");
    showOverlay("Processando sua reserva…");

    // Modo sem backend: use ?noback=1 (ou ?mock=1) para simular a reserva no front
    {
      let noBack = false;
      try {
        const p = new URLSearchParams(location.search);
        noBack = p.get("noback") === "1" || p.get("mock") === "1";
      } catch {}
      if (noBack) {
        await new Promise(r => setTimeout(r, 800));
        const ridFallback = state.flight?.reservationId || Math.random().toString(36).slice(2, 8).toUpperCase();
        updateReservationCode(ridFallback);
        state.reserved = true;
        setPaymentStatus(`Reserva confirmada (simulada)${ridFallback ? ` (ID: ${abbreviateId(ridFallback, 5)})` : ""}.`, "success");
        hideOverlay();
        renderStep4Summary();
        showStep(4);
        return;
      }
    }

    try {
      // Reserva no backend
      const data = await reserveViaBackend();

      // Extrai/corrige identificador
      const rid = extractReservationId(data);
      console.log(`[Debug] Localizador extraído da reserva: '${rid}'`);
      if (rid && (!state.flight || !state.flight.reservationId)) {
        state.flight = state.flight || {};
        state.flight.reservationId = rid;
        if (byId("reservaId")) byId("reservaId").value = rid;
      }
      updateReservationCode(rid);

      state.reserved = true;
      setPaymentStatus(`Reserva confirmada${rid ? ` (ID: ${abbreviateId(rid, 5)})` : ""}.`, "success");

      // Emissão automática no backend (segue a lógica do n8n: initiate → issue)
      setPaymentStatus("Emissão do bilhete em andamento…", "");
      showOverlay("Emitindo seu bilhete…");
      try {
        const issueData = await issueViaBackend(rid);
        // Tenta extrair algum identificador útil do retorno (ex.: e-ticket/localizador)
        try {
          const maybeTicket = extractReservationId(issueData);
          if (maybeTicket) {
            if (!state.flight) state.flight = {};
            state.flight.numeroBilhete = maybeTicket;
          }
        } catch {}
        setPaymentStatus(`Emissão confirmada${rid ? ` (ID: ${abbreviateId(rid, 5)})` : ""}.`, "success");
      } catch (e) {
        console.error("Falha na emissão:", e);
        let extra = e && e.message ? `: ${e.message}` : "";
        if (e && e.status === 422 && e.body) {
          const msg = e.body.message || reservationErrorReason(e.body.data) || e.message;
          extra = msg ? `: ${msg}` : extra;
          showDebugTools();
        }
        setPaymentStatus("Reserva confirmada, mas falhou a emissão automática" + extra, "warn");
      }
      hideOverlay();
      renderStep4Summary();
      showStep(4);
    } catch (err) {
      console.error("Falha na reserva:", err);

      let extra = "";
      if (err && err.status === 422 && err.body && (err.body.error === "BUSINESS_ERROR" || err.body.data)) {
        const msg = err.body.message || reservationErrorReason(err.body.data) || err.message;
        extra = msg ? `: ${msg}` : "";
        const help = buildBusinessErrorHelp(msg);
        if (help) extra += ` — ${help}`;
        showDebugTools();
        if (err.body._debug) {
          log("reserve:business-error-debug", err.body._debug);
        }
      } else {
        extra = err && err.message ? `: ${err.message}` : "";
      }

      // Caso de bloqueio interno — ainda emite em modo simulado
      const errMsg = (err?.body?.Exception?.Message || extra || "").toLowerCase();
      if (errMsg.includes("blocked") || errMsg.includes("internal users")) {
        setPaymentStatus("Reserva bloqueada para usuários internos, emitindo bilhete em modo simulado.", "warn");
        state.reserved = true;
        try { await emitTicket(); } catch {}
        hideOverlay();
        showStep(4);
      } else {
        hideOverlay();
        setPaymentStatus("Falha ao reservar a passagem" + extra, "error");
      }
    } finally {
      btnPay.disabled = false;
    }
  });
}

  function setPaymentStatus(msg, type = "") {
    if (!paymentStatus) return;
    paymentStatus.textContent = msg || "";
    paymentStatus.className = type ? `status ${type}` : "status";
  }

  // Reserva via backend local (/reservar) com timeout configurável
  async function reserveViaBackend() {
    const pax = state.passenger || {};
    const flight = state.flight || {};

    const nomeCompleto = String(pax.nomeCompleto || "").trim();
    const { nome: nomeUp, sobrenome: sobrenomeUp } = generateSafeNames(nomeCompleto);

    const cpf = String(pax.cpf || "").replace(/\D/g, "");
    const telDigits = String(pax.telefone || "").replace(/\D/g, "");
    const ddd = telDigits.slice(0, 2) || "11";
    const numeroTel = telDigits.slice(2) || "900000000";

    let email = String(pax.email || "").trim();
    if (/TEST/i.test(email) || !email) {
      email = `${nomeUp.toLowerCase()}@example.com`;
    }
    email = sanitizeForApi(email);

    // Identificação da viagem: pode vir do form/estado; backend possui fallback/mock se vazio
    const reservaId =
      byId("reservaId")?.value?.trim() ||
      flight.reservationId ||
      flight?.meta?.reservaId ||
      flight?.meta?.id_viagem ||
      "";

    const payload = {
      IdentificacaoDaViagem: reservaId,
      IdentificacaoDaViagemVolta: "",
      passengers: [
        {
          CPF: cpf,
          Nome: nomeUp,
          Sexo: "M",
          Email: email,
          Telefone: {
            NumeroDDD: ddd,
            NumeroDDI: "55",
            NumeroTelefone: numeroTel,
          },
          Sobrenome: sobrenomeUp,
          Nascimento: "2000-01-01",
          FaixaEtaria: "ADT",
        },
      ],
    };

    const apiBase =
      state.apiBase ||
      (window.location.origin.replace(":5173", ":5174"));

    const mockParam = (() => {
      try {
        const p = new URLSearchParams(location.search);
        return p.get("mock") === "1";
      } catch {
        return false;
      }
    })();

    const url = `${apiBase}/api/reservar${mockParam ? "?mock=1" : ""}`;
    const controller = new AbortController();
    const reserveMs = (state.timeouts && state.timeouts.reserveMs) || 180000; // 3min default
    const t0 = performance.now();

    const dbgIdentHeader = byId("debugIdentInput")?.value?.trim() || "";
    log("reserve:request-backend", {
      url,
      reservaId: (reservaId || "").slice(0, 24) + "…",
      timeoutMs: reserveMs,
      hasIdentHeader: !!dbgIdentHeader,
      payloadSample: JSON.stringify(payload).slice(0, 240) + "…",
    });

    const timer = setTimeout(() => controller.abort(), reserveMs);
    let res;
    try {
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (dbgIdentHeader) headers["X-Mock-Identificacao"] = dbgIdentHeader;
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        clearTimeout(timer);
        const err = new Error(`Timeout ao reservar (${reserveMs / 1000 | 0}s).`);
        err.code = "TIMEOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    log("reserve:response-backend", {
      status: res.status,
      ms: Math.round(performance.now() - t0),
      bodySample: text.slice(0, 300) + (text.length > 300 ? "…" : ""),
    });

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message || data.Mensagem || data.mensagem || data.raw)) ||
        text ||
        "Falha na reserva";
      const err = new Error(`Reserva falhou (${res.status}): ${String(msg).slice(0, 300)}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    // Tratar erro de negócio mesmo com HTTP 200
    if (!isReservationSuccess(data)) {
      const msg = reservationErrorReason(data);
      const err = new Error(`Reserva retornou erro de negócio: ${msg}`);
      err.status = 200;
      err.body = data;
      throw err;
    }

    return data;
  }

  // Emissão via backend local (/emitir) com timeout ~120s
  async function issueViaBackend(localizador) {
    if (!localizador) {
      const err = new Error("Localizador ausente para emissão");
      err.code = "MISSING_LOCATOR";
      throw err;
    }
    const apiBase = state.apiBase || window.location.origin.replace(":5173", ":5174");
    const url = `${apiBase}/api/emitir`;
    const controller = new AbortController();
    const ISSUE_MS = 120000;
    const t0 = performance.now();

    const timer = setTimeout(() => controller.abort(), ISSUE_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ localizador }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        clearTimeout(timer);
        const err = new Error(`Timeout ao emitir (${ISSUE_MS / 1000 | 0}s).`);
        err.code = "TIMEOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    log("issue:response-backend", {
      status: res.status,
      ms: Math.round(performance.now() - t0),
      bodySample: text.slice(0, 300) + (text.length > 300 ? "…" : ""),
    });

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message || data.Mensagem || data.mensagem || data.raw)) ||
        text ||
        "Falha na emissão";
      const err = new Error(`Emissão falhou (${res.status}): ${String(msg).slice(0, 300)}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    // Regras de erro de negócio (similar ao /reservar)
    if (data && (data.SessaoExpirada === true || data.Exception || data.error === true || data.Error === true)) {
      const businessMsg =
        (data.Exception && (data.Exception.Message || data.Exception.message)) ||
        data.Mensagem || data.mensagem || data.error || data.Error || "Erro de negócio (emissão)";
      const err = new Error(`Emissão retornou erro de negócio: ${businessMsg}`);
      err.status = 200;
      err.body = data;
      throw err;
    }

    return data;
  }

  // Reserva direta na API Larian (mesmo fluxo do n8n) - VERSÃO CORRIGIDA
  async function reserveOnWooba() {
    try {
      const pax = state.passenger || {};
      const flight = state.flight || {};

      const nomeCompleto = String(pax.nomeCompleto || "").trim();
      
      // Gera nomes seguros sem qualquer referência a TEST
      const { nome: nomeUp, sobrenome: sobrenomeUp } = generateSafeNames(nomeCompleto);

      log("reserve:paxName", { 
        original: nomeCompleto,
        nome: nomeUp, 
        sobrenome: sobrenomeUp 
      });

      const cpf = String(pax.cpf || "").replace(/\D/g, "");
      const telDigits = String(pax.telefone || "").replace(/\D/g, "");
      const ddd = telDigits.slice(0, 2) || "11";
      const numeroTel = telDigits.slice(2) || "900000000";
      
      // Limpa o email de qualquer referência a TEST
      let email = String(pax.email || "").trim();
      if (/TEST/i.test(email) || !email) {
        email = `${nomeUp.toLowerCase()}@example.com`;
      }
      email = sanitizeForApi(email);

      // Identificação da viagem
      const reservaId =
        byId("reservaId")?.value?.trim() ||
        flight.reservationId ||
        flight?.meta?.reservaId ||
        flight?.meta?.id_viagem ||
        "";

      // Fallback se não tiver IdentificacaoDaViagem
      const fallbackIdent = "kgoAAB+LCAAAAAAABAC9Vutu4jgUfpXK+5dLEggl+ZcGhUaCEhWoRhpVKydxwKqJIzvMsqr6QPMc82Jz7IRQ2IxUOqNFXI7P5fP5Ptsxr8hDrtlBPnKNDrrT38EBuRlmknTQkkrk3hraCFPkDh1IpRi5aDpAHTR/KZrUSA+MHiQ/QnwC4RXfC5+nJEy9gtEEpxy5NrhpAYbVQRMiS5pzmOLrK1pA0dJbQNlEWUsPrAgsy7DsrjHuWqOVYbj6jaopdMQ0utb4FHl7BhZYEp9hKQkkKUDlWGFBM/io3hcP3tqbDqeqRe1e8RIz5A4cp+eo/r2nmslkXRsBIbVVVSwKIoCPwCf+GBxYagX9UHEgY8O+NUZO1zCdcXc4SHDXMfGom2TpKB4O4iQ2R9DCE68VmE9FUXc8g19F853WYC6K4yCVdYSzmxnNt1jeeD++CwLzd5CnpPSn98o8aTlZnotpGa5lV2LeH0Mqzb9Is1z7mKZDlq3T9gInmKs2LXegog/7nQqbthosyWZH8lLFQ9U7z086nQ+YkkxzjmCZQNxmfSy1Pu921d1/gnd1tTID+J2tlBUdrTDhudoC27IspNvv/8N5jLsS52nMD71S4G+EMZq/9BK+68Wivy4Yx2mf8Q3fYZFg2YdAgfMtxTThdm9DM0AN8I4yJf4reuA7hT+jm22pWaZ0w4+zV6MwL4nIG2ckSEYPehhOdZKi9Jfp4NtxWo0DDiXKmekXegOv3szVJvEfa7kC/1yMAAuy+reA0q9wBho5ojkWL/ujhpHv1fGKxaQ+F/8nm/PTNbw4XozKUrX41mnnOmjnGs0+wzVie/meqka5pFpBN1Sj2fpEdYzjYUo+SNU2emPnGq7Ddq7zL5/hOseH91Q1yCXVCrmhOve+nKhmsR2b2QepjuxfUX1u7Ff0hJnGHtn6SbwBs9yLdU5TnBKpH7EJ5Tmm0kuIlFxdQTATyYggeUJxBJT06Q/zDOclZfVzRel5xDYb6ICpnR3mKTl8DAVaDdWqoNamG9zjLXd1a+e0K4p/f4LidDG7uV/MF7PFtAVQL//VkI/ru0kL2FruYV/x6/FgKVkL3iNJ9kJ+HO+y3hck1UXsE7q1qe+tvKtxAuVoAatOqFfSb9cL9kDyLVyovwLVf6GuxTQ6+hpvR6ySfm8L/4GT+/z2E4oMkVSSCgAA";

      const finalReservaId = reservaId || fallbackIdent;

      // Credenciais da API Larian (conforme o n8n)
      const LARIAN_BASE = "http://34.72.225.221:8000/api/v1";
      const LARIAN_EMAIL = "seller_user@larian.local";
      const LARIAN_PASSWORD = "seller123";

      const t0 = performance.now();

      // 1) LOGIN (corrigido para JSON)
      log("reserve:login-start");
      const loginRes = await fetch(`${LARIAN_BASE}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          email: LARIAN_EMAIL,
          password: LARIAN_PASSWORD
        })
      });

      if (!loginRes.ok) {
        const loginText = await loginRes.text();
        throw new Error(`Login falhou (${loginRes.status}): ${loginText}`);
      }

      const loginData = await loginRes.json();
      const accessToken = loginData.access_token;
      
      if (!accessToken) {
        throw new Error("Token de acesso não retornado pelo login");
      }

      log("reserve:login-success", { tokenLength: accessToken.length });

      // 2) RESERVA (igual ao n8n)
      const reservePayload = {
        IdentificacaoDaViagem: finalReservaId,
        passengers: [
          {
            CPF: cpf,
            Nome: nomeUp,
            Sexo: "M",
            Email: email,
            Telefone: {
              NumeroDDD: ddd,
              NumeroDDI: "55",
              NumeroTelefone: numeroTel,
            },
            Sobrenome: sobrenomeUp,
            Nascimento: "2000-01-01",
            FaixaEtaria: "ADT"
          }
        ]
      };

      // Log detalhado do payload antes do envio
      log("reserve:payload-final", {
        reservaId: (finalReservaId || "").slice(0, 24) + "…",
        passenger: {
          Nome: reservePayload.passengers[0].Nome,
          Sobrenome: reservePayload.passengers[0].Sobrenome,
          Email: reservePayload.passengers[0].Email,
          hasTestInPayload: JSON.stringify(reservePayload).toUpperCase().includes("TEST")
        }
      });

      log("reserve:reservation-start");
      const reserveRes = await fetch(`${LARIAN_BASE}/travellink/reservations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify(reservePayload)
      });

      const reserveText = await reserveRes.text();
      log("reserve:response", {
        status: reserveRes.status,
        ms: Math.round(performance.now() - t0),
        bodySample: reserveText.slice(0, 300) + (reserveText.length > 300 ? "…" : ""),
      });

      let data;
      try {
        data = JSON.parse(reserveText);
      } catch {
        data = { raw: reserveText };
      }

      if (!reserveRes.ok) {
        const msg = data?.error || data?.message || data?.raw || reserveText || "Falha na reserva";
        const err = new Error(`Reserva falhou (${reserveRes.status}): ${String(msg).slice(0, 300)}`);
        err.status = reserveRes.status;
        err.body = data;
        throw err;
      }

      // Tratar erro de negócio mesmo com HTTP 200
      if (!isReservationSuccess(data)) {
        const msg = reservationErrorReason(data);
        const err = new Error(`Reserva retornou erro de negócio: ${msg}`);
        err.status = 200;
        err.body = data;
        throw err;
      }

      return data;
    } catch (e) {
      throw e;
    }
  }

  if (toStep3Btn) {
    toStep3Btn.addEventListener("click", async () => {
      if (!state.payment.confirmed) {
        setPaymentStatus("Finalize o pagamento para emitir o bilhete.", "error");
        return;
      }
      if (!state.reserved) {
        setPaymentStatus("A reserva não foi confirmada. Tente novamente.", "error");
        return;
      }
      // Agora gera diretamente o PDF com os dados reais (sem abrir HTML mockado)
      await emitTicket();
      showStep(4);
    });
  }

  if (btnEmitirNovamente) {
    btnEmitirNovamente.addEventListener("click", async () => {
      await emitTicket();
    });
  }

  if (btnReiniciar) {
    btnReiniciar.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.reload();
    });
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // Preenche dinamicamente o ticket.html com os dados do fluxo
  function fillTicketHtml(flight, passenger, payment) {
    try {
      const map = {
        numeroBilhete: flight?.numeroBilhete || "—",
        localizador: flight?.reservationId || "—",
        passageiro: passenger?.nomeCompleto || "—",
        emissao: `Emitido em ${new Date().toLocaleDateString("pt-BR")}`,
        voo1: flight?.routeLine ? `${flight.routeLine}<br>${flight.date} ${flight.depart} → ${flight.arrive}` : "—",
        voo1Num: flight?.airlineLine || "—",
        voo1Esc: flight?.stops || "0",
        voo1Cl: "B",
        voo1Info: `Bagagem: ${flight?.baggage || "—"}`,
        voo1Loc: flight?.reservationId || "—",
        voo2: "—",
        voo2Num: "—",
        voo2Esc: "—",
        voo2Cl: "—",
        voo2Info: "—",
        voo2Loc: "—",
        tarifa: flight?.total || "—",
        taxas: "—",
        total: flight?.total || "—",
        forma: payment?.method || "—",
        pagTarifa: flight?.total || "—",
        pagTaxas: "—",
        pagTotal: flight?.total || "—",
        bandeira: "—",
        cartao: "—",
        autorizacao: payment?.confirmed ? "Autorizado" : "Pendente"
      };
      Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = map[id];
      });
    } catch (e) {
      console.warn("Falha ao preencher ticket.html:", e);
    }
  }

  // Emissão de bilhete agora gera PDF a partir do template ticket.html
  async function emitTicket() {
    try {
      // Em vez de buscar ticket.html mockado, gera o HTML dinamicamente com os dados reais
      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: Arial, sans-serif; font-size: 12px; }
              h1 { color: #a200ff; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
              th { background: #f0f0f0; }
            </style>
          </head>
          <body>
            <h1>LARIAN - Bilhete Eletrônico</h1>
            <p><b>Número do bilhete:</b> ${state.flight?.numeroBilhete || state.flight?.reservationId || "—"}</p>
            <p><b>Localizador:</b> ${state.flight?.reservationId || "—"}</p>
            <p><b>Passageiro:</b> ${state.passenger?.nomeCompleto || "—"}</p>
            <p><b>Emitido em:</b> ${new Date().toLocaleDateString("pt-BR")}</p>
            <h2>Voo</h2>
            <table>
              <tr><th>Origem</th><th>Destino</th><th>Data</th><th>Partida</th><th>Chegada</th><th>Voo</th><th>Bagagem</th></tr>
              <tr>
                <td>${state.flight?.origin || ""}</td>
                <td>${state.flight?.destination || ""}</td>
                <td>${state.flight?.date || ""}</td>
                <td>${state.flight?.depart || ""}</td>
                <td>${state.flight?.arrive || ""}</td>
                <td>${state.flight?.airlineLine || ""}</td>
                <td>${state.flight?.baggage || ""}</td>
              </tr>
            </table>
            <h2>Pagamento</h2>
            <p><b>Método:</b> ${state.payment?.method || "—"}<br/>
               <b>Status:</b> ${state.payment?.confirmed ? "Autorizado" : "Pendente"}</p>
            <p><b>Total:</b> ${state.flight?.total || "—"}</p>
          </body>
        </html>
      `;

      // Cria um iframe oculto para renderizar o HTML real
      const iframe = document.createElement("iframe");
      iframe.style.position = "absolute";
      iframe.style.left = "-9999px";
      document.body.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();

      // Aguarda renderização
      await new Promise(res => setTimeout(res, 500));

      // Preenche os dados no iframe usando o documento do iframe
      const fillMap = {
        numeroBilhete: state.flight?.numeroBilhete || state.flight?.reservationId || "—",
        localizador: state.flight?.reservationId || "—",
        passageiro: state.passenger?.nomeCompleto || "—",
        emissao: `Emitido em ${new Date().toLocaleDateString("pt-BR")}`,
        voo1: `${state.flight?.origin || ""} → ${state.flight?.destination || ""}<br>${state.flight?.date || ""} ${state.flight?.depart || ""} → ${state.flight?.arrive || ""}`,
        voo1Num: state.flight?.airlineLine || "—",
        voo1Esc: state.flight?.stops || "0",
        voo1Cl: "B",
        voo1Info: `Bagagem: ${state.flight?.baggage || "—"}`,
        voo1Loc: state.flight?.reservationId || "—",
        voo2: "",
        voo2Num: "",
        voo2Esc: "",
        voo2Cl: "",
        voo2Info: "",
        voo2Loc: "",
        tarifa: state.flight?.total || "—",
        taxas: state.flight?.taxas || "—",
        total: state.flight?.total || "—",
        forma: state.payment?.method || "—",
        pagTarifa: state.flight?.total || "—",
        pagTaxas: state.flight?.taxas || "—",
        pagTotal: state.flight?.total || "—",
        bandeira: state.payment?.bandeira || "—",
        cartao: state.payment?.cartao || "—",
        autorizacao: state.payment?.confirmed ? (state.payment?.autorizacao || "Autorizado") : "Pendente"
      };
      Object.keys(fillMap).forEach(id => {
        const el = iframe.contentDocument.getElementById(id);
        if (el) el.innerHTML = fillMap[id];
      });

      // Usa html2canvas + jsPDF para gerar PDF do template
      const canvas = await html2canvas(iframe.contentDocument.body, { scale: 3, useCORS: true, logging: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jspdf.jsPDF("p", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Faz o conteúdo ocupar toda a página
      const imgWidth = pageWidth;
      const imgHeight = pageHeight;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);

      // Nome do arquivo
      const pax = state.passenger || {};
      const opt = state.flight || {};
      const route =
        (opt?.origin && opt?.destination) ? `${opt.origin}-${opt.destination}` :
        (opt?.routeLine ? opt.routeLine.replace(/\s*→\s*/g, "-") : "voo");
      const dateIso = toIsoDate(opt?.date) || new Date().toISOString().slice(0, 10);
      const filename = `bilhete_${sanitizeFilename(pax.nomeCompleto || "passageiro")}_${route}_${dateIso}.pdf`;

      // Força download do PDF
      pdf.save(filename);

      document.body.removeChild(iframe);
      setStatus("Bilhete emitido com sucesso (PDF).", "success");
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      alert("Erro ao gerar PDF: " + err.message);
      setStatus("Falha ao emitir o bilhete.", "error");
    }
  }

  // Funções de layout do PDF
  function wrapText(text, font, fontSize, maxWidth) {
    if (!text) return [""];
    const words = text.replace(/\r\n/g, "\n").split(/\s+/);
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

    // A4 retrato
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 56;
    const contentWidth = width - margin * 2;

    // Cabeçalho
    const title = "Bilhete Aéreo";
    const titleSize = 20;
    page.drawText(title, {
      x: margin,
      y: height - margin - titleSize,
      size: titleSize,
      font: fontBold,
      color: rgb(0.18, 0.2, 0.6),
    });

    // Linha (pdf-lib não possui drawLine; usamos um retângulo fino)
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

    // Voo
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

    // Passageiro
    drawLabel("Passageiro");
    drawValue(
      [
        `Nome: ${pax?.nomeCompleto || "-"}`,
        `CPF: ${pax?.cpf || "-"}`,
        `Telefone: ${pax?.telefone || "-"}`,
        `E-mail: ${pax?.email || "-"}`,
      ].join("\n")
    );

    // Pagamento
    drawLabel("Pagamento");
    drawValue(
      [
        `Método: ${pay?.method || "-"}`,
        `Status: ${pay?.confirmed ? "Confirmado" : "Pendente"}`,
      ].join("\n")
    );

    // Rodapé
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

  // Inicial
  document.addEventListener("DOMContentLoaded", async () => {
    showStep(1);
    initSeller();
    // Estado inicial sem overlay
    try { hideOverlay(); } catch {}
    try {
      const params = new URLSearchParams(location.search);
      const flightUrl = params.get("flightUrl");
      const ofertaId = params.get("oferta");
      const apiBaseFromParams = params.get("apiBase");

      function computeApiBase() {
        // 1) apiBase explícito sempre vence
        if (apiBaseFromParams) return apiBaseFromParams;
        
        // A API está sempre na mesma origem da página, o Nginx faz o proxy.
        return window.location.origin;
      }

      state.apiBase = computeApiBase();

      // Evita mixed-content quando a página é HTTPS
      if (location.protocol === "https:" && /^http:\/\//i.test(state.apiBase)) {
        const upgraded = state.apiBase.replace(/^http:\/\//i, "https://");
        console.warn("apiBase HTTP em página HTTPS; atualizando para", upgraded);
        state.apiBase = upgraded;
      }
      console.log(`[Debug] apiBase definido como: ${state.apiBase}`);

      // Permitir configurar timeout do front por query (?reserveTimeout=120s | 90000)
      const reserveTimeoutParam = params.get("reserveTimeout");
      const parsedMs = parseMs(reserveTimeoutParam);
      if (parsedMs && parsedMs > 0) {
        state.timeouts.reserveMs = parsedMs;
        log("config:reserveTimeoutMs", parsedMs);
      }

      // Debug tools setup
      try {
        const dt = byId("debugTools");
        const debugParam = params.get("debug");
        if (dt && debugParam === "1") {
          dt.classList.remove("hidden");
        }
        if (byId("linkOpenConfig")) byId("linkOpenConfig").href = `${state.apiBase}/config`;
        if (byId("linkOpenDebug")) byId("linkOpenDebug").href = `${state.apiBase}/debug/last-reserve`;

        if (byId("btnApplyIdent")) {
          byId("btnApplyIdent").addEventListener("click", () => {
            const v = byId("debugIdentInput")?.value?.trim() || "";
            if (byId("reservaId")) byId("reservaId").value = v;
            updateReservationCode(v);
            setStatus("IdentificacaoDaViagem aplicada ao formulário.", "");
          });
        }
        if (byId("btnSaveIdent")) {
          byId("btnSaveIdent").addEventListener("click", async () => {
            try {
              const v = byId("debugIdentInput")?.value?.trim() || "";
              if (!v) {
                setStatus("Informe uma IdentificacaoDaViagem para salvar.", "error");
                return;
              }
              const r = await fetch(`${state.apiBase}/identificacao`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ IdentificacaoDaViagem: v }),
              });
              const t = await r.text();
              let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
              if (!r.ok) throw new Error(j?.error || j?.message || j?.raw || `Falha (${r.status})`);
              setStatus("Fallback salvo com sucesso.", "success");
            } catch (e) {
              setStatus(`Falha ao salvar fallback: ${e.message || e}`, "error");
            }
          });
        }
      } catch (e) {
        console.warn("debugTools setup failed", e);
      }

      // Bind de cópia do identificador (Tela 1)
      try {
        const copyBtn = byId("copyReservaBtn");
        if (copyBtn) copyBtn.addEventListener("click", copyReservationId);
      } catch {}

      // Bind do download de PDF na etapa 4
      try {
        const dl = byId("btnDownloadPdf");
        if (dl) dl.addEventListener("click", async () => {
          try { await emitTicket(); } catch (e) { console.warn("Falha ao baixar PDF:", e); }
        });
      } catch {}

      // Bind de cópia do PNR no talão da etapa 4
      try {
        const copyStub = byId("bp-copyBtn");
        if (copyStub) copyStub.addEventListener("click", copyReservationId);
      } catch {}

      if (ofertaId) {
        try {
          setStatus("Carregando oferta...");
          const url = `${state.apiBase}/api/oferta/${ofertaId}`;
          console.log(`[Debug] Buscando oferta na URL: ${url}`);
          const res = await fetch(url);
          const rawText = await res.text();
          console.log(`[Debug] Resposta crua da oferta: Status ${res.status}`, rawText);
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            console.error(`[oferta] Falha ao buscar oferta ${ofertaId}. Status: ${res.status}`, errBody);
            throw new Error(errBody.message || `Oferta não encontrada (${res.status})`);
          }
          const body = JSON.parse(rawText);
          console.log("[oferta] Payload recebido do backend:", body);
          const f = parseFlightBody(body);
          if (f) {
            console.log("[oferta] Payload processado com sucesso:", f);
            populateFormWithFlight(f);
            setStatus("");
          } else {
            console.error("[oferta] Falha ao processar o payload recebido.");
            setStatus("Não foi possível interpretar os dados da oferta.", "error");
          }
        } catch (e) {
          setStatus(`Falha ao carregar oferta: ${e.message}`, "error");
        }
      } else if (flightUrl) {
        // Tenta buscar JSON remoto (ex.: Mock do Postman)
        const body = await fetchFlightFromUrl(flightUrl);
        const f = parseFlightBody(body);
        if (f) {
          populateFormWithFlight(f);
        } else {
          setStatus("Não foi possível interpretar os dados do voo recebidos.", "error");
        }
      } else {
        // Tenta fontes locais (window.__flightBody, storage, ?flight=)
        autoPopulateFormFromInjectedFlight();
      }
    } catch (e) {
      console.warn("Falha ao carregar dados do voo:", e);
      setStatus("Falha ao carregar dados do voo.", "error");
    }
  });
})();
