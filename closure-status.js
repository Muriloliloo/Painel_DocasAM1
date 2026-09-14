(() => {
  const STYLE_ID = "closure-status-module-style";
  const CARD_ID = "closureWaveGaugeCard";
  const CHART_ID = "closureWaveGaugeGrid";
  const IMPACT_CARD_ID = "closureImpactCard";
  let resizeObserver = null;
  let bodyObserver = null;
  let drawQueued = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #fechamentoView .closure-layout.closure-gauges-enabled {
        width: 100%;
        min-width: 0;
        grid-template-columns:
          minmax(500px, .95fr)
          minmax(290px, 330px)
          minmax(560px, 1.05fr) !important;
      }

      .closure-gauges-card {
        min-width: 0;
        overflow: hidden;
        padding: 18px;
        border: 1px solid #c7d3df;
        border-radius: 8px;
        background: #ffffff;
        color: #063354;
        box-shadow: 0 3px 10px rgba(5, 41, 77, .09);
      }

      .closure-gauges-header {
        display: grid;
        justify-items: center;
        gap: 6px;
        text-align: center;
      }

      .closure-gauges-title {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #263746;
        font: 900 16px/1.05 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-gauges-title i {
        color: #0b7fc2;
        font-size: 18px;
      }

      .closure-gauges-header small {
        color: #70808d;
        font: 800 10px/1.2 "Segoe UI", Arial, sans-serif;
      }

      .closure-gauges-meta {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border: 1px solid #b9ccd9;
        border-radius: 999px;
        background: #edf6fb;
        color: #063354;
        font: 900 9px/1 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-gauges-legend {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin: 12px 0 14px;
        color: #59636c;
        font: 800 9px/1 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-gauges-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }

      .closure-gauges-legend i { font-size: 9px; }
      .closure-gauges-legend .critical { color: #ef3340; }
      .closure-gauges-legend .attention { color: #f0b429; }
      .closure-gauges-legend .target { color: #20ad55; }

      .closure-gauges-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(92px, 1fr));
        align-items: stretch;
        gap: 10px;
      }

      .closure-gauge-wave {
        min-width: 0;
        display: grid;
        grid-template-rows: auto auto auto auto;
        align-content: start;
        justify-items: center;
        padding: 10px 7px 9px;
        border: 1px solid #d8e1e8;
        border-radius: 8px;
        background: #f8fbfd;
        text-align: center;
      }

      .closure-gauge-wave.is-target { border-color: #8fcda5; }
      .closure-gauge-wave.is-attention { border-color: #e7c46d; }
      .closure-gauge-wave.is-critical { border-color: #eca0a6; }
      .closure-gauge-wave.is-empty { border-style: dashed; }

      .closure-gauge-wave-name {
        overflow: hidden;
        max-width: 100%;
        color: #263746;
        font: 900 11px/1 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-gauge-wave-time {
        overflow: hidden;
        max-width: 100%;
        margin-top: 5px;
        color: #78858f;
        font: 800 9px/1 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-gauge-stage {
        width: 100%;
        height: 88px;
        margin-top: 5px;
      }

      .closure-gauge-canvas {
        display: block;
        width: 100%;
        height: 88px;
      }

      .closure-gauge-reading {
        display: grid;
        justify-items: center;
        gap: 4px;
        margin-top: -3px;
      }

      .closure-gauge-percent {
        color: #063354;
        font: 950 23px/1 "Segoe UI", Arial, sans-serif;
        letter-spacing: -.7px;
      }

      .closure-gauge-status {
        min-height: 11px;
        font: 900 8px/1 "Segoe UI", Arial, sans-serif;
        letter-spacing: .2px;
        text-transform: uppercase;
      }

      .closure-gauge-status.target { color: #12813b; }
      .closure-gauge-status.attention { color: #9a6900; }
      .closure-gauge-status.critical { color: #c31d2a; }
      .closure-gauge-status.empty { color: #78858f; }

      .closure-gauge-counts {
        display: block;
        overflow: hidden;
        max-width: 100%;
        margin-top: 7px;
        color: #596b78;
        font: 800 9px/1.2 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-impact-card {
        grid-column: 1 / -1;
        min-width: 0;
        overflow: hidden;
        padding: 18px;
        border: 1px solid #c7d3df;
        border-radius: 8px;
        background: #ffffff;
        color: #063354;
        box-shadow: 0 3px 10px rgba(5, 41, 77, .09);
      }

      .closure-impact-header {
        display: grid;
        justify-items: center;
        gap: 6px;
        text-align: center;
      }

      .closure-impact-title {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #263746;
        font: 900 16px/1.05 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-impact-title i {
        color: #0b7fc2;
        font-size: 18px;
      }

      .closure-impact-header small {
        color: #70808d;
        font: 800 10px/1.2 "Segoe UI", Arial, sans-serif;
      }

      .closure-impact-scope {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border: 1px solid #b9ccd9;
        border-radius: 999px;
        background: #edf6fb;
        color: #063354;
        font: 900 9px/1 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-impact-summary {
        display: grid;
        grid-template-columns: minmax(150px, .55fr) repeat(2, minmax(220px, 1fr));
        gap: 10px;
        margin-top: 14px;
      }

      .closure-impact-kpi {
        min-width: 0;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-height: 78px;
        padding: 12px;
        border: 1px solid #d8e1e8;
        border-radius: 8px;
        background: #f8fbfd;
      }

      .closure-impact-kpi-icon {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        background: #e4f4fc;
        color: #0b7fc2;
        font-size: 19px;
      }

      .closure-impact-kpi.total .closure-impact-kpi-icon {
        background: #fff0f1;
        color: #d82432;
      }

      .closure-impact-kpi.carrier .closure-impact-kpi-icon {
        background: #fff7dc;
        color: #a97000;
      }

      .closure-impact-kpi-copy {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .closure-impact-kpi-copy span {
        color: #70808d;
        font: 900 9px/1.1 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-impact-kpi-copy strong {
        overflow: hidden;
        color: #063354;
        font: 950 18px/1.05 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-impact-kpi.total .closure-impact-kpi-copy strong {
        color: #d82432;
        font-size: 28px;
      }

      .closure-impact-rankings {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 10px;
      }

      .closure-impact-ranking {
        min-width: 0;
        overflow: hidden;
        border: 1px solid #d8e1e8;
        border-radius: 8px;
        background: #ffffff;
      }

      .closure-impact-ranking header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 38px;
        padding: 9px 12px;
        background: #edf6fb;
        color: #063354;
      }

      .closure-impact-ranking header strong {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font: 900 11px/1 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-impact-ranking header i { color: #0b7fc2; }

      .closure-impact-ranking header span {
        flex: 0 0 auto;
        min-width: 26px;
        padding: 4px 7px;
        border-radius: 999px;
        background: #063354;
        color: #ffffff;
        font: 900 9px/1 "Segoe UI", Arial, sans-serif;
        text-align: center;
      }

      .closure-impact-table-wrap {
        overflow-x: auto;
      }

      .closure-impact-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .closure-impact-table th,
      .closure-impact-table td {
        padding: 7px 12px;
        border-top: 1px solid #e1e8ee;
        color: #263746;
        font: 800 10px/1.2 "Segoe UI", Arial, sans-serif;
        text-align: left;
      }

      .closure-impact-table th:last-child,
      .closure-impact-table td:last-child {
        width: 62px;
        text-align: center;
      }

      .closure-impact-ranking:last-child .closure-impact-table th:last-child,
      .closure-impact-ranking:last-child .closure-impact-table td:last-child {
        width: 132px;
        padding-right: 78px;
      }

      .closure-impact-table thead th {
        border-top: 0;
        background: #f8fbfd;
        color: #70808d;
        font-size: 8px;
        text-transform: uppercase;
      }

      .closure-impact-table tbody tr:first-child td:first-child {
        color: #063354;
        font-weight: 950;
      }

      .closure-impact-count {
        display: inline-grid;
        place-items: center;
        min-width: 30px;
        min-height: 22px;
        padding: 3px 6px;
        border-radius: 6px;
        background: #e4f4fc;
        color: #0872ad;
        font-weight: 950;
      }

      .closure-impact-empty {
        padding: 20px 12px !important;
        color: #70808d !important;
        text-align: center !important;
      }

      body.dark-mode .closure-gauges-card {
        border-color: #294b66;
        background: #0d263b;
        color: #edf7ff;
      }

      body.dark-mode .closure-impact-card,
      body.dark-mode .closure-impact-ranking {
        border-color: #294b66;
        background: #0d263b;
        color: #edf7ff;
      }

      body.dark-mode .closure-gauges-title,
      body.dark-mode .closure-gauge-wave-name,
      body.dark-mode .closure-gauge-percent,
      body.dark-mode .closure-impact-title,
      body.dark-mode .closure-impact-kpi-copy strong,
      body.dark-mode .closure-impact-ranking header,
      body.dark-mode .closure-impact-table th,
      body.dark-mode .closure-impact-table td { color: #edf7ff; }

      body.dark-mode .closure-gauges-header small,
      body.dark-mode .closure-gauges-legend,
      body.dark-mode .closure-gauge-wave-time,
      body.dark-mode .closure-gauge-counts,
      body.dark-mode .closure-impact-header small,
      body.dark-mode .closure-impact-kpi-copy span,
      body.dark-mode .closure-impact-empty { color: #afc0cd !important; }

      body.dark-mode .closure-gauges-meta {
        border-color: #365b75;
        background: #153a54;
        color: #edf7ff;
      }

      body.dark-mode .closure-impact-scope {
        border-color: #365b75;
        background: #153a54;
        color: #edf7ff;
      }

      body.dark-mode .closure-impact-kpi,
      body.dark-mode .closure-impact-table thead th {
        border-color: #294b66;
        background: #102f46;
      }

      body.dark-mode .closure-impact-ranking header {
        background: #153a54;
      }

      body.dark-mode .closure-impact-table th,
      body.dark-mode .closure-impact-table td {
        border-color: #294b66;
      }

      body.dark-mode .closure-gauge-wave {
        border-color: #294b66;
        background: #102f46;
      }

      body.dark-mode .closure-gauge-wave.is-target { border-color: #397c55; }
      body.dark-mode .closure-gauge-wave.is-attention { border-color: #816824; }
      body.dark-mode .closure-gauge-wave.is-critical { border-color: #87434a; }

      @media (max-width: 1680px) {
        #fechamentoView .closure-layout.closure-gauges-enabled {
          grid-template-columns:
            minmax(500px, 1fr)
            minmax(290px, 330px) !important;
        }

        #fechamentoView .closure-gauges-card { grid-column: 1 / -1; }
      }

      @media (max-width: 900px) {
        #fechamentoView .closure-layout.closure-gauges-enabled {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        #fechamentoView .closure-gauges-card { grid-column: auto; }
        #fechamentoView .closure-impact-card { grid-column: auto; }
        .closure-gauges-grid { grid-template-columns: repeat(2, minmax(126px, 1fr)); }
        .closure-impact-summary { grid-template-columns: minmax(0, 1fr); }
        .closure-impact-rankings { grid-template-columns: minmax(0, 1fr); }
      }

      @media (max-width: 480px) {
        .closure-gauges-grid { grid-template-columns: minmax(0, 1fr); }
        .closure-impact-card { padding: 14px; }
        .closure-impact-kpi-copy strong { font-size: 15px; }
      }
    `;

    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percentLabel(value) {
    const rounded = Math.round(Number(value || 0) * 10) / 10;
    const decimals = Math.abs(rounded - Math.round(rounded)) < .001 ? 0 : 1;
    return `${rounded.toFixed(decimals).replace(".", ",")}%`;
  }

  function metaPercent() {
    const configured = Number.parseFloat(String(data?.metaOot ?? "").replace(",", "."));
    return clamp(Number.isFinite(configured) ? configured : 85, 1, 100);
  }

  function waveClosureProgress(wave) {
    const rows = typeof plannedRows === "function" ? plannedRows(wave) : [];
    const planned = rows.length;
    const shippedRaw = typeof operationalShippedRows === "function"
      ? operationalShippedRows(wave)
      : (typeof shippedRows === "function" ? shippedRows(wave).length : 0);
    const shipped = clamp(Number(shippedRaw) || 0, 0, planned);
    const pending = Math.max(0, planned - shipped);
    const percent = planned ? (shipped / planned) * 100 : 0;

    return { planned, shipped, pending, percent };
  }

  function gaugeState(progress, target) {
    if (!progress.planned) return { key: "empty", label: "Sem dados" };
    if (progress.percent >= target) return { key: "target", label: "Meta atingida" };
    if (progress.percent >= Math.max(0, target - 15)) return { key: "attention", label: "Atenção" };
    return { key: "critical", label: "Abaixo da meta" };
  }

  function ensureCard() {
    const layout = document.querySelector("#fechamentoView .closure-layout");
    if (!layout) return null;

    layout.classList.remove("closure-status-enabled");
    layout.classList.add("closure-gauges-enabled");

    const previousCard = document.getElementById("closureStatusCard");
    if (previousCard) previousCard.remove();

    let card = document.getElementById(CARD_ID);
    if (card) return card;

    card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "closure-gauges-card";
    card.setAttribute("aria-label", "Atualização de fechamento por ondas");
    layout.appendChild(card);

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(queueGaugeDraw);
      resizeObserver.observe(card);
    }

    return card;
  }

  function ensureImpactCard() {
    const layout = document.querySelector("#fechamentoView .closure-layout");
    if (!layout) return null;

    let card = document.getElementById(IMPACT_CARD_ID);
    if (card) return card;

    card = document.createElement("section");
    card.id = IMPACT_CARD_ID;
    card.className = "closure-impact-card";
    card.setAttribute("aria-label", "Impactos por transportadora e motivo");
    layout.appendChild(card);
    return card;
  }

  function closureImpactRows() {
    const rows = typeof pendingRows === "function" ? pendingRows(null, true) : [];
    const uniqueRows = new Map();

    rows.forEach((row, index) => {
      const wave = typeof waveLabel === "function" ? waveLabel(row.onda) : String(row.onda || "");
      const route = typeof routeKey === "function" ? routeKey(row.rota) : String(row.rota || "").trim().toUpperCase();
      const key = route ? `${wave}::${route}` : `${wave}::${row.doca || ""}::${index}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, row);
    });

    return Array.from(uniqueRows.values()).map(row => ({
      ...row,
      impactCarrier: (typeof cleanTransportadora === "function"
        ? cleanTransportadora(row.transportadora)
        : String(row.transportadora || "").trim()) || "Sem transportadora",
      impactReason: (typeof getJustification === "function" ? getJustification(row.rota) : "") || "Sem justificativa"
    }));
  }

  function rankedImpacts(rows, getLabel) {
    const counts = new Map();

    rows.forEach(row => {
      const label = String(getLabel(row) || "-").replace(/\s+/g, " ").trim() || "-";
      counts.set(label, (counts.get(label) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }));
  }

  function impactRankingRows(entries, emptyLabel) {
    if (!entries.length) {
      return `<tr><td class="closure-impact-empty" colspan="2">${escapeHtml(emptyLabel)}</td></tr>`;
    }

    return entries.slice(0, 8).map(([label, count]) => `
      <tr>
        <td title="${escapeHtml(label)}">${escapeHtml(label)}</td>
        <td><span class="closure-impact-count">${String(count).padStart(2, "0")}</span></td>
      </tr>
    `).join("");
  }

  function renderClosureImpacts() {
    const card = ensureImpactCard();
    if (!card) return;

    const rows = closureImpactRows();
    const carrierRanking = rankedImpacts(rows, row => row.impactCarrier);
    const reasonRanking = rankedImpacts(rows, row => row.impactReason);
    const topCarrier = carrierRanking[0]?.[0] || "Sem impactos";
    const topReason = reasonRanking[0]?.[0] || "Sem impactos";
    const waveCount = Array.isArray(data?.ondas) ? data.ondas.length : 0;

    card.innerHTML = `
      <header class="closure-impact-header">
        <strong class="closure-impact-title">
          <i class="bi bi-bar-chart-line-fill" aria-hidden="true"></i>
          Impactos por transportadora e motivo
        </strong>
        <small>Estratificação automática das rotas ainda não expedidas</small>
        <span class="closure-impact-scope">
          <i class="bi bi-layers-fill" aria-hidden="true"></i>
          Todas as ondas · ${waveCount} analisadas
        </span>
      </header>

      <div class="closure-impact-summary">
        <article class="closure-impact-kpi total">
          <span class="closure-impact-kpi-icon"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i></span>
          <span class="closure-impact-kpi-copy">
            <span>Total de impactos</span>
            <strong>${rows.length}</strong>
          </span>
        </article>
        <article class="closure-impact-kpi carrier">
          <span class="closure-impact-kpi-icon"><i class="bi bi-truck" aria-hidden="true"></i></span>
          <span class="closure-impact-kpi-copy">
            <span>Maior ofensor transportadora</span>
            <strong title="${escapeHtml(topCarrier)}">${escapeHtml(topCarrier)}</strong>
          </span>
        </article>
        <article class="closure-impact-kpi reason">
          <span class="closure-impact-kpi-icon"><i class="bi bi-chat-left-text-fill" aria-hidden="true"></i></span>
          <span class="closure-impact-kpi-copy">
            <span>Maior ofensor motivo</span>
            <strong title="${escapeHtml(topReason)}">${escapeHtml(topReason)}</strong>
          </span>
        </article>
      </div>

      <div class="closure-impact-rankings">
        <section class="closure-impact-ranking" aria-label="Ranking de motivos">
          <header>
            <strong><i class="bi bi-list-ol" aria-hidden="true"></i>Ranking motivos</strong>
            <span>${reasonRanking.length}</span>
          </header>
          <div class="closure-impact-table-wrap">
            <table class="closure-impact-table">
              <thead><tr><th>Descrição</th><th>Qtd</th></tr></thead>
              <tbody>${impactRankingRows(reasonRanking, "Nenhum motivo pendente")}</tbody>
            </table>
          </div>
        </section>

        <section class="closure-impact-ranking" aria-label="Ranking de transportadoras">
          <header>
            <strong><i class="bi bi-buildings-fill" aria-hidden="true"></i>Ranking transportadoras</strong>
            <span>${carrierRanking.length}</span>
          </header>
          <div class="closure-impact-table-wrap">
            <table class="closure-impact-table">
              <thead><tr><th>Descrição</th><th>Qtd</th></tr></thead>
              <tbody>${impactRankingRows(carrierRanking, "Nenhuma transportadora pendente")}</tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function renderClosureWaveGauges() {
    injectStyles();

    const card = ensureCard();
    if (!card) return;

    const waves = Array.isArray(data?.ondas) ? data.ondas : [];
    const target = metaPercent();
    const attentionStart = Math.max(0, target - 15);

    card.innerHTML = `
      <header class="closure-gauges-header">
        <strong class="closure-gauges-title">
          <i class="bi bi-speedometer2" aria-hidden="true"></i>
          Atualização de fechamento por ondas
        </strong>
        <small>Percentual de rotas expedidas em cada onda</small>
        <span class="closure-gauges-meta">
          <i class="bi bi-bullseye" aria-hidden="true"></i>
          Meta OOT ${percentLabel(target)}
        </span>
      </header>

      <div class="closure-gauges-legend" aria-label="Faixas do velocímetro">
        <span><i class="bi bi-circle-fill critical" aria-hidden="true"></i>Abaixo de ${percentLabel(attentionStart)}</span>
        <span><i class="bi bi-circle-fill attention" aria-hidden="true"></i>De ${percentLabel(attentionStart)} à meta</span>
        <span><i class="bi bi-circle-fill target" aria-hidden="true"></i>Meta atingida</span>
      </div>

      <div class="closure-gauges-grid" id="${CHART_ID}">
        ${waves.map((wave, index) => {
          const progress = waveClosureProgress(wave);
          const state = gaugeState(progress, target);
          const waveName = typeof displayWave === "function" ? displayWave(wave) : String(wave);
          const schedule = typeof parseWaveTime === "function" ? parseWaveTime(wave) : null;
          const timeLabel = schedule?.inicio && schedule?.fim
            ? `${schedule.inicio} - ${schedule.fim}`
            : "Sem horário";
          const countLabel = progress.planned
            ? `${progress.shipped}/${progress.planned} expedidas · ${progress.pending} pend.`
            : "0 rotas planejadas";
          const accessibleLabel = progress.planned
            ? `${waveName}: ${percentLabel(progress.percent)}, ${progress.shipped} de ${progress.planned} rotas expedidas, ${progress.pending} pendentes.`
            : `${waveName}: sem rotas planejadas.`;

          return `
            <article class="closure-gauge-wave is-${state.key}" aria-label="${escapeHtml(accessibleLabel)}">
              <strong class="closure-gauge-wave-name">${escapeHtml(waveName)}</strong>
              <span class="closure-gauge-wave-time">${escapeHtml(timeLabel)}</span>
              <div class="closure-gauge-stage">
                <canvas
                  class="closure-gauge-canvas"
                  data-gauge-index="${index}"
                  data-percent="${progress.percent.toFixed(3)}"
                  data-target="${target.toFixed(3)}"
                  data-empty="${progress.planned ? "false" : "true"}"
                  aria-hidden="true"></canvas>
              </div>
              <div class="closure-gauge-reading">
                <strong class="closure-gauge-percent">${percentLabel(progress.percent)}</strong>
                <span class="closure-gauge-status ${state.key}">${state.label}</span>
                <span class="closure-gauge-counts">${escapeHtml(countLabel)}</span>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;

    renderClosureImpacts();
    queueGaugeDraw();
  }

  function queueGaugeDraw() {
    if (drawQueued) return;
    drawQueued = true;

    requestAnimationFrame(() => {
      drawQueued = false;
      document.querySelectorAll(`#${CARD_ID} .closure-gauge-canvas`).forEach(drawGauge);
    });
  }

  function drawGauge(canvas) {
    const width = Math.round(canvas.getBoundingClientRect().width);
    const height = Math.round(canvas.getBoundingClientRect().height);
    if (!width || !height) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderWidth = Math.round(width * pixelRatio);
    const renderHeight = Math.round(height * pixelRatio);

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const percent = clamp(Number(canvas.dataset.percent) || 0, 0, 100);
    const target = clamp(Number(canvas.dataset.target) || 85, 1, 100);
    const empty = canvas.dataset.empty === "true";
    const dark = document.body.classList.contains("dark-mode");
    const centerX = width / 2;
    const centerY = height * .87;
    const radius = Math.min(width * .43, height * .72);
    const lineWidth = clamp(radius * .19, 9, 15);
    const startAngle = Math.PI;
    const endAngle = Math.PI * 2;
    const angleFor = value => startAngle + (clamp(value, 0, 100) / 100) * Math.PI;

    context.lineCap = "butt";

    if (empty) {
      context.beginPath();
      context.arc(centerX, centerY, radius, startAngle, endAngle);
      context.strokeStyle = dark ? "#35536a" : "#d8e1e8";
      context.lineWidth = lineWidth;
      context.stroke();
    } else {
      const attentionStart = Math.max(0, target - 15);
      [
        [0, attentionStart, "#ef3340"],
        [attentionStart, target, "#f0b429"],
        [target, 100, "#20ad55"]
      ].forEach(([from, to, color]) => {
        if (to <= from) return;
        context.beginPath();
        context.arc(centerX, centerY, radius, angleFor(from), angleFor(to));
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke();
      });
    }

    const tickInner = radius - lineWidth * .7;
    const tickOuter = radius + lineWidth * .7;
    context.strokeStyle = dark ? "rgba(237,247,255,.72)" : "rgba(6,51,84,.58)";
    context.lineWidth = 1;

    for (let value = 0; value <= 100; value += 10) {
      const angle = angleFor(value);
      const emphasized = value === 0 || value === 50 || value === 100;
      const inner = emphasized ? tickInner - 2 : tickInner;
      context.beginPath();
      context.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      context.lineTo(centerX + Math.cos(angle) * tickOuter, centerY + Math.sin(angle) * tickOuter);
      context.stroke();
    }

    const targetAngle = angleFor(target);
    context.beginPath();
    context.moveTo(
      centerX + Math.cos(targetAngle) * (tickInner - 4),
      centerY + Math.sin(targetAngle) * (tickInner - 4)
    );
    context.lineTo(
      centerX + Math.cos(targetAngle) * (tickOuter + 3),
      centerY + Math.sin(targetAngle) * (tickOuter + 3)
    );
    context.strokeStyle = dark ? "#ffffff" : "#063354";
    context.lineWidth = 2;
    context.stroke();

    if (!empty) {
      const needleAngle = angleFor(percent);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + Math.cos(needleAngle) * radius * .72,
        centerY + Math.sin(needleAngle) * radius * .72
      );
      context.strokeStyle = dark ? "#f7fbff" : "#16364d";
      context.lineWidth = 3;
      context.lineCap = "round";
      context.stroke();

      context.beginPath();
      context.arc(centerX, centerY, 5, 0, Math.PI * 2);
      context.fillStyle = dark ? "#f7fbff" : "#16364d";
      context.fill();
    }

    context.fillStyle = dark ? "#afc0cd" : "#6f7d87";
    context.font = '800 8px "Segoe UI", Arial, sans-serif';
    context.textBaseline = "top";
    context.textAlign = "left";
    context.fillText("0", Math.max(0, centerX - radius - 2), centerY + 7);
    context.textAlign = "right";
    context.fillText("100", Math.min(width, centerX + radius + 8), centerY + 7);
  }

  function startClosureGaugeModule() {
    renderClosureWaveGauges();

    const closureContent = document.getElementById("closureContent");
    if (closureContent) {
      let updateQueued = false;
      const contentObserver = new MutationObserver(() => {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
          updateQueued = false;
          renderClosureWaveGauges();
        });
      });

      contentObserver.observe(closureContent, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    bodyObserver = new MutationObserver(queueGaugeDraw);
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"]
    });

    window.addEventListener("resize", queueGaugeDraw, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startClosureGaugeModule, { once: true });
  } else {
    startClosureGaugeModule();
  }
})();
