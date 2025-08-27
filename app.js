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

    // Trava campos do voo para usuário apenas completar os dados pessoais
    setReadOnlyFlightFields(true);
    // Atualiza resumos
    updateAmountDue();
    updateReservationCode(f.reservationId || "");
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
    steps.forEach((el, i) => {
      if (!el) return;
      if (i === n - 1) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });
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
    timeouts: {
      reserveMs: 180000, // aumentado para 180s (3 minutos)
    },
  };

  // Atualiza o valor exibido na etapa de pagamento
  function updateAmountDue() {
    const el = byId("amountDue");
    if (!el) return;
    const total = state.flight?.total || byId("total")?.value || "";
    el.textContent = (total && String(total).trim()) ? String(total) : "—";
  }

  // Atualiza exibição do código/identificador de reserva
  function updateReservationCode(code) {
    const el = byId("reservationCode");
    if (!el) return;
    el.textContent = (code && String(code).trim()) ? String(code) : "—";
  }

  // Tenta extrair um identificador de reserva comum de uma resposta arbitrária
  function extractReservationId(obj) {
    try {
      if (!obj || typeof obj !== "object") return "";
      const keys = [
        "localizador",
        "locator",
        "codigoreserva",
        "reservationcode",
        "pnr",
        "reservaid",
        "idreserva",
        "id",
        "codigo",
        "codigolocalizador"
      ];
      const stack = [obj];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const k of Object.keys(cur)) {
          const v = cur[k];
          if (keys.includes(String(k).toLowerCase()) && v != null && v !== "") {
            return String(v);
          }
          if (v && typeof v === "object") stack.push(v);
        }
      }
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

    const ciaVoo = get("ciaVoo");
    const dataISO = get("dataVoo");
    const dataBR = formatDateBRFromISO(dataISO);

    const origem = (get("origem") || "").toUpperCase();
    const destino = (get("destino") || "").toUpperCase();

    const partida = get("partida");
    const chegada = get("chegada");

    const duracao = get("duracao");
    const escalas = get("escalas");
    const bagagem = get("bagagem");
    const total = get("total");

    const nomeCompleto = get("nomeCompleto");
    const cpf = get("cpf");
    const telefone = get("telefone");
    const email = get("email");
    const reservaId = get("reservaId");

    const flight = {
      airlineLine: ciaVoo,
      date: dataBR,
      origin: origem,
      destination: destino,
      depart: partida,
      arrive: chegada,
      duration: duracao,
      stops: escalas,
      baggage: bagagem,
      total: total,
      reservationId: reservaId,
      routeLine:
        origem && destino ? `${origem} → ${destino}` : "",
      meta: {
        reservaId: reservaId || null,
      },
    };

    const passenger = {
      nomeCompleto,
      cpf,
      telefone,
      email,
    };

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
      setPaymentStatus("Processando pagamento...", "");
      const method = document.querySelector('input[name="payMethod"]:checked')?.value || "pix";
      state.payment.method = method;
      state.reserved = false;
      log("pay-click", {
        method,
        apiBase: state.apiBase,
        reservaId: byId("reservaId")?.value || state.flight?.reservationId || null,
      });

      try {
        // Simulação de processamento do pagamento
        await sleep(700);
        state.payment.confirmed = true;
        setPaymentStatus(`Pagamento confirmado (${method}). Realizando reserva...`, "");

        // Realiza a reserva antes de permitir a emissão (via backend)
        const data = await reserveViaBackend();
        const rid = extractReservationId(data) || state.flight?.reservationId || byId("reservaId")?.value || "";
        if (rid && (!state.flight || !state.flight.reservationId)) {
          state.flight = state.flight || {};
          state.flight.reservationId = rid;
          if (byId("reservaId")) byId("reservaId").value = rid;
        }
        updateReservationCode(rid);
        state.reserved = true;
        setPaymentStatus(`Reserva confirmada${rid ? ` (ID: ${rid})` : ""}. Você pode emitir o bilhete.`, "success");
        if (toStep3Btn) toStep3Btn.disabled = false;
      } catch (err) {
        console.error("Falha na reserva:", err);
        state.reserved = false;

        let uiMsg = "Falha ao reservar a passagem";
        let extra = "";

        if (err && err.status === 422 && err.body && (err.body.error === "BUSINESS_ERROR" || err.body.data)) {
          const msg = err.body.message || reservationErrorReason(err.body.data) || err.message;
          extra = msg ? `: ${msg}` : "";
          const help = buildBusinessErrorHelp(msg);
          if (help) extra += ` — ${help}`;
          // Exibe debug tools automaticamente para facilitar investigação
          showDebugTools();
          // Loga contexto de debug quando fornecido pelo backend
          if (err.body._debug) {
            log("reserve:business-error-debug", err.body._debug);
          }
        } else {
          extra = err && err.message ? `: ${err.message}` : "";
        }

        setPaymentStatus(uiMsg + extra, "error");
        if (toStep3Btn) toStep3Btn.disabled = true;
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

    const url = `${apiBase}/reservar${mockParam ? "?mock=1" : ""}`;
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

  // Emissão de bilhete PDF (layout específico do ticket)
  async function emitTicket() {
    try {
      const opt = state.flight || null;
      const pax = state.passenger || {};
      const pay = state.payment || {};
      if (!opt) {
        throw new Error("Dados do voo não encontrados.");
      }

      const pdfBytes = await generateTicketPdf(opt, pax, pay);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const route =
        (opt?.origin && opt?.destination) ? `${opt.origin}-${opt.destination}` :
        (opt?.routeLine ? opt.routeLine.replace(/\s*→\s*/g, "-") : "voo");
      const dateIso = toIsoDate(opt?.date) || new Date().toISOString().slice(0, 10);
      const filename = `bilhete_${sanitizeFilename(pax.nomeCompleto || "passageiro")}_${route}_${dateIso}.pdf`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      setStatus("Bilhete emitido com sucesso.", "success");
    } catch (err) {
      console.error(err);
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
    try {
      const params = new URLSearchParams(location.search);
      const flightUrl = params.get("flightUrl");
      const apiBaseFromParams = params.get("apiBase");
      if (apiBaseFromParams) {
        state.apiBase = apiBaseFromParams;
      } else if (flightUrl) {
        try { state.apiBase = new URL(flightUrl).origin; } catch {}
      } else if (!state.apiBase) {
        state.apiBase = location.origin.replace(":5173", ":5174");
      }

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

      if (flightUrl) {
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
