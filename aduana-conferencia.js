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
  function parsePhysicalRows(rows, fileName) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Arquivo de IDs Físicos vazio.");
    const alias = h => norm(h).replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
    const expected = new Set(["id","id pacote","id do pacote","id fisico","ids fisicos","shipment id","shipment","barcode","codigo","codigo de barras","numero do pacote","pacote","quantidade encontrada","ids encontrados"]);
    const headerIndex = rows.slice(0,15).findIndex(row=>Array.isArray(row) && row.some(cell=>expected.has(alias(cell))));
    const header=headerIndex>=0 ? (rows[headerIndex]||[]).map(alias) : [];
    const col=list=>header.findIndex(h=>list.includes(h));
    const idCol=col([...expected]);
    const sideCol=col(["lado","lados","lado fisico","setor","lado encontrado"]);
    const colorCol=col(["cor","cor volumoso"]);
    const typeCol=col(["tipo","categoria","classificacao","classificacao fisica"]);
    const volumosoCol=col(["volumoso"]);
    const gmCol=col(["gm"]);
    const hasHeader=headerIndex>=0;
    if(hasHeader && idCol<0)throw new Error("Arquivo físico sem coluna de Shipment ID.");
    const ids=new Set(),details=Object.create(null);
    let duplicates=0,invalid=0,blank=0;
    const dataRows=rows.slice(hasHeader?headerIndex+1:0);
    for (const row of dataRows) {
      if(!Array.isArray(row))continue;
      const id=idKey(row[idCol>=0?idCol:0]);
      if(!id){blank++;continue}
      if(!/^[A-Z0-9._-]+$/.test(id)||id.length>90){invalid++;continue}
      if(ids.has(id)){duplicates++;continue}
      ids.add(id);
      const tipoRaw=norm(typeCol>=0?row[typeCol]:"");
      const tipoVol=volumosoCol>=0&&["volumoso","sim","x","1","true"].includes(norm(row[volumosoCol]));
      const tipoGm=gmCol>=0&&["gm","sim","x","1","true"].includes(norm(row[gmCol]));
      const tipo=tipoVol?"Volumoso":tipoGm?"GM":tipoRaw.includes("volum")?"Volumoso":tipoRaw==="gm"?"GM":tipoRaw?"Outro":"";
      const corRaw=norm(colorCol>=0?row[colorCol]:"");
      const cor=COLORS.find(value=>value&&norm(value)===corRaw)||"";
      const ladoFisico=sideCol>=0?sideFromPhysical(row[sideCol]):"";
      // Sempre preserve objeto completo por ID, inclusive os campos ausentes.
      details[id]={tipo,cor,ladoFisico};
    }
    if(!ids.size)throw new Error("Nenhum Shipment ID válido foi encontrado no arquivo físico.");
    const sideCounts={"Lado A":0,"Lado B":0,"Lado C":0,"Lado D":0,"Lado E":0};
    const colorCounts={"Amarelo":0,"Azul":0,"Vermelho":0,"Verde":0};
    let unknownSides=0,unclassified=0;
    for(const id of ids) {
      const row=details[id];
      if(Object.prototype.hasOwnProperty.call(sideCounts,row.ladoFisico))sideCounts[row.ladoFisico]++;
      else unknownSides++;
      if(row.cor&&Object.prototype.hasOwnProperty.call(colorCounts,row.cor))colorCounts[row.cor]++;
      if(!row.tipo)unclassified++;
    }
    if(sideCol<0)throw new Error("O arquivo contém IDs, mas não a coluna Lados. Confira o cabeçalho da planilha física.");
    if(unknownSides===ids.size)throw new Error("Nenhum dos lados da planilha foi reconhecido. Aceitos: LADO CENTRAL B, LADO CENTRAL C, LADO PAREDE e LINE HALL.");
    return {
      ids:[...ids],details,duplicates,invalid,blank,
      sideCounts,colorCounts,unknownSides,unclassified,
      schemaVersion:3,fileName:text(fileName),importedAt:new Date().toISOString(),date:""
    };
  }
  function parsePhysicalCsv(raw,fileName) {
    if(!text(raw))throw new Error("O arquivo CSV de IDs Físicos está vazio.");
    return parsePhysicalRows(parseRows(raw,delimiterFor(raw)),fileName);
  }
  async function parsePhysicalFile(file) {
    if(window.AduanaXlsx?.isXlsx(file)) {
      const result=await window.AduanaXlsx.read(file);
      return parsePhysicalRows(result.rows,file.name);
    }
    if(!/\.csv$/i.test(file?.name||""))throw new Error("Arquivo inválido. Selecione CSV ou XLSX.");
    return parsePhysicalCsv(await file.text(),file.name);
  }
  // Setores do mesmo mapa do painel AM1; compatível com LH importado anteriormente.
  const SIDE_ZONES = [
    { side:"Lado A", label:"A (09–15) · HEINEKEN", begin:9, end:15 },
    { side:"Lado B", label:"B (16–30) · CENTRAL", begin:16, end:30 },
    { side:"Lado C", label:"C (31–56) · CENTRAL", begin:31, end:56 },
    { side:"Lado D", label:"D (57–71) · PAREDE", begin:57, end:71 },
    { side:"Lado E", label:"E (86–92) · LH", begin:86, end:92 }
  ];
  function sideFromDock(dock) {
    const raw=text(dock).match(/\d+/);
    if(!raw)return "";
    const number=Number(raw[0]);
    return SIDE_ZONES.find(z=>number>=z.begin&&number<=z.end)?.side||"";
  }
  function sideFromPhysical(value) {
    const side=norm(value).replace(/\s+/g, " ").trim();
    if(!side)return "";
    if (/\b(?:line hall|linha hall|lh|lado e|setor e)\b/.test(side) || side==="e") return "Lado E";
    if (/\b(?:central b|lado b|setor b)\b/.test(side) || side==="b") return "Lado B";
    if (/\b(?:central c|lado c|setor c)\b/.test(side) || side==="c") return "Lado C";
    if (/\b(?:parede|lado d|setor d)\b/.test(side) || side==="d") return "Lado D";
    if (/\b(?:heineken|lado a|setor a)\b/.test(side) || side==="a") return "Lado A";
    return "Não identificado";
  }
  function sideLabel(label) {
    const canonical = { "Lado Central B":"Lado B", "Lado Central C":"Lado C", "Lado Parede":"Lado D", "Line Hall":"Lado E", "Lado Heineken":"Lado A" }[label];
    return canonical || sideFromPhysical(label) || "Não identificado";
  }
  function sideDisplay(side) {
    return SIDE_ZONES.find(zone=>zone.side===side)?.label || side;
  }
  // Usa exatamente os mesmos nomes de chave de Editor de Dados > Responsáveis por lado.
  // Central B/C aceitam o cadastro legado somente quando não há cadastro específico.
  const COORDINATOR_ZONE_KEYS = {
    "Lado A": ["Lado Heineken"],
    "Lado B": ["Lado Central B", "Lado Central"],
    "Lado C": ["Lado Central C", "Lado Central"],
    "Lado D": ["Lado Parede"],
    "Lado E": ["Line Hall"]
  };
  function coordinatorForSide(data, side) {
    const staff = data && data.responsaveisPorLado || {};
    for (const key of COORDINATOR_ZONE_KEYS[side] || []) {
      if (Object.prototype.hasOwnProperty.call(staff,key)) {
        return text(staff[key] && staff[key].coordenador) || "Não informado";
      }
    }
    return "Não informado";
  }
  // Duas leituras distintas: saldo operacional (quantidade) e conciliação estrita (ID).
  // Não associar automaticamente o ID físico a uma rota do sistema quando não coincide.
  // Regra principal: só entra em qualquer contagem um ID físico que também
  // exista no relatório do sistema em ocorrência final "aMais".
  // Mesmo que a leitura tenha sido feita em outro lado, o ID é conciliado,
  // e a atribuição do fechamento por lado segue o lado do SISTEMA.
  function calculate(data, packageModel) {
    const date = modelDate(data && data.data);
    const final = data && data.aduanaFechamentoFinal;
    const physical = data && data.aduanaFisica;
    const systemReady = Boolean(final && packageModel && packageModel.useFinal && date && modelDate(final.date) === date);
    const physicalReady = Boolean(physical && date && modelDate(physical.date) === date && Array.isArray(physical.ids));
    const routesById = new Map(), routesByName = new Map();
    if (systemReady) {
      for (const group of packageModel.groups || []) {
        for (const route of group.rows || []) {
          const loc={side:sideFromDock(route.doca)||sideLabel(group.label),doca:text(route.doca),rota:text(route.rota)};
          const id=text(route.idRota),name=text(route.rota).toUpperCase();
          if(id&&!routesById.has(id))routesById.set(id,loc);
          if(name&&!routesByName.has(name))routesByName.set(name,loc);
        }
      }
    }
    const systemIds=new Map(),crossSides=new Set();
    if(systemReady)for(const route of final.rows || []){
      // Defesa extra contra dados antigos/importados antes do filtro do CSV.
      // Mesmo com o arquivo fisico contendo IDs de outras operações, a única
      // referência permitida é uma rota cujo nome termina exatamente em _AM1.
      const routeName=text(route.rota).toUpperCase();
      if(!routeName.endsWith("_AM1"))continue;
      const loc=routesById.get(text(route.idRota))||routesByName.get(routeName)||
        {side:sideFromDock(route.doca)||"Não identificado",doca:text(route.doca),rota:text(route.rota)};
      for(const event of route.ocorrencias || []){
        if(event.estado!=="aMais")continue;
        const id=idKey(event.shipmentId);
        if(!id)continue;
        if(!systemIds.has(id))systemIds.set(id,{id,...loc,origem:"Sistema"});
        else if(systemIds.get(id).side!==loc.side)crossSides.add(id);
      }
    }
    // Deduplicação: IDs físicos são lidos uma única vez, independentemente
    // do lado da planilha e de quantas linhas o arquivo contenha.
    const physicalIds=new Set(physicalReady ? physical.ids.map(idKey).filter(Boolean) : []);
    const details=physicalReady ? physical.details||{} : {};
    const matchedPhysical=[];
    const ignoredPhysicalIds=[];
    for(const id of physicalIds){
      const match=systemIds.get(id);
      if(!match){ignoredPhysicalIds.push(id);continue;}
      const d=details[id]||{};
      matchedPhysical.push({
        id,origem:"Físico",side:match.side,
        ladoFisico:sideFromPhysical(d.ladoFisico||d.lados||d.Lados||d.lado||d.side)||"Não identificado",
        rota:match.rota,doca:match.doca,tipo:text(d.tipo),cor:text(d.cor),
        situacao:"Encontrado",match:true
      });
    }
    const matchedIds=new Set(matchedPhysical.map(row=>row.id));
    const systemRows=[...systemIds.values()].map(row=>{
      const d=details[row.id]||{};
      const match=matchedIds.has(row.id);
      return {
        ...row,ladoFisico:match?sideFromPhysical(d.ladoFisico||d.lados||d.Lados||d.lado||d.side):"",
        tipo:match?text(d.tipo):"",cor:match?text(d.cor):"",
        situacao:match?"Encontrado":physicalReady?"Não encontrado":"Aguardando físico",
        match
      };
    });
    const systemUnmatched=systemRows.filter(row=>!row.match);
    // Detalhamento, filtros e exportações só incluem IDs pertencentes ao sistema.
    const rows=[...matchedPhysical,...systemUnmatched];
    const sideNames=[...SIDE_ZONES.map(zone=>zone.side),"Não identificado"];
    const total=systemIds.size;
    const totalFound=matchedPhysical.length;
    const totalMissing=physicalReady&&systemReady?total-totalFound:0;
    const physicalUnmapped=matchedPhysical.filter(row=>!sideNames.includes(row.ladoFisico)||row.ladoFisico==="Não identificado").length;
    // Falta de lado no CSV não impede confronto por ID: apenas sinaliza.
    const physicalNeedsReimport=physicalReady&&physicalUnmapped>0;
    const sides=sideNames.map(side=>{
      const system=systemRows.filter(row=>row.side===side).length;
      const found=matchedPhysical.filter(row=>row.side===side).length;
      return {
        side,system,found,
        missing:physicalReady&&systemReady?system-found:null,
        excess:0,balance:system-found,matched:found
      };
    });
    return {
      date,systemReady,physicalReady,rows,physicalRows:matchedPhysical,systemRows,sides,
      physical,final,total,totalFound,totalMissing,totalPhysical:totalFound,
      matchedCount:totalFound,
      unmatchedPhysical:0,unmatchedSystem:systemUnmatched.length,
      crossSides:crossSides.size,
      sideOverflow:[],grossMissing:physicalReady&&systemReady?totalMissing:null,grossExcess:0,
      physicalUnmapped,physicalNeedsReimport,
      ignoredPhysicalIds, // Apenas diagnóstico interno; nunca é contabilizado.
      onlyPhysical:0,
      sideMismatches:matchedPhysical.filter(row=>row.ladoFisico!=="Não identificado"&&row.ladoFisico!==row.side).length,
      countType:tipo=>matchedPhysical.filter(row=>row.tipo===tipo).length,
      countColor:cor=>matchedPhysical.filter(row=>row.cor===cor).length
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
    ".aduana-panel h3{margin:0;padding:12px 15px;background:#ffe585;color:#152b42;font-size:16px;font-weight:950;text-align:center}",
    ".aduana-table{width:100%;border-collapse:collapse}.aduana-table th{text-align:center;background:#fff4c7;font-size:12px;text-transform:uppercase;line-height:1.3;vertical-align:middle}",
    ".aduana-table td,.aduana-table th{padding:10px 9px;border-bottom:1px solid #dce5eb;text-align:center;vertical-align:middle;line-height:1.35}.aduana-table td:not(:first-child),.aduana-table th:not(:first-child){text-align:center;font-weight:850}",
    ".aduana-table tbody tr:nth-child(odd){background:#f1f3f5}",
    ".aduana-table .aduana-subtotal{background:#fff1bf;font-weight:800}",
    ".aduana-table .aduana-adjust{background:#f4f7fa;color:#9b4221;font-size:12px}",
    ".aduana-table .aduana-total{background:#ffe17a;color:#122c40;font-weight:950}",
    ".aduana-table .aduana-total td:nth-child(4){font-size:19px;color:#b62b34}",
    ".aduana-reconcile{display:grid;gap:7px;line-height:1.45;background:#fffdf2;border-top:1px solid #ead78b;color:#153e58}",
    ".aduana-reconcile strong{font-size:13px;color:#063354}",
    ".aduana-reconcile span{font-size:12px;font-weight:750}",
    ".aduana-reconcile small{font-size:11px;color:#637485}",
    "body.dark-mode .aduana-table .aduana-subtotal{background:#5c4b20;color:#fff4ce}",
    "body.dark-mode .aduana-table .aduana-adjust{background:#253c51;color:#ffc1ab}",
    "body.dark-mode .aduana-table .aduana-total{background:#e2b739;color:#14293c}",
    "body.dark-mode .aduana-reconcile{background:#1d374d;border-color:#826e3d;color:#f2e2b3}",
    "body.dark-mode .aduana-reconcile strong{color:#ffdf63}",
    ".aduana-table .sub{padding-left:9px;text-align:center}",
    ".aduana-side-label{font-weight:900;line-height:1.3;white-space:normal}",
    ".aduana-side-coordinator{display:block;margin-top:4px;font-size:11px;font-weight:750;line-height:1.25;color:#3b596c;overflow-wrap:anywhere}",
    ".aduana-side-coordinator b{font-weight:900;color:#073955}",
    "body.dark-mode .aduana-side-coordinator{color:#cfdeea}",
    "body.dark-mode .aduana-side-coordinator b{color:#ffda57}",
    ".aduana-panel-inner{padding:14px}",
    ".aduana-history-tools{margin-top:12px;border:1px solid #cbd9e4;background:white;border-radius:10px;padding:11px 14px}",
    ".aduana-history-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}",
    ".aduana-history-panel{border-top:1px solid #d9e4ec;margin-top:12px;padding-top:12px}",
    ".aduana-history-panel[hidden]{display:none!important}",
    ".aduana-history-search{display:flex;flex-wrap:wrap;gap:10px;align-items:end}",
    ".aduana-history-search label{font-size:12px;font-weight:850;display:grid;gap:5px}",
    ".aduana-history-search input,.aduana-history-search select{border:1px solid #a9bfd0;border-radius:6px;min-height:37px;padding:6px 9px;background:#fff;color:#153751}",
    ".aduana-history-summary{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0;padding:12px;background:#fff2c2;border-radius:7px;align-items:center}",
    ".aduana-history-summary strong{font-size:15px}",
    ".aduana-history-table{overflow:auto}",
    ".aduana-history-class{margin:10px 0}",
    ".aduana-history-ids{border-top:1px solid #d9e3ee;margin-top:14px;padding-top:12px}",
    ".aduana-history-ids h4{font-size:14px;font-weight:900;margin:0 0 10px}",
    ".aduana-history-ids select{padding:9px;border:1px solid #a9bfd0;border-radius:7px}",
    ".aduana-history-ids td:first-child{font-family:Consolas,monospace;font-size:12px;white-space:nowrap}",
    ".aduana-history-ids td{font-size:11px;overflow-wrap:anywhere}",
    "body.dark-mode .aduana-history-tools{background:#163246;color:#e5eef5;border-color:#34576d}",
    "body.dark-mode .aduana-history-summary{background:#494226;color:#fff}",
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
    ".aduana-importbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0 16px;background:#fff;padding:10px 12px;border:1px solid #d5dee8;border-radius:9px}",
    ".aduana-importbar label{display:inline-flex;align-items:center;justify-content:center;background:#063354;color:#fff;cursor:pointer}",
    ".aduana-importbar input{max-width:100%;font-size:12px}",
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
    const m=current;
    const visible=m.rows.filter(row=>{
      if(mode==="encontrados"&&row.origem!=="Físico")return false;
      if(mode==="faltantes"&&row.origem!=="Sistema")return false;
      return !query||[row.id,row.rota,row.side,row.ladoFisico,row.origem].some(value=>norm(value).includes(norm(query)));
    });
    $("aduanaRowsCount").textContent=visible.length+" registro(s) do sistema"+(mode==="faltantes"?" ainda não localizados por ID":"");
    $("aduanaDetails").innerHTML=visible.length?visible.map(row=>{
      const editable=m.physicalReady&&row.origem==="Físico";
      const tag=row.origem==="Físico"?(row.match?"ok":"warn"):"fail";
      return '<tr><td>'+esc(row.id)+'</td><td>'+esc(row.origem)+'</td><td>'+esc(row.side)+'</td><td>'+esc(row.ladoFisico||"—")+'</td><td>'+esc(row.rota)+'</td><td>'+esc(row.doca)+'</td>'+
        '<td><span class="aduana-tag '+tag+'">'+esc(row.situacao)+'</span></td><td>'+
        (editable?selector("tipo",row.id,row.tipo,TYPES):"—")+'</td><td>'+
        (editable?selector("cor",row.id,row.cor,COLORS):"—")+'</td></tr>';
    }).join(""):'<tr><td colspan="9" style="padding:24px;text-align:center">Nenhum registro para os filtros selecionados.</td></tr>';
  }
  // Snapshot compacto: não grava Shipment IDs, nomes de motoristas nem linhas brutas
  // em documentos históricos potencialmente acessíveis a leitores do painel.
  function historySnapshot(data, packageModel) {
    const m=calculate(data,packageModel);
    if(!m.systemReady||!m.physicalReady||!m.date)return null;
    const br=m.date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!br)return null;
    const iso=br[3]+"-"+br[2]+"-"+br[1];
    const sides=m.sides.filter(r=>r.side!=="Não identificado"||r.system||r.found).map(r=>({
      side:r.side,label:sideDisplay(r.side),coordinator:coordinatorForSide(data,r.side),
      system:r.system,found:r.found,missing:r.missing
    }));
    const classifications={
      volumoso:m.countType("Volumoso"),gm:m.countType("GM"),
      amarelo:m.countColor("Amarelo"),azul:m.countColor("Azul"),
      vermelho:m.countColor("Vermelho"),verde:m.countColor("Verde")
    };
    return {date:iso,dateBR:m.date,facility:"SSP15",operation:"AM1",
      totals:{system:m.total,found:m.totalFound,missing:m.totalMissing},
      sides,classifications,ignoredPhysical:m.ignoredPhysicalIds.length,
      validPhysicalCount:m.totalFound,version:1};
  }
  // Os IDs individuais são montados somente para a coleção privada do Firestore.
  // A versão agregada continua sem Shipment IDs e apta ao histórico geral.
  function historyIdsSnapshot(data, packageModel) {
    const base=historySnapshot(data,packageModel);
    if(!base)return null;
    const m=calculate(data,packageModel);
    const shipments=m.systemRows.map(row=>({
      id:String(row.id),
      status:row.match?"Encontrado":"Não encontrado",
      found:!!row.match,
      route:text(row.rota),dock:text(row.doca),
      systemSide:text(row.side),
      physicalSide:row.match?text(row.ladoFisico):"",
      type:row.match?text(row.tipo):"",
      color:row.match?text(row.cor):""
    }));
    // Os IDs que não estão no CSV do sistema e as rotas que não são AM1
    // nunca entram nesta lista.
    return {date:base.date,dateBR:base.dateBR,facility:"SSP15",operation:"AM1",
      totals:base.totals,shipments,version:2};
  }
  let historyOpen=false,historyRecord=null,historyRecords=null,historyPeriod="dia",historyStatus="",historyDate="";
  let historyIdSearch="",historyIdFilter="todos";
  let historyGlobalId="",historyGlobalResult=null,historyGlobalStatus="";
  let historyRangeIdSearch="",historyRangeIdFilter="todos",historyRangeIdPage=0;
  function historyNowIso() {
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return p.year+"-"+p.month+"-"+p.day;
  }
  function historyMinimumIso() {
    const day=historyNowIso();
    const d=new Date(day+"T12:00:00Z");
    d.setUTCDate(d.getUTCDate()-29);
    return d.toISOString().slice(0,10);
  }
  function historyGlobalMarkup() {
    if(!historyGlobalResult)return "";
    const {matches=[],daysWithRecords=0,start="",end="",id=""}=historyGlobalResult;
    const caption='<p class="aduana-muted">Periodo: '+esc(start)+' a '+esc(end)+
      ' · Dias com historico individual: '+Number(daysWithRecords)+
      ' · Ocorrencias do ID '+esc(id)+': <b>'+matches.length+'</b></p>';
    if(!matches.length)return caption+
      '<p class="aduana-muted">Nenhuma ocorrencia desse Shipment ID nas datas arquivadas do periodo. Dias sem historico nao podem ser verificados.</p>';
    const rows=matches.map(row=>{
      const parts=String(row.date||"").split("-");
      const dateBR=parts.length===3?parts[2]+"/"+parts[1]+"/"+parts[0]:row.date;
      return '<tr><td>'+esc(dateBR)+'</td><td>'+esc(row.id)+'</td><td>'+esc(row.status)+'</td>'+
        '<td>'+esc(row.route)+'</td><td>'+esc(row.dock)+'</td>'+
        '<td>'+esc(sideDisplay(row.systemSide))+'</td>'+
        '<td>'+esc(row.physicalSide?sideDisplay(row.physicalSide):"—")+'</td>'+
        '<td>'+esc(row.type||"—")+'</td><td>'+esc(row.color||"—")+'</td></tr>';
    }).join("");
    return caption+'<div class="aduana-history-table"><table class="aduana-table"><thead><tr>'+
      '<th>Data</th><th>Shipment ID</th><th>Situação</th><th>Rota AM1</th><th>Doca</th>'+
      '<th>Lado sistema</th><th>Lado físico</th><th>Tipo</th><th>Cor</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>';
  }
  // A consulta por periodo recebe resumos e IDs privados apenas em memoria.
  // Nenhum Shipment ID e incluido no documento de resumo publico.
  function historyPeriodIdEntries() {
    const all=(historyRecords||[]).flatMap(day=>
      (Array.isArray(day.shipments)?day.shipments:[]).map(row=>({...row,date:day.date}))
    ).sort((a,b)=>String(b.date).localeCompare(String(a.date))||
      String(a.route||"").localeCompare(String(b.route||""))||
      String(a.id||"").localeCompare(String(b.id||"")));
    const search=norm(historyRangeIdSearch);
    const filtered=all.filter(row=>{
      if(historyRangeIdFilter==="encontrados"&&!row.found)return false;
      if(historyRangeIdFilter==="faltantes"&&row.found)return false;
      return !search||[row.id,row.date,row.route,row.dock,row.systemSide,row.physicalSide,row.type,row.color]
        .some(value=>norm(value).includes(search));
    });
    return {all,filtered};
  }
  function historyPeriodIdsMarkup() {
    const records=historyRecords||[];
    if(!records.length)return "";
    const {all,filtered}=historyPeriodIdEntries();
    const availableDays=records.filter(r=>Array.isArray(r.shipments)).length;
    const missingDays=records.filter(r=>!Array.isArray(r.shipments));
    const statusNote=missingDays.length?
      '<p class="aduana-muted">'+missingDays.length+
      ' dia(s) arquivado(s) sem acesso ou sem dados individuais. '+
      esc(missingDays[0].idsStatus||"Verifique o histórico individual no Firebase.")+'</p>':"";
    if(!availableDays)return '<section class="aduana-history-ids"><h4>SHIPMENT IDs DO PERÍODO</h4>'+
      statusNote+'<p class="aduana-muted">Nenhum Shipment ID individual disponível nesta consulta.</p></section>';
    const unique=new Set(all.map(row=>String(row.id||""))).size;
    const pageSize=200;
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
    historyRangeIdPage=Math.min(Math.max(0,historyRangeIdPage),pages-1);
    const start=historyRangeIdPage*pageSize;
    const slice=filtered.slice(start,start+pageSize);
    const rows=slice.map(row=>{
      const p=String(row.date||"").split("-");
      const day=p.length===3?p[2]+"/"+p[1]+"/"+p[0]:row.date;
      return '<tr><td>'+esc(day)+'</td><td>'+esc(row.id)+'</td><td>'+esc(row.status)+'</td>'+
        '<td>'+esc(row.route)+'</td><td>'+esc(row.dock)+'</td>'+
        '<td>'+esc(sideDisplay(row.systemSide))+'</td>'+
        '<td>'+esc(row.physicalSide?sideDisplay(row.physicalSide):"—")+'</td>'+
        '<td>'+esc(row.type||"—")+'</td><td>'+esc(row.color||"—")+'</td></tr>';
    }).join("");
    return '<section class="aduana-history-ids"><h4>SHIPMENT IDs DO PERÍODO — '+all.length+' OCORRÊNCIAS</h4>'+
      '<p class="aduana-muted">'+unique+' Shipment ID(s) distinto(s) · '+availableDays+
      ' dia(s) com IDs individuais. O mesmo ID pode aparecer em datas diferentes.</p>'+statusNote+
      '<div class="aduana-filters"><select id="aduanaHistoryRangeIdFilter" aria-label="Filtrar situação dos IDs do período">'+
      [['todos','Todos'],['encontrados','Encontrados'],['faltantes','Não encontrados']].map(([value,label])=>
        '<option value="'+value+'"'+(historyRangeIdFilter===value?' selected':'')+'>'+label+'</option>').join("")+'</select>'+
      '<input id="aduanaHistoryRangeIdSearch" type="search" aria-label="Pesquisar IDs do período" '+
      'placeholder="Buscar Shipment ID, rota, doca ou lado..." value="'+esc(historyRangeIdSearch)+'">'+
      '<button type="button" class="aduana-btn" id="aduanaHistoryRangeExport">Exportar IDs do período CSV</button></div>'+
      '<p class="aduana-muted">'+filtered.length+' ocorrência(s) no filtro · mostrando '+(filtered.length?start+1:0)+
      '–'+Math.min(start+pageSize,filtered.length)+' · página '+(historyRangeIdPage+1)+' de '+pages+'</p>'+
      '<div class="aduana-history-table"><table class="aduana-table"><thead><tr>'+
      '<th>Data</th><th>Shipment ID</th><th>Situação</th><th>Rota AM1</th><th>Doca</th>'+
      '<th>Lado sistema</th><th>Lado físico</th><th>Tipo</th><th>Cor</th></tr></thead>'+
      '<tbody>'+(rows||'<tr><td colspan="9">Nenhum ID corresponde ao filtro.</td></tr>')+'</tbody></table></div>'+
      '<div class="aduana-history-actions" style="margin-top:10px">'+
      '<button type="button" class="aduana-btn" id="aduanaHistoryRangePrev"'+
      (historyRangeIdPage===0?' disabled':'')+'>Página anterior</button>'+
      '<button type="button" class="aduana-btn" id="aduanaHistoryRangeNext"'+
      (historyRangeIdPage>=pages-1?' disabled':'')+'>Próxima página</button></div></section>';
  }
  function updateHistoryPeriodIdsOnly() {
    const wrapper=$("aduanaHistoryPeriodIdsContainer");
    if(!wrapper)return;
    const active=document.activeElement;
    const focused=active?.id==="aduanaHistoryRangeIdSearch";
    const position=focused?active.selectionStart:null;
    wrapper.innerHTML=historyPeriodIdsMarkup();
    bindHistoryPeriodIdEvents();
    if(focused){
      const field=$("aduanaHistoryRangeIdSearch");
      field?.focus();
      if(field&&position!==null)field.setSelectionRange(position,position);
    }
  }
  function exportHistoryPeriodIdsCsv() {
    const {filtered}=historyPeriodIdEntries();
    if(!filtered.length)return;
    const header=["Data","Shipment ID","Situação","Rota AM1","Doca","Lado Sistema","Lado Físico","Tipo","Cor"];
    const cell=value=>'"'+String(value??"").replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"';
    const rows=[header,...filtered.map(row=>[
      row.date,row.id,row.status,row.route,row.dock,row.systemSide,row.physicalSide,row.type,row.color
    ])].map(row=>row.map(cell).join(";")).join("\r\n");
    const blob=new Blob(["\uFEFF"+rows],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="Historico_Aduana_Ids_AM1_"+(historyPeriod==="semana"?"7dias":"30dias")+".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function bindHistoryPeriodIdEvents(){
    $("aduanaHistoryRangeIdSearch")?.addEventListener("input",event=>{
      historyRangeIdSearch=event.target.value;
      historyRangeIdPage=0;
      updateHistoryPeriodIdsOnly();
    });
    $("aduanaHistoryRangeIdFilter")?.addEventListener("change",event=>{
      historyRangeIdFilter=event.target.value;
      historyRangeIdPage=0;
      updateHistoryPeriodIdsOnly();
    });
    $("aduanaHistoryRangePrev")?.addEventListener("click",()=>{
      historyRangeIdPage--;
      updateHistoryPeriodIdsOnly();
    });
    $("aduanaHistoryRangeNext")?.addEventListener("click",()=>{
      historyRangeIdPage++;
      updateHistoryPeriodIdsOnly();
    });
    $("aduanaHistoryRangeExport")?.addEventListener("click",exportHistoryPeriodIdsCsv);
  }
  function historyPeriodSummary() {
    const records=historyRecords||[];
    const header=historyPeriod==="semana"?"7 dias até "+historyDate:"Últimos 30 dias";
    if(!records.length)return '<p class="aduana-muted">Nenhum fechamento salvo encontrado no período. Dias sem registro não foram contabilizados.</p>';
    const totals={system:0,found:0,missing:0};
    const sides=new Map(),cls={};
    const byDate=records.map(r=>{
      for(const field of ["system","found","missing"])totals[field]+=Number(r.totals?.[field]||0);
      for(const side of r.sides||[]){
        const old=sides.get(side.side)||{label:side.label||side.side,system:0,found:0,missing:0};
        for(const field of ["system","found","missing"])old[field]+=Number(side[field]||0);
        sides.set(side.side,old);
      }
      for(const [name,val] of Object.entries(r.classifications||{}))cls[name]=(cls[name]||0)+Number(val||0);
      return '<tr><td>'+esc(r.dateBR||r.date)+'</td><td>'+Number(r.totals?.system||0)+'</td>'+
        '<td>'+Number(r.totals?.found||0)+'</td><td>'+Number(r.totals?.missing||0)+'</td></tr>';
    }).join("");
    const classificationText=[["Volumoso","volumoso"],["GM","gm"],["Amarelo","amarelo"],["Azul","azul"],["Vermelho","vermelho"],["Verde","verde"]]
      .map(([name,key])=>name+": "+(cls[key]||0)).join(" · ");
    const sideRows=[...sides.values()].map(r=>'<tr><td>'+esc(r.label)+'</td><td>'+r.system+'</td><td>'+r.found+'</td><td>'+r.missing+'</td></tr>').join("");
    return '<div class="aduana-history-summary"><strong>'+esc(header)+'</strong>'+
      '<span>Operações arquivadas: <b>'+records.length+'</b></span>'+
      '<span>Sistema: <b>'+totals.system+'</b></span>'+
      '<span>Encontrados: <b>'+totals.found+'</b></span>'+
      '<span>Não encontrados: <b>'+totals.missing+'</b></span></div>'+
      '<div class="aduana-history-table"><table class="aduana-table"><thead><tr><th>Data</th><th>Sistema</th><th>Encontrados</th><th>Não encontrados</th></tr></thead><tbody>'+byDate+'</tbody></table></div>'+
      '<div id="aduanaHistoryPeriodIdsContainer">'+historyPeriodIdsMarkup()+'</div>'+
      '<h4>Consolidado por setor</h4>'+
      '<div class="aduana-history-table"><table class="aduana-table"><thead><tr><th>Setor</th><th>Sistema</th><th>Encontrados</th><th>Não encontrados</th></tr></thead><tbody>'+sideRows+'</tbody></table></div>'+
      '<p class="aduana-history-class"><b>Classificações:</b> '+esc(classificationText)+'</p>'+
      '<p class="aduana-muted">Somatório das operações com histórico disponível, não de IDs únicos entre datas. Dias sem registro não entram no somatório.</p>';
  }
  function historyIdsMarkup(record) {
    if(!Array.isArray(record.shipments))return '<p class="aduana-muted">'+esc(record.idsStatus||"Não há Shipment IDs individuais arquivados para esta data.")+'</p>';
    const valid=record.shipments;
    const visible=valid.filter(row=>{
      if(historyIdFilter==="encontrados"&&!row.found)return false;
      if(historyIdFilter==="faltantes"&&row.found)return false;
      const term=norm(historyIdSearch);
      return !term||[row.id,row.route,row.dock,row.systemSide,row.physicalSide].some(val=>norm(val).includes(term));
    });
    const rows=visible.slice(0,250).map(row=>
      '<tr><td>'+esc(row.id)+'</td><td>'+esc(row.status)+'</td><td>'+esc(row.route)+'</td>'+
      '<td>'+esc(row.dock)+'</td><td>'+esc(sideDisplay(row.systemSide))+'</td>'+
      '<td>'+esc(row.physicalSide?sideDisplay(row.physicalSide):"—")+'</td>'+
      '<td>'+esc(row.type||"—")+'</td><td>'+esc(row.color||"—")+'</td></tr>').join("");
    return '<section class="aduana-history-ids"><h4>SHIPMENT IDs DO DIA — '+valid.length+' REGISTROS</h4>'+
      '<div class="aduana-filters">'+
      '<select id="aduanaHistoryIdFilter" aria-label="Filtrar situação dos Shipment IDs">'+
      [['todos','Todos'],['encontrados','Encontrados'],['faltantes','Não encontrados']].map(([value,label])=>
        '<option value="'+value+'"'+(historyIdFilter===value?' selected':'')+'>'+label+'</option>').join("")+'</select>'+
      '<input id="aduanaHistoryIdSearch" type="search" aria-label="Buscar Shipment ID histórico" placeholder="Buscar ID, rota ou lado..." value="'+esc(historyIdSearch)+'">'+
      '<button type="button" class="aduana-btn" id="aduanaHistoryExportIds">Exportar IDs CSV</button></div>'+
      '<p class="aduana-muted">'+visible.length+' ID(s) no filtro'+(visible.length>250?' · mostrando os primeiros 250; utilize a pesquisa ou exporte o CSV':'')+'</p>'+
      '<div class="aduana-history-table"><table class="aduana-table"><thead><tr><th>Shipment ID</th><th>Situação</th><th>Rota AM1</th><th>Doca</th><th>Lado sistema</th><th>Lado físico</th><th>Tipo</th><th>Cor</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="8">Nenhum ID corresponde ao filtro.</td></tr>')+'</tbody></table></div></section>';
  }
  function downloadHistoryIdsCsv() {
    if(!historyRecord||!Array.isArray(historyRecord.shipments))return;
    const header=["Shipment ID","Situação","Rota","Doca","Lado Sistema","Lado Físico","Tipo","Cor"];
    const escapeCsv=value=>'"'+String(value??"").replace(/^[=+\-@\t\r]/,"'").replace(/"/g,'""')+'"';
    const lines=[header,...historyRecord.shipments.map(row=>[
      row.id,row.status,row.route,row.dock,row.systemSide,row.physicalSide,row.type,row.color
    ])].map(row=>row.map(escapeCsv).join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF"+lines],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");
    link.href=url;link.download="Historico_Aduana_Ids_AM1_"+historyRecord.date+".csv";
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function bindHistoryIdEvents() {
    $("aduanaHistoryIdSearch")?.addEventListener("input",event=>{
      historyIdSearch=event.target.value;
      updateHistoryIdsOnly();
    });
    $("aduanaHistoryIdFilter")?.addEventListener("change",event=>{
      historyIdFilter=event.target.value;
      updateHistoryIdsOnly();
    });
    $("aduanaHistoryExportIds")?.addEventListener("click",downloadHistoryIdsCsv);
  }
  function updateHistoryIdsOnly(){
    const wrapper=$("aduanaHistoryIdsContainer");
    if(!wrapper)return;
    const focused=document.activeElement?.id==="aduanaHistoryIdSearch";
    const selection=focused?document.activeElement.selectionStart:null;
    wrapper.innerHTML=historyIdsMarkup(historyRecord);
    bindHistoryIdEvents();
    if(focused){
      const field=$("aduanaHistoryIdSearch");
      field?.focus();
      if(field&&selection!==null)field.setSelectionRange(selection,selection);
    }
  }
  function renderHistoryRecord() {
    const container=$("aduanaHistoryResult");
    if(!container)return;
    if(historyRecords!==null){container.innerHTML=historyPeriodSummary();bindHistoryPeriodIdEvents();return;}
    if(!historyRecord){container.innerHTML='<p class="aduana-muted">Selecione uma data ou período e clique em Consultar.</p>';return;}
    const r=historyRecord;
    const sideRows=(Array.isArray(r.sides)?r.sides:[]).map(item=>
      '<tr><td>'+esc(item.label||item.side)+'</td><td>'+esc(item.coordinator||"Não informado")+'</td>'+
      '<td>'+Number(item.system||0)+'</td><td>'+Number(item.found||0)+'</td><td>'+Number(item.missing||0)+'</td></tr>').join("");
    const cls=r.classifications||{};
    const clstext=[["Volumoso",cls.volumoso],["GM",cls.gm],["Amarelo",cls.amarelo],["Azul",cls.azul],["Vermelho",cls.vermelho],["Verde",cls.verde]].map(([label,value])=>label+": "+Number(value||0)).join(" · ");
    container.innerHTML='<div class="aduana-history-summary"><strong>'+esc(r.dateBR||r.date||"")+'</strong>'+
      '<span>Sistema: <b>'+Number(r.totals?.system||0)+'</b></span>'+
      '<span>Encontrados: <b>'+Number(r.totals?.found||0)+'</b></span>'+
      '<span>Não encontrados: <b>'+Number(r.totals?.missing||0)+'</b></span></div>'+
      '<div class="aduana-history-table"><table class="aduana-table"><thead><tr><th>Setor</th><th>Coordenador</th><th>Sistema</th><th>Encontrados</th><th>Não encontrados</th></tr></thead>'+
      '<tbody>'+sideRows+'</tbody></table></div>'+
      '<p class="aduana-history-class"><b>Classificação:</b> '+esc(clstext)+'</p>'+
      '<div id="aduanaHistoryIdsContainer">'+historyIdsMarkup(r)+'</div>'+
      '<p class="aduana-muted">Registro arquivado: '+esc(r.savedAt||"")+'</p>';
    bindHistoryIdEvents();
  }
  function updateHistoryStatus(message) {
    historyStatus=message;
    const el=$("aduanaHistoryStatus");
    if(el)el.textContent=historyStatus;
  }
  function render(data, packageModel) {
    if (!$("aduanaView")) return;
    installStyles();
    const m = current = calculate(data,packageModel);
    const guidance = !m.systemReady
      ? "Importe e aplique o CSV ou XLSX <b>audited_shipments</b> do sistema. Sem essa base, nenhuma bipagem física será contabilizada."
      : !m.physicalReady
      ? "Base do sistema carregada. Importe o CSV ou XLSX de <b>IDs Físicos</b> para identificar os pacotes localizados."
      : "<b>Conferência por ID:</b> somente IDs existentes no relatório do sistema entram nas contagens. IDs físicos que não pertencem ao sistema são desconsiderados, sem afetar lados, cores, tipos ou exportações. O lado do sistema determina a distribuição do fechamento.";
    const sides = m.sides.filter(row=>row.side!=="Não identificado"||row.system||row.found).map(row=>
      '<tr><td class="sub"><div class="aduana-side-label">'+esc(sideDisplay(row.side))+'</div>'+
      (row.side==="Não identificado" ? '' : '<div class="aduana-side-coordinator"><b>Coordenador:</b> '+esc(coordinatorForSide(data,row.side))+'</div>')+
      '</td><td>'+formatValue(row.system,m.systemReady)+'</td><td>'+formatValue(row.found,m.systemReady&&m.physicalReady)+'</td><td>'+formatValue(row.missing,m.systemReady&&m.physicalReady)+'</td></tr>').join("");
    const metrics = [["Volumoso",m.countType("Volumoso")],["Amarelo",m.countColor("Amarelo")],["Azul",m.countColor("Azul")],["Vermelho",m.countColor("Vermelho")],["Verde",m.countColor("Verde")],["GM",m.countType("GM")]].map(row=>
      '<tr><td>'+esc(row[0])+'</td><td>'+formatValue(row[1],m.physicalReady&&m.systemReady)+'</td><td title="IDs não localizados não possuem classificação física confirmada">—</td></tr>').join("")+
      '<tr><td><b>Sem classificação (saldo pendente)</b></td><td>—</td><td>'+formatValue(m.totalMissing,m.systemReady&&m.physicalReady)+'</td></tr>';
    $("aduanaView").innerHTML =
      '<div class="aduana-shell"><div class="aduana-top"><button type="button" id="aduanaBack" class="aduana-back">← Voltar à tela inicial</button>'+
      '<span class="aduana-muted">SSP15 · AM1 · '+esc(m.date||"Data não informada")+'</span></div>'+
      '<header class="aduana-head"><h2>CONTROLE DE ADUANA</h2><p>Confronto entre Sistema e IDs Físicos</p></header>'+
      '<section class="aduana-history-tools"><div class="aduana-history-actions">'+
      '<button type="button" class="aduana-btn primary" id="aduanaHistorySave">Salvar fechamento no histórico</button>'+
      '<button type="button" class="aduana-btn" id="aduanaHistoryToggle" aria-expanded="'+(historyOpen?'true':'false')+'">'+(historyOpen?'Ocultar histórico':'Consultar histórico · 30 dias')+'</button>'+
      '</div><div class="aduana-history-panel" id="aduanaHistoryPanel"'+(historyOpen?'':' hidden')+'>'+
      '<div class="aduana-history-search"><label>Período<select id="aduanaHistoryPeriod">'+
      [['dia','Dia específico'],['semana','7 dias até a data escolhida'],['mes','Últimos 30 dias']].map(([value,label])=>
        '<option value="'+value+'"'+(historyPeriod===value?' selected':'')+'>'+label+'</option>').join("")+
      '</select></label>'+
      '<label id="aduanaHistoryDateLabel">Data de referência<input type="date" id="aduanaHistoryDate" min="'+historyMinimumIso()+'" max="'+historyNowIso()+'" value="'+esc(historyDate||historyNowIso())+'"></label>'+
      '<button type="button" class="aduana-btn primary" id="aduanaHistoryFind">Consultar</button></div>'+
      '<section class="aduana-history-ids"><h4>LOCALIZAR SHIPMENT ID — ÚLTIMOS 30 DIAS</h4>'+
      '<div class="aduana-filters"><input type="search" inputmode="numeric" maxlength="80" id="aduanaHistoryGlobalId" '+
      'aria-label="Shipment ID exato para consultar os últimos 30 dias" placeholder="Digite o Shipment ID exato..." value="'+esc(historyGlobalId)+'">'+
      '<button type="button" class="aduana-btn primary" id="aduanaHistoryGlobalFind">Buscar ID em 30 dias</button></div>'+
      '<p class="aduana-muted" id="aduanaHistoryGlobalStatus" role="status">'+esc(historyGlobalStatus)+'</p>'+
      '<div id="aduanaHistoryGlobalResult">'+historyGlobalMarkup()+'</div></section>'+
      '<p class="aduana-muted" id="aduanaHistoryStatus" role="status">'+esc(historyStatus)+'</p>'+
      '<div id="aduanaHistoryResult"></div>'+
      '<small class="aduana-muted">Consulta por data ou pesquisa exata entre os dias arquivados dos últimos 30 dias. Somente administradores têm acesso aos Shipment IDs.</small>'+
      '</div></section>'+
      '<p class="aduana-note">'+guidance+'</p>'+
      '<div class="aduana-importbar"><label class="aduana-btn" for="aduanaReimportFile">Atualizar planilha IDs Físicos</label>'+
      '<input id="aduanaReimportFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Atualizar IDs físicos por CSV ou Excel">'+
      '<span id="aduanaReimportStatus" class="aduana-muted" role="status">'+(m.physicalReady
        ? esc(m.physical.fileName||"Arquivo físico importado")+' · '+formatValue(m.totalFound,m.systemReady)+' ID(s) válidos (presentes no sistema)'+
          (m.systemReady ? ' · A '+m.sides.find(x=>x.side==="Lado A").found+' · B '+m.sides.find(x=>x.side==="Lado B").found+' · C '+m.sides.find(x=>x.side==="Lado C").found+' · D '+m.sides.find(x=>x.side==="Lado D").found+' · E/LH '+m.sides.find(x=>x.side==="Lado E").found : '')
        : 'Importe o arquivo físico CSV ou XLSX')+'</span></div>'+
      '<section class="aduana-kpis">'+
      '<article class="aduana-kpi"><span>Quantidade a mais na aduana</span><strong>'+formatValue(m.total,m.systemReady)+'</strong><small>Sistema · Shipment IDs únicos</small></article>'+
      '<article class="aduana-kpi encontrado"><span>Quantidade encontrada</span><strong>'+formatValue(m.totalFound,m.systemReady&&m.physicalReady)+'</strong><small>IDs únicos presentes no sistema e no físico</small></article>'+
      '<article class="aduana-kpi nao-encontrado"><span>Quantidade não encontrada</span><strong>'+formatValue(m.totalMissing,m.systemReady&&m.physicalReady)+'</strong><small>IDs do sistema não localizados no arquivo físico</small></article></section>'+
      '<div class="aduana-columns"><section class="aduana-panel"><h3>CONTROLE POR LADO</h3><table class="aduana-table"><thead><tr><th>Item</th><th>Sistema</th><th>Físico encontrado</th><th>Não encontrado</th></tr></thead><tbody>'+sides+
      '<tr class="aduana-total"><td><strong>TOTAL</strong></td><td>'+formatValue(m.total,m.systemReady)+'</td><td>'+formatValue(m.totalFound,m.systemReady&&m.physicalReady)+'</td><td>'+formatValue(m.totalMissing,m.systemReady&&m.physicalReady)+'</td></tr></tbody></table>'+
      '<div class="aduana-panel-inner aduana-reconcile">'+(m.systemReady&&m.physicalReady
        ? '<strong>Conciliação por ID: '+m.total+' no sistema = '+m.totalFound+' encontrados + '+m.totalMissing+' não encontrados.</strong>'
        : '<span>Importe as bases do sistema e físico para iniciar o confronto por ID.</span>')+
      '<small>Os pacotes físicos fora da lista do sistema são ignorados em todas as contagens. Se um ID válido estiver em outro lado físico, ele será contabilizado no lado atribuído pelo sistema.</small></div></section>'+
      '<section class="aduana-panel"><h3>CLASSIFICAÇÃO DOS PACOTES</h3><table class="aduana-table"><thead><tr><th>Item</th><th>Encontrada</th><th>Não encontrada</th></tr></thead><tbody>'+metrics+'</tbody></table>'+
      '<div class="aduana-panel-inner aduana-muted">Somente os IDs físicos presentes no sistema são classificados por tipo e cor. Os IDs ignorados não entram nessas quantidades. Pacotes não encontrados ficam sem classificação física.</div></section></div>'+
      '<p class="aduana-note"><b>Critério obrigatório:</b> apenas Shipment IDs presentes no arquivo do sistema são contabilizados. IDs extras bipados no físico são descartados das estatísticas, do detalhamento e dos arquivos exportados.'+
      (m.sideMismatches?' <b>Atenção:</b> '+m.sideMismatches+' ID(s) válido(s) com lado físico diferente do lado do sistema; a contagem foi atribuída ao lado do sistema.':'')+
      (m.crossSides?' <b>Atenção:</b> '+m.crossSides+' ID(s) repetido(s) em lados diferentes na base do sistema; contabilizado(s) uma única vez.':'')+'</p>'+
      '<section class="aduana-panel"><h3>AUDITORIA POR ID — SISTEMA × FÍSICO</h3><div class="aduana-panel-inner"><div class="aduana-filters">'+
      [['todos','Todos'],['encontrados','Encontrados no sistema'],['faltantes','Não encontrados']].map(item=>
        '<button type="button" class="aduana-filter '+(mode===item[0]?'active':'')+'" data-aduana-mode="'+item[0]+'">'+item[1]+'</button>').join("")+
      '<input id="aduanaSearch" aria-label="Buscar Shipment ID, rota ou lado" placeholder="Buscar ID, rota ou lado..." type="search" value="'+esc(query)+'"></div>'+
      '<p class="aduana-muted" id="aduanaRowsCount"></p></div>'+
      '<div class="aduana-scroll"><table class="aduana-detail"><thead><tr><th>Shipment ID</th><th>Origem</th><th>Lado Sistema</th><th>Lado Físico</th><th>Rota</th><th>Doca</th><th>Conferência</th><th>Tipo</th><th>Cor</th></tr></thead><tbody id="aduanaDetails"></tbody></table></div>'+
      '<div class="aduana-exports"><button type="button" class="aduana-btn primary" data-aduana-export="confronto">Baixar confronto CSV</button>'+
      '<button type="button" class="aduana-btn" data-aduana-export="sistema">Baixar CSV Sistema</button>'+
      '<button type="button" class="aduana-btn" data-aduana-export="fisico">Baixar CSV IDs Físicos</button>'+
      '<a class="aduana-btn" href="'+SHEET_URL+'" target="_blank" rel="noopener noreferrer">Abrir planilha IDs Físicos ↗</a></div></section></div>';
    $("aduanaBack")?.addEventListener("click",()=>window.ControleAduana?.onBack?.());
    $("aduanaHistoryToggle")?.addEventListener("click",()=>{
      historyOpen=!historyOpen;
      const panel=$("aduanaHistoryPanel");
      if(panel)panel.hidden=!historyOpen;
      const button=$("aduanaHistoryToggle");
      if(button){button.textContent=historyOpen?"Ocultar histórico":"Consultar histórico · 30 dias";button.setAttribute("aria-expanded",String(historyOpen));}
      if(historyOpen)renderHistoryRecord();
    });
    $("aduanaHistorySave")?.addEventListener("click",async()=>{
      const btn=$("aduanaHistorySave");if(btn)btn.disabled=true;
      updateHistoryStatus("Salvando fechamento no Firebase...");
      try {
        const saved=await window.ControleAduana?.onSaveHistory?.();
        if(!saved)throw new Error("Firebase indisponível ou sem permissão de gravação.");
        historyRecord=saved;historyRecords=null;historyPeriod="dia";historyDate=saved.date;historyOpen=true;
        const panel=$("aduanaHistoryPanel");if(panel)panel.hidden=false;
        const toggle=$("aduanaHistoryToggle");
        if(toggle){toggle.textContent="Ocultar histórico";toggle.setAttribute("aria-expanded","true");}
        const input=$("aduanaHistoryDate");if(input)input.value=historyDate;
        const period=$("aduanaHistoryPeriod");if(period)period.value="dia";
        const label=$("aduanaHistoryDateLabel");if(label)label.hidden=false;
        renderHistoryRecord();
        updateHistoryStatus("Fechamento arquivado com sucesso no Firebase.");
      } catch(err){updateHistoryStatus("Não foi possível salvar: "+(err?.message||String(err)));}
      finally{if(btn)btn.disabled=false;}
    });
    $("aduanaHistoryGlobalId")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){event.preventDefault();$("aduanaHistoryGlobalFind")?.click();}
    });
    $("aduanaHistoryGlobalFind")?.addEventListener("click",async()=>{
      const input=$("aduanaHistoryGlobalId");
      historyGlobalId=String(input?.value||"").trim();
      historyGlobalResult=null;
      const result=$("aduanaHistoryGlobalResult");
      if(result)result.innerHTML="";
      const btn=$("aduanaHistoryGlobalFind");
      if(historyGlobalId.length<5||historyGlobalId.length>80){
        historyGlobalStatus="Informe um Shipment ID válido com 5 a 80 caracteres.";
        const el=$("aduanaHistoryGlobalStatus");if(el)el.textContent=historyGlobalStatus;
        input?.focus();
        return;
      }
      if(btn)btn.disabled=true;
      historyGlobalStatus="Pesquisando nos históricos individuais dos últimos 30 dias...";
      const status=$("aduanaHistoryGlobalStatus");if(status)status.textContent=historyGlobalStatus;
      try{
        if(!window.ControleAduana?.onFindShipmentHistory)
          throw new Error("Pesquisa histórica indisponível. Atualize a página.");
        historyGlobalResult=await window.ControleAduana.onFindShipmentHistory(historyGlobalId);
        historyGlobalStatus=historyGlobalResult.matches.length+
          " ocorrência(s) encontrada(s) em "+historyGlobalResult.daysWithRecords+" dia(s) arquivado(s).";
        if(result)result.innerHTML=historyGlobalMarkup();
      }catch(err){
        historyGlobalStatus="Erro ao pesquisar: "+(err?.message||String(err));
      }finally{
        if(status)status.textContent=historyGlobalStatus;
        if(btn)btn.disabled=false;
      }
    });
    $("aduanaHistoryPeriod")?.addEventListener("change",event=>{
      historyPeriod=event.target.value;
      const label=$("aduanaHistoryDateLabel");if(label)label.hidden=historyPeriod==="mes";
      historyRecord=null;historyRecords=null;historyRangeIdPage=0;
      renderHistoryRecord();
    });
    $("aduanaHistoryFind")?.addEventListener("click",async()=>{
      const selected=$("aduanaHistoryPeriod")?.value||"dia";
      const day=$("aduanaHistoryDate")?.value||"";
      if(selected!=="mes"&&(!day||day<historyMinimumIso()||day>historyNowIso())){
        updateHistoryStatus("Selecione uma data dentro dos últimos 30 dias.");return;
      }
      historyDate=selected==="mes"?historyNowIso():day;
      historyPeriod=selected;
      const btn=$("aduanaHistoryFind");if(btn)btn.disabled=true;
      updateHistoryStatus("Consultando histórico no Firebase...");
      try {
        if(selected==="dia"){
          historyRecords=null;
          historyRecord=await window.ControleAduana?.onReadHistory?.(day)||null;
          updateHistoryStatus(historyRecord?"Fechamento localizado.":"Não existe fechamento arquivado para esta data.");
        }else{
          historyRecord=null;historyRangeIdPage=0;
          historyRecords=await window.ControleAduana?.onReadHistoryRange?.(historyDate,selected==="semana"?7:30);
          if(!Array.isArray(historyRecords))throw new Error("Consulta por período indisponível.");
          updateHistoryStatus(historyRecords.length+" operação(ões) arquivada(s) encontrada(s) no período.");
        }
        renderHistoryRecord();
      }catch(err){historyRecord=null;historyRecords=null;renderHistoryRecord();updateHistoryStatus("Falha na consulta: "+(err?.message||String(err)));}
      finally{if(btn)btn.disabled=false;}
    });
    const dateLabel=$("aduanaHistoryDateLabel");if(dateLabel)dateLabel.hidden=historyPeriod==="mes";
    if(historyOpen)renderHistoryRecord();
    $("aduanaReimportFile")?.addEventListener("change",async event=>{
      const file=event.target.files?.[0];
      if (!file)return;
      const status=$("aduanaReimportStatus");
      if (status)status.textContent="Lendo planilha e atualizando os lados...";
      try { await window.ControleAduana?.onImportPhysical?.(file); }
      catch (err) { if (status)status.textContent="Erro: "+(err?.message || String(err)); }
      finally {event.target.value="";}
    });
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
      data=[["Shipment ID","Origem","Lado Sistema","Rota","Doca","Conciliação por ID"],...m.systemRows.map(r=>[r.id,"Sistema",r.side,r.rota,r.doca,m.physicalReady?(r.match?"SIM":"NÃO"):"PENDENTE"])];
      file="Sistema";
    } else if(type==="fisico") {
      data=[["Shipment ID","Origem","Conciliação com sistema por ID","Lado Físico","Tipo","Cor"],...m.physicalRows.map(r=>[r.id,"Físico",r.match?"SIM":"NÃO",r.ladoFisico,r.tipo,r.cor])];
      file="IDs_Fisicos";
    } else {
      data=[["Shipment ID","Origem","Lado Sistema","Lado Físico","Rota","Doca","Situação por ID","Tipo","Cor"],...m.rows.map(r=>[r.id,r.origem,r.side,r.ladoFisico,r.rota,r.doca,r.situacao,r.tipo,r.cor])];
      file="Confronto_Aduana";
    }
    const content="\uFEFF"+data.map(row=>row.map(csvCell).join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");
    a.href=url;a.download=file+"_AM1_"+(m.date||"sem_data").replace(/\//g,"-")+".csv";
    document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.ControleAduana = { parsePhysicalCsv, parsePhysicalFile, render, historySnapshot,
    onBack:null, onClassify:null, onImportPhysical:null, onSaveHistory:null, onReadHistory:null, onReadHistoryRange:null, historyIdsSnapshot };
})();