/* Faltantes AM1 — somente leitura, reutilizando as informações do Editor de Dados. */
(function () {
"use strict";
const state = { date:"", final:false, physicalReady:false, physicalFile:"", items:[], sides:[], side:"", statusFilter:"pendentes", search:"", initialized:false };
const el = id => document.getElementById(id);
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = value => String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const num = v => Math.max(0, Number(v)||0);
const fmt = v => new Intl.NumberFormat("pt-BR").format(Number(v)||0);
// Compartilha o formato de ID com a conferência física da Aduana.
const idKey = value => {
  const raw=String(value==null?"":value).trim().replace(/^\uFEFF/,"").replace(/^'/,"");
  return /^[+]?[0-9]+(?:\.[0-9]+)?e[+]?[0-9]+$/i.test(raw)&&Number.isSafeInteger(Number(raw))
    ? String(Number(raw)):raw.toUpperCase();
};
const dateKey = value => {
  const raw=String(value||"").trim();
  const br=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(br)return br[3]+"-"+br[2]+"-"+br[1];
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso?iso[1]+"-"+iso[2]+"-"+iso[3]:"";
};
const isAM1 = row => (String(row.rota || "").toUpperCase().match(/\b[A-Z]{1,5}\d{0,3}_[A-Z0-9]+\b/g)||[]).some(route=>route.endsWith("_AM1"));
function initialize(){
  const root=el("faltantesView");if(!root)return false;
  if(state.initialized)return true;
  root.innerHTML=[
    '<div class="falt-shell">',
      '<header class="falt-hero"><div class="falt-head-left"><span class="falt-head-icon"><i class="bi bi-exclamation-triangle-fill"></i></span>',
        '<div><h2>Faltantes — AM1</h2><p>Conciliação dos pacotes FALTANTES da AM1 com os Shipment IDs encontrados na planilha física.</p></div></div>',
        '<div class="falt-head-actions"><button type="button" id="faltantesHomeBtn" class="falt-action"><i class="bi bi-arrow-left"></i> Voltar ao painel</button>',
        '<button type="button" id="faltantesExportBtn" class="falt-action primary"><i class="bi bi-download"></i> Exportar CSV</button></div></header>',
      '<div class="falt-status" id="faltantesStatus"></div>',
      '<div class="falt-kpis" id="faltantesKpis"></div>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-bar-chart-fill"></i> Faltantes por lado</h3>',
        '<p>Saldo pendente por grupo A–E. IDs encontrados são abatidos no lado original do sistema.</p></div></header>',
        '<div class="falt-panel-content"><div id="faltantesSideCards" class="falt-side-grid"></div></div></section>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-people-fill"></i> Faltantes por Coordenador</h3>',
        '<p>Somente Coordenadores do Editor de Dados, com saldo dos faltantes ainda pendentes.</p></div></header>',
        '<div class="falt-panel-content"><div class="falt-responsaveis" id="faltantesPeople"></div></div></section>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-table"></i> Detalhamento dos Faltantes <span id="faltantesRowCount"></span></h3>',
        '<p id="faltantesTableSub"></p></div></header>',
        '<div class="falt-panel-content"><div class="falt-filters">',
        '<input id="faltantesSearch" type="search" placeholder="Buscar rota, doca, Shipment ID ou responsável" aria-label="Buscar nos faltantes">',
        '<select id="faltantesSideFilter" aria-label="Filtrar por lado"><option value="">Todos os lados</option></select>',
        '<select id="faltantesStatusFilter" aria-label="Filtrar situação"><option value="pendentes">Pendentes</option><option value="encontrados">Encontrados no físico</option><option value="todos">Todos</option></select>',
        '</div></div><div class="falt-table-wrap"><table class="falt-table">',
        '<thead><tr><th>Lado</th><th>Rota AM1</th><th>Doca</th><th>Coordenador</th><th>PS</th><th>Shipment ID</th><th>Lado Físico</th><th>Quantidade</th><th>Situação</th></tr></thead>',
        '<tbody id="faltantesRows"></tbody></table></div></section>',
      '<p class="falt-note" id="faltantesNote"></p>',
    '</div>'
  ].join("");
  root.addEventListener("input",e=>{
    if(e.target.id==="faltantesSearch"){state.search=e.target.value;renderTable();}
  });
  root.addEventListener("change",e=>{
    if(e.target.id==="faltantesSideFilter"){state.side=e.target.value;renderTable();}
    if(e.target.id==="faltantesStatusFilter"){state.statusFilter=e.target.value;renderTable();}
  });
  root.addEventListener("click",e=>{
    if(e.target.closest("#faltantesExportBtn"))exportCsv();
  });
  state.initialized=true;return true;
}
function selectedRows(){
  return state.items.filter(row=>
    (!state.side||row.lado===state.side)&&
    (!state.search||norm([row.lado,row.titulo,row.rota,row.doca,row.coord,row.ps,row.id].join(" ")).includes(norm(state.search))));
}
function renderTable(){
  const rows=selectedRows();
  el("faltantesRowCount").textContent="("+fmt(rows.reduce((a,r)=>a+r.qty,0))+" pacotes)";
  el("faltantesRows").innerHTML=rows.length?rows.map(r=>
    '<tr><td>'+esc(r.titulo)+'</td><td><b>'+esc(r.rota)+'</b></td><td>'+esc(r.doca||"—")+
    '</td><td>'+esc(r.coord)+'</td><td>'+esc(r.ps)+'</td><td>'+esc(r.id||"—")+
    '</td><td><b>'+fmt(r.qty)+'</b></td><td><span class="falt-tag">FALTANTE</span></td></tr>'
  ).join(""):'<tr><td colspan="8" class="falt-empty">Sem pacotes FALTANTES da AM1 para os filtros selecionados.</td></tr>';
}
function render(payload){
  if(!initialize())return;
  const model=payload.model||{};
  const groups=new Map((model.groups||[]).map(g=>[g.label,g]));
  const zones=Array.isArray(payload.zones)?payload.zones:[];
  state.date=payload.date||"";
  state.final=Boolean(model.useFinal);
  state.items=[];
  state.sides=zones.map(z=>({ label:z.label, title:z.displayLabel||z.label, staff:z.staff||{}, faltantes:0, aMais:0 }));
  const unknown=groups.get("Sem lado identificado");
  if(unknown&&(unknown.rows||[]).some(r=>isAM1(r)&&(num(r.faltantes)||num(r.aMais))))
    state.sides.push({label:"Sem lado identificado",title:"Sem lado identificado",staff:{},faltantes:0,aMais:0});
  for(const side of state.sides){
    for(const row of groups.get(side.label)?.rows||[]){
      // Filtragem obrigatória da operação; uma linha PM, SD, AM0 ou AMDE nunca entra.
      if(!isAM1(row))continue;
      const events=Array.isArray(row.ocorrencias)?row.ocorrencias:null;
      const missing=events?events.filter(i=>i.estado==="faltantes"):null;
      const aMais=events?events.filter(i=>i.estado==="aMais").length:num(row.aMais);
      const total=missing?missing.length:num(row.faltantes);
      side.faltantes+=total;side.aMais+=aMais;
      if(!total)continue;
      const common={lado:side.label,titulo:side.title,rota:row.rota||"",doca:row.doca||"",
        coord:side.staff.coordenador||"Não informado",ps:side.staff.ps||"Não informado"};
      if(missing&&missing.length){
        missing.forEach(item=>state.items.push({...common,id:item.shipmentId||"",qty:1}));
      }else{
        // Antes do CSV final não existem IDs disponíveis. Mostrar apenas a quantidade.
        state.items.push({...common,id:"",qty:total});
      }
    }
  }
  const falt=state.sides.reduce((a,g)=>a+g.faltantes,0);
  const extra=state.sides.reduce((a,g)=>a+g.aMais,0);
  const routes=new Set(state.items.map(r=>r.rota)).size;
  el("faltantesStatus").innerHTML=
    '<span><i class="bi bi-calendar3"></i> Data: <b>'+esc(state.date||"Não informada")+'</b></span>'+
    '<span><i class="bi bi-database-check"></i> '+(state.final?"CSV/XLSX final aplicado no Editor":"Contagens ao vivo da Base Aduana")+'</span>'+
    '<span><i class="bi bi-funnel-fill"></i> Somente <b>_AM1</b></span>';
  el("faltantesKpis").innerHTML=[
    '<article class="falt-kpi missing"><span>Pacotes faltantes AM1</span><strong>'+fmt(falt)+'</strong><small>Estado FALTANTE na Aduana</small></article>',
    '<article class="falt-kpi extra"><span>Pacotes a mais AM1</span><strong>'+fmt(extra)+'</strong><small>Mesmo arquivo; indicador separado</small></article>',
    '<article class="falt-kpi"><span>Rotas AM1 com faltantes</span><strong>'+fmt(routes)+'</strong><small>Rotas terminadas em _AM1</small></article>',
    '<article class="falt-kpi"><span>Lados monitorados</span><strong>'+fmt(zones.length)+'</strong><small>Responsáveis do Editor de Dados</small></article>'
  ].join("");
  el("faltantesSideCards").innerHTML=state.sides.map(side=>{
    const percent=falt?side.faltantes/falt*100:0;
    return '<article class="falt-side"><h4>'+esc(side.title)+'</h4>'+
      '<div class="falt-staff"><span><b>Coordenador:</b> '+esc(side.staff.coordenador||"Não informado")+'</span>'+
      '<span><b>PS:</b> '+esc(side.staff.ps||"Não informado")+'</span></div>'+
      '<div class="falt-count"><strong>'+fmt(side.faltantes)+'</strong><small>'+percent.toFixed(1).replace(".",",")+'% dos faltantes</small></div>'+
      '<span class="falt-meter"><i style="width:'+Math.min(100,percent).toFixed(2)+'%"></i></span>'+
      '<small class="falt-extra">A mais neste lado: '+fmt(side.aMais)+'</small></article>';
  }).join("");
  const people=new Map();
  state.sides.forEach(side=>{
    const name=String(side.staff.coordenador||"").trim();
    if(!name)return;
    const key=norm(name);
    if(!people.has(key))people.set(key,{name,qty:0});
    people.get(key).qty+=side.faltantes;
  });
  el("faltantesPeople").innerHTML=people.size?[...people.values()].sort((a,b)=>b.qty-a.qty).map(p=>
    '<article class="falt-person"><span>Coordenador</span><b>'+esc(p.name)+'</b><strong>'+fmt(p.qty)+'</strong></article>'
  ).join(""):'<p>Cadastre os Coordenadores no Editor de Dados para exibir o consolidado.</p>';
  const options=['<option value="">Todos os lados</option>'].concat(state.sides.map(s=>
    '<option value="'+esc(s.label)+'">'+esc(s.title)+'</option>'));
  el("faltantesSideFilter").innerHTML=options.join("");
  if(!state.sides.some(s=>s.label===state.side))state.side="";
  el("faltantesSideFilter").value=state.side;
  el("faltantesSearch").value=state.search;
  el("faltantesTableSub").textContent=state.final?
    "IDs FALTANTES do arquivo audited_shipments final (somente AM1).":
    "Contagens por rota da Base Aduana; IDs individuais aparecem depois do CSV/XLSX final.";
  el("faltantesNote").textContent=(state.final?
    "Fonte: CSV/XLSX final importado no Editor de Dados. O mesmo Shipment ID pode aparecer em rotas diferentes, conforme a auditoria. ":
    "Fonte: Base Aduana do Editor de Dados. Nenhum Shipment ID é inventado antes do CSV/XLSX final. ")+
    "AM0, AMDE, PM e SD são excluídos. Não confundir FALTANTE da Aduana com Não Encontrado na conferência física."+
    (model.final&&!model.useFinal?" ATENÇÃO: o CSV final armazenado é de outra data.":"");
  renderTable();
}
function csvCell(v){
  let s=String(v==null?"":v);
  if(/^\s*[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function exportCsv(){
  const lines=[["Data","Lado","Rota AM1","Doca","Coordenador","PS","Shipment ID","Quantidade","Situação"]];
  selectedRows().forEach(r=>lines.push([state.date,r.titulo,r.rota,r.doca,r.coord,r.ps,r.id,r.qty,"FALTANTE"]));
  const blob=new Blob(["\uFEFF"+lines.map(row=>row.map(csvCell).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="faltantes_AM1_"+String(state.date||"sem-data").replace(/\W+/g,"-")+".csv";
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
window.FaltantesAm1={render};
})();