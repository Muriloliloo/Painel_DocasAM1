/* Controle de Aduana SSP15 / AM1
 * Confronta Shipment IDs da auditoria final (estado A mais) com a bipagem física.
 * Mantém o fechamento por lado existente como fonte de localização das rotas.
 */
(function () {
  "use strict";
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/1vSuN2N5xBYU_aMrxeCt-f6-UofftDMe7k6iMiZOwtAE/edit";
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const text = value => String(value == null ? "" : value).trim();
  const norm = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const idKey = value => { const raw=text(value).replace(/^\uFEFF/, "").replace(/^'/, ""); return /^[+]?[0-9]+(?:\.[0-9]+)?e[+]?[0-9]+$/i.test(raw) && Number.isSafeInteger(Number(raw)) ? String(Number(raw)) : raw.toUpperCase(); };
  const $ = id => document.getElementById(id);
  const TYPES = ["", "GM", "Volumoso", "Outro"];
  const COLORS = ["", "Amarelo", "Azul", "Vermelho", "Verde"];
  let mode = "todos", query = "", current = null;
  const modelDate = value => {
    const v = text(value);
    const a = v.match(/^(\d\d?)\/(\d\d?)\/(\d{4})$/), b = v.match(/^(\d{4})-(\d\d?)-(\d\d?)$/);
    if (!a && !b) return "";
    const day = +(a ? a[1] : b[3]), month = +(a ? a[2] : b[2]), year = +(a ? a[3] : b[1]);
    const d = new Date(Date.UTC(year,month-1,day));
    return d.getUTCDate() === day && d.getUTCMonth() === month-1 && d.getUTCFullYear() === year
      ? String(day).padStart(2,"0")+"/"+String(month).padStart(2,"0")+"/"+year : "";
  };
  function delimiterFor(input) {
    const line = text(input).split(/\r?\n/)[0] || "";
    return [";",",","\t"].sort((a,b)=>line.split(b).length-line.split(a).length)[0];
  }
  function parseRows(input, separator) {
    const source = String(input || "").replace(/^\uFEFF/,""), rows = [];
    let row = [], cell = "", quoted = false;
    for (let i=0;i<source.length;i++) {
      const c = source[i];
      if (quoted) {
        if (c === '"' && source[i+1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === separator) { row.push(text(cell)); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && source[i+1] === "\n") i++;
        row.push(text(cell));
        if (row.some(Boolean)) rows.push(row);
        row=[];cell="";
      } else cell += c;
    }
    if (quoted) throw new Error("Arquivo CSV com aspas não fechadas.");
    row.push(text(cell));
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function parsePhysicalCsv(raw, fileName) {
    if (!text(raw)) throw new Error("O CSV de IDs Físicos está vazio.");
    const rows = parseRows(raw, delimiterFor(raw));
    if (!rows.length) throw new Error("O CSV de IDs Físicos não contém registros.");
    const aliases = new Set(["id", "id pacote", "id do pacote", "id fisico", "ids fisicos", "shipment id", "shipment", "barcode", "codigo", "codigo de barras", "numero do pacote", "pacote", "quantidade encontrada", "ids encontrados"]);
    const header = rows[0].map(h => norm(h).replace(/[_-]+/g," ").replace(/\s+/g," "));
    let idCol = header.findIndex(h=>aliases.has(h));
    const typeCol = header.findIndex(h=>["tipo","categoria","classificacao","classificacao fisica"].includes(h));
    const colorCol = header.findIndex(h=>["cor","cor volumoso"].includes(h));
    const sideCol = header.findIndex(h=>["lado","lados","lado fisico","setor"].includes(h));
    const volumosoCol = header.findIndex(h=>h==="volumoso");
    const gmCol = header.findIndex(h=>h==="gm");
    const hasHeader = idCol >= 0 || typeCol >= 0 || colorCol >= 0 || sideCol >= 0 || volumosoCol >= 0 || gmCol >= 0 || header.some(h=>["rota","situacao","status","observacao"].includes(h));
    if (hasHeader && idCol < 0) throw new Error("CSV sem coluna de ID. Use 'Shipment ID', 'ID' ou 'ID Físico'.");
    if (idCol < 0) idCol = 0;
    const found = new Set(), details = {};
    let duplicates = 0, invalid = 0, blank = 0;
    for (const row of rows.slice(hasHeader ? 1 : 0)) {
      const id = idKey(row[idCol]);
      if (!id) { blank++; continue; }
      if (!/^[A-Z0-9._-]+$/.test(id) || id.length > 90) { invalid++; continue; }
      if (found.has(id)) { duplicates++; continue; }
      found.add(id);
      const rawType = norm(typeCol >= 0 ? row[typeCol] : "");
      const rawColor = norm(colorCol >= 0 ? row[colorCol] : "");
      const flagVolumoso = volumosoCol >= 0 && ["volumoso","sim","x","1","true"].includes(norm(row[volumosoCol]));
      const flagGM = gmCol >= 0 && ["gm","sim","x","1","true"].includes(norm(row[gmCol]));
      const tipo = flagVolumoso ? "Volumoso" : flagGM ? "GM" : rawType.includes("volum") ? "Volumoso" : rawType === "gm" ? "GM" : rawType ? "Outro" : "";
      const cor = COLORS.find(c=>c && norm(c)===rawColor) || "";
      const ladoFisico = sideCol >= 0 ? sideFromPhysical(row[sideCol]) : "";
      if (tipo || cor || ladoFisico) details[id] = { tipo, cor, ladoFisico };
    }
    if (!found.size) throw new Error("Nenhum Shipment ID válido foi encontrado no CSV de bipagem.");
    return { ids:[...found], details, duplicates, invalid, blank, fileName:text(fileName), importedAt:new Date().toISOString(), date:"" };
  }
  async function parsePhysicalFile(file) {
    if (window.AduanaXlsx?.isXlsx(file)) {
      const result = await window.AduanaXlsx.read(file);
      return parsePhysicalCsv(window.AduanaXlsx.toCsv(result), file.name);
    }
    if (!/\.csv$/i.test(file?.name || "")) throw new Error("Arquivo inválido. Selecione CSV ou XLSX.");
    return parsePhysicalCsv(await file.text(), file.name);
  }
  function sideFromPhysical(value) {
    const side = norm(value).replace(/\s+/g, " ");
    if (/\b(?:line hall|linha hall|lh)\b/.test(side)) return "LH";
    if (/\b(?:central b|lado b)\b/.test(side)) return "Lado B";
    if (/\b(?:central c|lado c)\b/.test(side)) return "Lado C";
    if (/\b(?:parede|lado d)\b/.test(side)) return "Lado D";
    if (/\b(?:heineken|lado a)\b/.test(side)) return "Lado A";
    return side ? "Não identificado" : "";
  }
  function sideLabel(label) {
    return { "Lado Central B":"Lado B", "Lado Central C":"Lado C", "Lado Parede":"Lado D", "Line Hall":"LH", "Lado Heineken":"Lado A" }[label] || "Não identificado";
  }
  function calculate(data, packageModel) {
    const date = modelDate(data && data.data), final = data && data.aduanaFechamentoFinal, physical = data && data.aduanaFisica;
    const systemReady = Boolean(final && packageModel && packageModel.useFinal && date && modelDate(final.date)===date);
    const physicalReady = Boolean(physical && date && modelDate(physical.date)===date && Array.isArray(physical.ids));
    const routesId = new Map(), routesName = new Map();
    if (systemReady) for (const group of packageModel.groups || []) for (const route of group.rows || []) {
      const loc = { side:sideLabel(group.label), doca:text(route.doca), rota:text(route.rota) };
      const id = text(route.idRota), name = text(route.rota).toUpperCase();
      if (id && !routesId.has(id)) routesId.set(id,loc);
      if (name && !routesName.has(name)) routesName.set(name,loc);
    }
    const systemIds = new Map(), crossSides = new Set();
    if (systemReady) for (const route of final.rows || []) {
      const loc = routesId.get(text(route.idRota)) || routesName.get(text(route.rota).toUpperCase()) ||
        { side:"Não identificado", doca:"", rota:text(route.rota) };
      for (const event of route.ocorrencias || []) {
        if (event.estado !== "aMais") continue;
        const id = idKey(event.shipmentId);
        if (!id) continue;
        if (!systemIds.has(id)) systemIds.set(id,{ id, ...loc, origem:"Sistema" });
        else if (systemIds.get(id).side !== loc.side) crossSides.add(id);
      }
    }
    const physicallyScanned = physicalReady ? new Set(physical.ids.map(idKey).filter(Boolean)) : new Set();
    const rows = [...systemIds.values()].map(r => ({
      ...r, situacao:physicalReady ? (physicallyScanned.has(r.id)?"Encontrado":"Não encontrado") : "Aguardando físico",
      tipo:text(physical && physical.details && physical.details[r.id] && physical.details[r.id].tipo),
      cor:text(physical && physical.details && physical.details[r.id] && physical.details[r.id].cor),
      ladoFisico:text(physical && physical.details && physical.details[r.id] && physical.details[r.id].ladoFisico)
    }));
    const found = rows.filter(r=>r.situacao==="Encontrado");
    const missing = rows.filter(r=>r.situacao==="Não encontrado");
    let onlyPhysical = 0;
    if (systemReady && physicalReady) for (const id of physicallyScanned) if (!systemIds.has(id)) {
      onlyPhysical++;
      rows.push({ id, origem:"Somente físico", side:"—", doca:"", rota:"", situacao:"Fora da lista",
        tipo:text(physical.details && physical.details[id] && physical.details[id].tipo),
        cor:text(physical.details && physical.details[id] && physical.details[id].cor),
        ladoFisico:text(physical.details && physical.details[id] && physical.details[id].ladoFisico) });
    }
    const sides = ["Lado B","Lado C","Lado D","LH","Lado A","Não identificado"].map(side=>({
      side, system:rows.filter(r=>r.origem==="Sistema" && r.side===side).length,
      found:found.filter(r=>r.side===side).length, missing:missing.filter(r=>r.side===side).length
    }));
    return {
      date, systemReady, physicalReady, rows, sides, physical, final, total:systemIds.size,
      totalFound:found.length,totalMissing:missing.length,totalPhysical:physicallyScanned.size,
      onlyPhysical,crossSides:crossSides.size,
      sideMismatches: found.filter(r=>r.ladoFisico && r.ladoFisico!=="Não identificado" && r.side!=="Não identificado" && r.side!==r.ladoFisico).length,
      countType:tipo=>found.filter(r=>r.tipo===tipo).length,
      countColor:cor=>found.filter(r=>r.cor===cor).length
    };
  }
  const styles = [
    ".aduana-view{display:none}",
    ".app.docas-mode.aduana-mode{width:100vw;max-width:none;min-width:0;min-height:0;height:100vh;height:100dvh;background:#edf3f8;border-radius:0}",
    "body.aduana-mode-active{width:100%;min-width:0;display:block;overflow:hidden}",
    ".app.aduana-mode > :is(.topbar,.toolbar,.stats,.legend,.wave-title,.dock-grid,.simple-docks-view,.routes-mode-view,.dashboard-view,.dados1-view,.footer-strip,.final-countdown-alert){display:none!important}",
    ".app.aduana-mode .side-rail{top:0;bottom:0;z-index:120;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}",
    ".app.aduana-mode .side-rail::-webkit-scrollbar{display:none}",
    ".app.aduana-mode .aduana-view{position:absolute;inset:0 0 0 var(--docas-rail-w,72px);z-index:110;display:block;overflow:auto;background:#eff3f6;color:#112e47;padding:clamp(12px,2vw,28px);font:500 14px/1.45 'Segoe UI',Arial,sans-serif}",
    ".aduana-shell{max-width:1500px;margin:0 auto}",
    ".aduana-top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:15px}",
    ".aduana-back,.aduana-btn,.aduana-filter{min-height:40px;padding:10px 14px;border-radius:8px;border:1px solid #a9bfd0;background:white;color:#083456;font-weight:800;cursor:pointer}",
    ".aduana-back:hover,.aduana-btn:hover,.aduana-filter:hover{background:#e6f1fa}",
    ".aduana-head{padding:16px;border-radius:12px;background:linear-gradient(100deg,#ffdc00,#ffc700);text-align:center;border:1px solid #ebc200}",
    ".aduana-head h2{margin:0;color:#141414;font-size:clamp(23px,3.2vw,43px);font-weight:950;letter-spacing:.035em;line-height:1.15}",
    ".aduana-head p{margin:5px 0 0;font-weight:750;color:#453b00}",
    ".aduana-note{margin:14px 0;padding:12px 14px;border-radius:9px;border:1px solid #c9d6e0;border-left:5px solid #ffcd00;background:white;color:#244561}",
    ".aduana-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:17px 0}",
    ".aduana-kpi{padding:15px 17px;background:#fff;border:1px solid #d2dce5;border-top:5px solid #ffcf00;border-radius:10px;min-width:0}",
    ".aduana-kpi strong{display:block;font-weight:950;font-size:clamp(29px,4vw,52px);line-height:1.2;margin:7px 0;color:#0b3859}",
    ".aduana-kpi span{font-weight:850}",
    ".aduana-kpi.encontrado{border-top-color:#19956d}.aduana-kpi.encontrado strong{color:#13805b}",
    ".aduana-kpi.nao-encontrado{border-top-color:#ce3b41}.aduana-kpi.nao-encontrado strong{color:#b92c36}",
    ".aduana-columns{display:grid;grid-template-columns:minmax(320px,1fr) minmax(300px,.75fr);gap:15px}",
    ".aduana-panel{background:#fff;border:1px solid #ccd7e1;border-radius:12px;overflow:hidden;min-width:0}",
    ".aduana-panel h3{margin:0;padding:12px 15px;background:#ffe585;color:#152b42;font-size:16px;font-weight:950}",
    ".aduana-table{width:100%;border-collapse:collapse}.aduana-table th{text-align:left;background:#fff4c7;font-size:12px;text-transform:uppercase}",
    ".aduana-table td,.aduana-table th{padding:10px 12px;border-bottom:1px solid #dce5eb}.aduana-table td:not(:first-child),.aduana-table th:not(:first-child){text-align:right;font-weight:850}",
    ".aduana-table tbody tr:nth-child(odd){background:#f1f3f5}",
    ".aduana-table .sub{padding-left:23px}",
    ".aduana-panel-inner{padding:14px}",
    ".aduana-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".aduana-filters input{flex:1 1 200px;min-width:120px;padding:10px;border:1px solid #a9bfd0;border-radius:8px}",
    ".aduana-filter.active,.aduana-btn.primary{background:#063354;color:white}",
    ".aduana-muted{font-size:12px;color:#65778b}",
    ".aduana-scroll{max-height:48vh;overflow:auto}",
    ".aduana-detail{width:100%;border-collapse:collapse;font-size:12px}",
    ".aduana-detail th{position:sticky;top:0;text-align:left;padding:11px 9px;background:#063354;color:white;z-index:2;white-space:nowrap}",
    ".aduana-detail td{border-bottom:1px solid #e1e8ee;padding:8px 9px}",
    ".aduana-detail tr:nth-child(even){background:#f3f7fa}",
    ".aduana-detail td:first-child{font-family:Consolas,monospace;font-weight:800;word-break:break-all}",
    ".aduana-detail select{max-width:125px;width:100%;padding:5px;border:1px solid #b5c5d1;border-radius:5px;background:#fff;color:#152c40}",
    ".aduana-tag{display:inline-block;padding:4px 8px;border-radius:30px;background:#e3ebf2;color:#324c62;font-weight:800;white-space:nowrap}",
    ".aduana-tag.ok{background:#daf5e8;color:#136946}.aduana-tag.fail{background:#ffe2e5;color:#a52633}.aduana-tag.warn{background:#fff1ce;color:#885816}",
    ".aduana-exports{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:13px;border-top:1px solid #dde7ed}",
    "body.dark-mode .app.aduana-mode .aduana-view{background:#152a3c;color:#edf3f8}",
    "body.dark-mode .aduana-panel,body.dark-mode .aduana-kpi,body.dark-mode .aduana-note{background:#1d374d;border-color:#3b5a74;color:#ebf2f8}",
    "body.dark-mode .aduana-table tbody tr:nth-child(odd),body.dark-mode .aduana-detail tr:nth-child(even){background:#27445a}",
    "body.dark-mode .aduana-kpi strong{color:#ffda00}",
    "@media(max-width:950px){.aduana-columns{grid-template-columns:1fr}}",
    "@media(max-width:550px){.aduana-kpis{grid-template-columns:1fr}.app.aduana-mode .aduana-view{padding:9px}.aduana-detail td,.aduana-detail th{padding:6px 5px}}"
  ].join("\n");
  function installStyles() {
    if ($("aduanaConferenciaStyle")) return;
    const style = document.createElement("style");
    style.id = "aduanaConferenciaStyle";
    style.textContent = styles;
    document.head.appendChild(style);
  }
  const formatValue = (n,ready) => ready ? String(n) : "—";
  function selector(kind,id,value,items) {
    return '<select aria-label="Classificação '+kind+' do ID '+esc(id)+'" data-aduana-kind="'+kind+'" data-aduana-id="'+esc(id)+'">'+
      items.map(item=>'<option value="'+esc(item)+'"'+(item===value?' selected':'')+'>'+esc(item||"—")+'</option>').join("")+'</select>';
  }
  function renderRows() {
    if (!current || !$("aduanaDetails")) return;
    const m = current;
    const visible = m.rows.filter(row=>{
      if (mode==="encontrados" && row.situacao!=="Encontrado") return false;
      if (mode==="faltantes" && row.situacao!=="Não encontrado") return false;
      if (mode==="extra" && row.origem!=="Somente físico") return false;
      return !query || [row.id,row.rota,row.side,row.ladoFisico,row.origem].some(value=>norm(value).includes(norm(query)));
    });
    $("aduanaRowsCount").textContent = visible.length+" registro(s)";
    $("aduanaDetails").innerHTML = visible.length ? visible.map(row=>{
      const editable = m.physicalReady && (row.situacao==="Encontrado" || row.origem==="Somente físico");
      const tag = row.situacao==="Encontrado" ? "ok" : row.situacao==="Não encontrado" ? "fail" : row.origem==="Somente físico" ? "warn" : "";
      return '<tr><td>'+esc(row.id)+'</td><td>'+esc(row.origem)+'</td><td>'+esc(row.side)+'</td><td>'+esc(row.ladoFisico || '—')+'</td><td>'+esc(row.rota)+'</td><td>'+esc(row.doca)+'</td>'+
        '<td><span class="aduana-tag '+tag+'">'+esc(row.situacao)+'</span></td><td>'+
        (editable?selector("tipo",row.id,row.tipo,TYPES):"—")+'</td><td>'+
        (editable?selector("cor",row.id,row.cor,COLORS):"—")+'</td></tr>';
    }).join("") : '<tr><td colspan="9" style="padding:24px;text-align:center">Nenhum registro para os filtros selecionados.</td></tr>';
  }
  function render(data, packageModel) {
    if (!$("aduanaView")) return;
    installStyles();
    const m = current = calculate(data,packageModel);
    const guidance = !m.systemReady
      ? "Importe o arquivo CSV ou XLSX <b>audited_shipments</b> no Editor de Dados e clique em <b>Aplicar</b>. A base do sistema considera somente os IDs AM1 no estado final <b>A mais</b>."
      : !m.physicalReady
      ? "Base do sistema carregada. Importe o segundo arquivo CSV ou XLSX <b>IDs Físicos</b> no Editor de Dados e clique em <b>Aplicar</b> para comparar os arquivos."
      : "Confronto realizado por <b>Shipment ID único</b>. A quantidade não encontrada corresponde aos IDs do sistema sem leitura física.";
    const sides = m.sides.filter(row=>!["Lado A","Não identificado"].includes(row.side)||row.system).map(row=>
      '<tr><td class="sub">– '+esc(row.side)+'</td><td>'+formatValue(row.system,m.systemReady)+'</td><td>'+formatValue(row.found,m.systemReady&&m.physicalReady)+'</td><td>'+formatValue(row.missing,m.systemReady&&m.physicalReady)+'</td></tr>').join("");
    const metrics = [["Volumoso",m.countType("Volumoso")],["Amarelo",m.countColor("Amarelo")],["Azul",m.countColor("Azul")],["Vermelho",m.countColor("Vermelho")],["Verde",m.countColor("Verde")],["GM",m.countType("GM")]].map(row=>
      '<tr><td>'+row[0]+'</td><td>'+formatValue(row[1],m.physicalReady&&m.systemReady)+'</td></tr>').join("");
    $("aduanaView").innerHTML =
      '<div class="aduana-shell"><div class="aduana-top"><button type="button" id="aduanaBack" class="aduana-back">← Voltar à tela inicial</button>'+
      '<span class="aduana-muted">SSP15 · AM1 · '+esc(m.date||"Data não informada")+'</span></div>'+
      '<header class="aduana-head"><h2>CONTROLE DE ADUANA</h2><p>Confronto entre Sistema e IDs Físicos</p></header>'+
      '<p class="aduana-note">'+guidance+'</p>'+
      '<section class="aduana-kpis">'+
      '<article class="aduana-kpi"><span>Quantidade a mais na aduana</span><strong>'+formatValue(m.total,m.systemReady)+'</strong><small>Sistema · Shipment IDs únicos</small></article>'+
      '<article class="aduana-kpi encontrado"><span>Quantidade encontrada</span><strong>'+formatValue(m.totalFound,m.systemReady&&m.physicalReady)+'</strong><small>Bipados fisicamente e presentes no sistema</small></article>'+
      '<article class="aduana-kpi nao-encontrado"><span>Quantidade não encontrada</span><strong>'+formatValue(m.totalMissing,m.systemReady&&m.physicalReady)+'</strong><small>IDs do sistema sem bipagem física</small></article></section>'+
      '<div class="aduana-columns"><section class="aduana-panel"><h3>CONTROLE POR LADO</h3><table class="aduana-table"><thead><tr><th>Item</th><th>Sistema</th><th>Encontrada</th><th>Não encontrada</th></tr></thead><tbody>'+sides+'</tbody></table></section>'+
      '<section class="aduana-panel"><h3>CLASSIFICAÇÃO DOS PACOTES ENCONTRADOS</h3><table class="aduana-table"><thead><tr><th>Item</th><th>Quantidade</th></tr></thead><tbody>'+metrics+'</tbody></table>'+
      '<div class="aduana-panel-inner aduana-muted">Os campos Tipo (GM/Volumoso), Cor (Amarelo/Azul/Vermelho/Verde) e Lado Físico podem vir do CSV/XLSX de bipagem. O Tipo e a Cor também podem ser ajustados abaixo.</div></section></div>'+
      '<p class="aduana-note"><b>Validação:</b> '+(m.physicalReady ? m.totalPhysical+' IDs físicos únicos, '+Number(m.physical.duplicates||0)+' duplicado(s) ignorado(s), '+m.onlyPhysical+' ID(s) bipado(s) sem correspondência no sistema.' : "Aguardando CSV da bipagem física.")+
      (m.crossSides ? ' <b>Atenção:</b> '+m.crossSides+' ID(s) aparecem em mais de um lado do sistema; conferir identificação de rota.' : "")+
      (m.sideMismatches ? ' <b>Atenção:</b> '+m.sideMismatches+' ID(s) com lado físico diferente do lado do sistema.' : "")+'</p>'+
      '<section class="aduana-panel"><h3>SHIPMENT IDs — SISTEMA × FÍSICO</h3><div class="aduana-panel-inner"><div class="aduana-filters">'+
      [['todos','Todos'],['encontrados','Encontrados'],['faltantes','Não encontrados'],['extra','Somente físico']].map(item=>
        '<button type="button" class="aduana-filter '+(mode===item[0]?'active':'')+'" data-aduana-mode="'+item[0]+'">'+item[1]+'</button>').join("")+
      '<input id="aduanaSearch" aria-label="Buscar Shipment ID, rota ou lado" placeholder="Buscar ID, rota ou lado..." type="search" value="'+esc(query)+'"></div>'+
      '<p class="aduana-muted" id="aduanaRowsCount"></p></div>'+
      '<div class="aduana-scroll"><table class="aduana-detail"><thead><tr><th>Shipment ID</th><th>Origem</th><th>Lado Sistema</th><th>Lado Físico</th><th>Rota</th><th>Doca</th><th>Conferência</th><th>Tipo</th><th>Cor</th></tr></thead><tbody id="aduanaDetails"></tbody></table></div>'+
      '<div class="aduana-exports"><button type="button" class="aduana-btn primary" data-aduana-export="confronto">Baixar confronto CSV</button>'+
      '<button type="button" class="aduana-btn" data-aduana-export="sistema">Baixar CSV Sistema</button>'+
      '<button type="button" class="aduana-btn" data-aduana-export="fisico">Baixar CSV IDs Físicos</button>'+
      '<a class="aduana-btn" href="'+SHEET_URL+'" target="_blank" rel="noopener noreferrer">Abrir planilha IDs Físicos ↗</a></div></section></div>';
    $("aduanaBack")?.addEventListener("click",()=>window.ControleAduana?.onBack?.());
    $("aduanaSearch")?.addEventListener("input",event=>{query=event.target.value;renderRows();});
    $("aduanaView").querySelectorAll("[data-aduana-mode]").forEach(button=>button.addEventListener("click",()=>{
      mode=button.dataset.aduanaMode;
      $("aduanaView").querySelectorAll("[data-aduana-mode]").forEach(other=>other.classList.toggle("active",other===button));
      renderRows();
    }));
    $("aduanaView").querySelectorAll("[data-aduana-export]").forEach(button=>button.addEventListener("click",()=>exportCsv(button.dataset.aduanaExport)));
    $("aduanaDetails")?.addEventListener("change",event=>{
      const select=event.target.closest("select[data-aduana-kind]");
      if (select) window.ControleAduana?.onClassify?.(select.dataset.aduanaId,select.dataset.aduanaKind,select.value);
    });
    renderRows();
  }
  function csvCell(value) {
    const raw=text(value), safe=/^[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
    return '"'+safe.replace(/"/g,'""')+'"';
  }
  function exportCsv(type) {
    if (!current || !current.systemReady) { alert("Importe e aplique o CSV do sistema primeiro."); return; }
    if (type!=="sistema" && !current.physicalReady) { alert("Importe e aplique o CSV de IDs Físicos antes de exportar."); return; }
    const m=current;
    let data, file;
    if (type==="sistema") {
      data=[["Shipment ID","Origem","Lado","Rota","Doca","Encontrado no físico"],...m.rows.filter(r=>r.origem==="Sistema").map(r=>[r.id,r.origem,r.side,r.rota,r.doca,m.physicalReady?(r.situacao==="Encontrado"?"SIM":"NÃO"):"PENDENTE"])];
      file="Sistema";
    } else if(type==="fisico") {
      data=[["Shipment ID","Origem","Encontrado no sistema","Lado Físico","Tipo","Cor"],...m.rows.filter(r=>r.origem==="Somente físico"||r.situacao==="Encontrado").map(r=>[r.id,"Físico",r.origem==="Sistema"?"SIM":"NÃO",r.ladoFisico,r.tipo,r.cor])];
      file="IDs_Fisicos";
    } else {
      data=[["Shipment ID","Origem","Lado Sistema","Lado Físico","Rota","Doca","Situação","Tipo","Cor"],...m.rows.map(r=>[r.id,r.origem,r.side,r.ladoFisico,r.rota,r.doca,r.situacao,r.tipo,r.cor])];
      file="Confronto_Aduana";
    }
    const content="\uFEFF"+data.map(row=>row.map(csvCell).join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");
    a.href=url;a.download=file+"_AM1_"+(m.date||"sem_data").replace(/\//g,"-")+".csv";
    document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.ControleAduana = { parsePhysicalCsv, parsePhysicalFile, render, onBack:null, onClassify:null };
})();