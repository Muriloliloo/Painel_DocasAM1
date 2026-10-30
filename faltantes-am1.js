/* Faltantes AM1 — somente leitura, reutilizando as informações do Editor de Dados. */
(function () {
"use strict";
const state = { date:"", final:false, physicalReady:false, physicalFile:"", items:[], sides:[], side:"", statusFilter:"todos", search:"", initialized:false, inventoryDay:"", inventoryAdmin:false, inventoryLoaded:false, inventoryLoading:false, inventorySaving:false, inventoryError:"", inventoryMap:Object.create(null), selected:new Set(), bulkStatus:"", editingValue:"", payload:null };
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
const INVENTORY_OPTIONS=["Pendente","Encontrado","Não encontrado","Devolvido","Vinculado","Atrelado","Em rota","Entregue","Envio cancelado","Avaria","Solução de problemas"];
const RESOLVED=new Set(["Encontrado","Devolvido","Vinculado","Atrelado","Em rota","Entregue","Envio cancelado","Avaria","Solução de problemas"]);
const canAdmin=()=>Boolean(window.FaltantesAm1?.canEditInventory?.());
const itemInventory=row=>state.inventoryMap[idKey(row.id)]||{};
const itemStatus=row=>row.found?"Encontrado":(INVENTORY_OPTIONS.includes(itemInventory(row).inventoryStatus)?itemInventory(row).inventoryStatus:"Pendente");
const manualResolved=row=>!row.found&&RESOLVED.has(itemStatus(row));
const pending=row=>!row.found&&!manualResolved(row);
const canEditValue=row=>Boolean(row.id&&!row.found&&["Pendente","Não encontrado"].includes(itemStatus(row)));
const real=cents=>Number.isSafeInteger(cents)&&cents>=0
  ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100):"—";
const inputValue=cents=>Number.isSafeInteger(cents)&&cents>=0?(cents/100).toFixed(2).replace(".",","):"";
function parseReais(raw){
  let value=String(raw||"").trim().replace(/\s/g,"").replace(/^R\$/i,"");
  if(!value)return null;
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value))value=value.replace(/\./g,"").replace(",",".");
  else if(/^\d+(?:[,.]\d{1,2})?$/.test(value))value=value.replace(",",".");
  else throw new Error("Informe um valor válido em reais. Exemplo: 125,90.");
  const [integer,decimals=""]=value.split(".");
  const cents=Number(integer)*100+Number(decimals.padEnd(2,"0"));
  if(!Number.isSafeInteger(cents)||cents<0||cents>99999999999)
    throw new Error("O valor deve ficar entre R$ 0,00 e R$ 999.999.999,99.");
  return cents;
}
function inventoryOptionHtml(selected){
  return INVENTORY_OPTIONS.map(status=>'<option value="'+esc(status)+'"'+(selected===status?' selected':'')+'>'+esc(status)+'</option>').join("");
}
function inventoryIso(date){return dateKey(date);}
const isAM1 = row => (String(row.rota || "").toUpperCase().match(/\b[A-Z]{1,5}\d{0,3}_[A-Z0-9]+\b/g)||[]).some(route=>route.endsWith("_AM1"));
function initialize(){
  const root=el("faltantesView");if(!root)return false;
  if(state.initialized)return true;
  root.innerHTML=[
    '<div class="falt-shell">',
      '<header class="falt-hero"><div class="falt-head-left"><span class="falt-head-icon"><i class="bi bi-exclamation-triangle-fill"></i></span>',
        '<div><h2>Faltantes <span class="falt-title-accent">— AM1</span></h2><p>Conciliação dos pacotes FALTANTES da AM1 com os Shipment IDs encontrados na planilha física.</p></div></div>',
        '<div class="falt-head-actions"><button type="button" id="faltantesHomeBtn" class="falt-action"><i class="bi bi-arrow-left"></i> Voltar ao painel</button>',
        '<button type="button" id="faltantesExportBtn" class="falt-action primary"><i class="bi bi-download"></i> Exportar CSV</button></div></header>',
      '<div class="falt-status" id="faltantesStatus"></div>',
      '<div class="falt-kpis" id="faltantesKpis"></div>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-bar-chart-fill"></i> Faltantes por lado</h3>',
        '<p>Saldo pendente por grupo A–E. IDs encontrados são abatidos no lado original do sistema.</p></div></header>',
        '<div class="falt-panel-content"><div id="faltantesSideCards" class="falt-side-grid"></div></div></section>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-people-fill"></i> Pendentes por Coordenador</h3>',
        '<p>Somente Coordenadores do Editor de Dados, com saldo dos faltantes ainda pendentes.</p></div></header>',
        '<div class="falt-panel-content"><div class="falt-responsaveis" id="faltantesPeople"></div></div></section>',
      '<section class="falt-panel"><header class="falt-panel-header"><div><h3><i class="bi bi-table"></i> Detalhamento dos Faltantes <span id="faltantesRowCount"></span></h3>',
        '<p id="faltantesTableSub"></p></div></header>',
        '<div class="falt-panel-content"><div class="falt-filters">',
        '<input id="faltantesSearch" type="search" placeholder="Buscar rota, doca, Shipment ID ou responsável" aria-label="Buscar nos faltantes">',
        '<select id="faltantesSideFilter" aria-label="Filtrar por lado"><option value="">Todos os lados</option></select>',
        '<select id="faltantesStatusFilter" aria-label="Filtrar situação"><option value="todos">Todos os faltantes</option><option value="pendentes">Pendentes</option><option value="encontrados">Encontrados no físico</option><option value="tratados">Tratados no inventário</option></select>',
        '</div><div class="falt-inventory-actions"><strong>Inventário dos faltantes:</strong><select id="faltBulkStatus" aria-label="Status para atualização em massa"><option value="">Escolha o status...</option>'+inventoryOptionHtml("")+'</select><button type="button" id="faltBulkApply" class="falt-action primary" disabled>Aplicar aos 0 selecionado(s)</button><small>Selecione somente IDs pendentes.</small></div><p class="falt-inventory-feedback" id="faltInventoryFeedback" role="status"></p></div><div class="falt-table-wrap"><table class="falt-table">',
        '<thead><tr><th>Lado</th><th>Rota AM1</th><th>Doca</th><th>Coordenador</th><th>PS</th><th>Shipment ID</th><th>Lado Físico</th><th>Quantidade</th><th>Situação</th><th>Inventário <label class="falt-th-check"><input id="faltSelectAll" type="checkbox" aria-label="Selecionar pendentes visíveis"> Selecionar pendentes</label></th><th>Valor (R$)</th></tr></thead>',
        '<tbody id="faltantesRows"></tbody></table></div></section>',
      '<p class="falt-note" id="faltantesNote"></p>',
    '</div>'
  ].join("");
  root.addEventListener("input",e=>{
    if(e.target.id==="faltantesSearch"){state.search=e.target.value;renderTable();}
  });
  root.addEventListener("change",e=>{
    if(e.target.id==="faltantesSideFilter"){state.side=e.target.value;renderTable();return;}
    if(e.target.id==="faltantesStatusFilter"){state.statusFilter=e.target.value;renderTable();return;}
    if(e.target.id==="faltBulkStatus"){state.bulkStatus=e.target.value;renderTable();return;}
    if(e.target.id==="faltSelectAll"){
      for(const row of selectedRows()){
        if(!row.id||row.found||itemStatus(row)!=="Pendente")continue;
        if(e.target.checked)state.selected.add(idKey(row.id));
        else state.selected.delete(idKey(row.id));
      }
      renderTable();return;
    }
    const check=e.target.closest("[data-falt-check]");
    if(check){
      const id=idKey(check.dataset.faltCheck);
      if(check.checked)state.selected.add(id);
      else state.selected.delete(id);
      renderTable();return;
    }
    const select=e.target.closest("[data-falt-inventory]");
    if(select){saveInventoryStatus(select.dataset.faltInventory,select.value);return;}
  });
  root.addEventListener("click",e=>{
    if(e.target.closest("#faltantesExportBtn")){exportCsv();return;}
    if(e.target.closest("#faltBulkApply")){saveBulkInventory();return;}
    const save=e.target.closest("[data-falt-value-save]");
    if(save){saveInventoryValue(save.dataset.faltValueSave);return;}
    const cancel=e.target.closest("[data-falt-value-cancel]");
    if(cancel){state.editingValue="";renderTable();return;}
    const edit=e.target.closest("[data-falt-value-edit]");
    if(edit){
      const id=idKey(edit.dataset.faltValueEdit);
      const row=state.items.find(row=>idKey(row.id)===id);
      if(!canAdmin()||!state.inventoryLoaded||!row||!canEditValue(row))return;
      state.editingValue=id;renderTable();
      const input=[...el("faltantesRows").querySelectorAll("[data-falt-value-input]")]
        .find(input=>idKey(input.dataset.faltValueInput)===id);
      input?.focus();input?.select();
    }
  });
  root.addEventListener("keydown",e=>{
    const input=e.target.closest("[data-falt-value-input]");
    if(!input)return;
    if(e.key==="Enter"){e.preventDefault();saveInventoryValue(input.dataset.faltValueInput);}
    if(e.key==="Escape"){e.preventDefault();state.editingValue="";renderTable();}
  });
  state.initialized=true;return true;
}
function selectedRows(){
  return state.items.filter(row=>
    (!state.side||row.lado===state.side)&&
    (state.statusFilter==="todos"||
      (state.statusFilter==="encontrados"?row.found:
        state.statusFilter==="tratados"?manualResolved(row):pending(row)))&&
    (!state.search||norm([row.lado,row.titulo,row.rota,row.doca,row.coord,row.ps,row.id,row.ladoFisico].join(" ")).includes(norm(state.search))));
}
function inventoryCell(row){
  if(row.found)return '<span class="falt-tag found" title="Conferido no arquivo físico">✓ Encontrado</span>';
  if(!row.id)return "—";
  const status=itemStatus(row);
  if(!canAdmin())return '<span class="falt-muted">Acesso restrito</span>';
  const disabled=state.inventorySaving||!state.inventoryLoaded;
  const checked=state.selected.has(idKey(row.id));
  const checkbox=status==="Pendente"?
    '<input type="checkbox" data-falt-check="'+esc(row.id)+'" aria-label="Selecionar pendente '+esc(row.id)+'"'+
    (checked?' checked':'')+(disabled?' disabled':'')+'>':"";
  return '<div class="falt-inventory-cell">'+checkbox+
    '<select data-falt-inventory="'+esc(row.id)+'" aria-label="Inventário do Shipment ID '+esc(row.id)+'"'+
    (disabled?' disabled':'')+'>'+inventoryOptionHtml(status)+'</select></div>';
}
function valueCell(row){
  if(!row.id||!canAdmin())return "—";
  const cents=itemInventory(row).inventoryValueCents;
  const amount='<strong class="falt-money">'+esc(real(cents))+'</strong>';
  if(!canEditValue(row))return amount;
  const busy=state.inventorySaving||!state.inventoryLoaded;
  if(state.editingValue===idKey(row.id))
    return '<div class="falt-value-edit"><span>R$</span><input data-falt-value-input="'+esc(row.id)+'" inputmode="decimal" maxlength="20" aria-label="Valor em reais para '+esc(row.id)+'" value="'+esc(inputValue(cents))+'">'+
      '<button data-falt-value-save="'+esc(row.id)+'" type="button"'+(busy?' disabled':'')+'>Salvar</button>'+
      '<button data-falt-value-cancel="'+esc(row.id)+'" type="button">Cancelar</button></div>';
  return '<div class="falt-value-cell">'+amount+
    '<button data-falt-value-edit="'+esc(row.id)+'" type="button"'+(busy?' disabled':'')+'>'+(cents==null?'Informar':'Editar')+'</button></div>';
}
function renderTable(){
  if(!el("faltantesRows"))return;
  const rows=selectedRows(),editable=canAdmin()&&state.inventoryLoaded&&!state.inventorySaving;
  el("faltantesRowCount").textContent="("+fmt(rows.reduce((a,r)=>a+r.qty,0))+" pacotes)";
  el("faltantesRows").innerHTML=rows.length?rows.map(r=>{
    const situacao=r.found?"Encontrado no físico":manualResolved(r)?"Tratado: "+itemStatus(r):state.physicalReady?"Pendente":"Aguardando físico";
    return '<tr><td>'+esc(r.titulo)+'</td><td><b>'+esc(r.rota)+'</b></td><td>'+esc(r.doca||"—")+
      '</td><td>'+esc(r.coord)+'</td><td>'+esc(r.ps)+'</td><td>'+esc(r.id||"—")+'</td>'+
      '<td>'+esc(r.ladoFisico||"—")+'</td><td><b>'+fmt(r.qty)+'</b></td>'+
      '<td><span class="falt-tag'+(r.found?' found':manualResolved(r)?' treated':'')+'">'+esc(situacao)+'</span></td>'+
      '<td>'+inventoryCell(r)+'</td><td>'+valueCell(r)+'</td></tr>';
  }).join(""):'<tr><td colspan="11" class="falt-empty">Nenhum faltante AM1 corresponde aos filtros selecionados.</td></tr>';
  const eligible=new Set(rows.filter(r=>r.id&&itemStatus(r)==="Pendente"&&!r.found).map(r=>idKey(r.id)));
  const allEligible=new Set(state.items.filter(r=>r.id&&itemStatus(r)==="Pendente"&&!r.found).map(r=>idKey(r.id)));
  for(const id of state.selected)if(!allEligible.has(id))state.selected.delete(id);
  const count=[...eligible].filter(id=>state.selected.has(id)).length;
  const check=el("faltSelectAll");
  if(check){check.checked=eligible.size>0&&count===eligible.size;
    check.indeterminate=count>0&&count<eligible.size;check.disabled=!editable||eligible.size===0;}
  const apply=el("faltBulkApply");
  if(apply){apply.disabled=!editable||!state.selected.size||!state.bulkStatus||state.bulkStatus==="Pendente";
    apply.textContent="Aplicar aos "+state.selected.size+" selecionado(s)";}
  const bulk=el("faltBulkStatus");
  if(bulk){bulk.value=state.bulkStatus;bulk.disabled=!editable;}
  const info=el("faltInventoryFeedback");
  if(info)info.textContent=state.inventoryError||
    (state.inventoryLoading?"Consultando inventário privado no Firebase...":
    !canAdmin()?"Entre como administrador no Firebase para visualizar e editar Inventário e Valores.":
    !state.final?"Aplique o CSV final da AM1 para editar os dados do inventário.":
    !state.inventoryLoaded?"Carregando inventário do dia...":
    "Inventário e valores salvos no Firebase privado, separados da aba Aduana A Mais.");
}

function resetInventory(day,admin){
  state.inventoryDay=day;state.inventoryAdmin=admin;state.inventoryLoaded=false;
  state.inventoryLoading=false;state.inventoryMap=Object.create(null);state.inventoryError="";
  state.selected.clear();state.editingValue="";state.bulkStatus="";
}
function loadInventoryForDay(){
  const day=state.final?inventoryIso(state.date):"";
  const admin=canAdmin();
  if(day!==state.inventoryDay||admin!==state.inventoryAdmin)resetInventory(day,admin);
  if(!admin||!day||state.inventoryLoaded||state.inventoryLoading||!window.FaltantesAm1?.onReadInventory)return;
  state.inventoryLoading=true;
  const requested=day;
  Promise.resolve().then(()=>window.FaltantesAm1.onReadInventory(requested)).then(rows=>{
    if(state.inventoryDay!==requested||!canAdmin())return;
    if(!Array.isArray(rows))throw Error("Resposta do inventário inválida.");
    const next=Object.create(null);
    for(const row of rows){
      const id=idKey(row?.id);
      if(id)next[id]={inventoryStatus:INVENTORY_OPTIONS.includes(row.inventoryStatus)?row.inventoryStatus:"Pendente",
        inventoryValueCents:Number.isSafeInteger(row.inventoryValueCents)&&row.inventoryValueCents>=0?row.inventoryValueCents:null};
    }
    state.inventoryMap=next;state.inventoryLoaded=true;state.inventoryError="";
    if(state.payload)render(state.payload);
  }).catch(error=>{
    if(state.inventoryDay!==requested)return;
    state.inventoryError="Falha ao ler o inventário: "+(error?.message||String(error));
    if(state.payload)render(state.payload);
  }).finally(()=>{if(state.inventoryDay===requested){state.inventoryLoading=false;renderTable();}});
}

function render(payload){
  if(!initialize())return;
  const model=payload.model||{};
  const groups=new Map((model.groups||[]).map(g=>[g.label,g]));
  const zones=Array.isArray(payload.zones)?payload.zones:[];
  state.date=payload.date||"";
  state.final=Boolean(model.useFinal);
  state.payload=payload;
  loadInventoryForDay();
  const physical=payload.physical||{};
  // Nunca conciliar entre dias diferentes nem sem CSV final do sistema.
  state.physicalReady=Boolean(state.final&&dateKey(state.date)&&dateKey(physical.date)===dateKey(state.date)&&Array.isArray(physical.ids));
  state.physicalFile=state.physicalReady?String(physical.fileName||"IDs Físicos"):"";
  const physicalIds=new Set(state.physicalReady?physical.ids.map(idKey).filter(Boolean):[]);
  const physicalDetails=state.physicalReady?(physical.details||{}):{};
  state.items=[];
  state.sides=zones.map(z=>({label:z.label,title:z.displayLabel||z.label,staff:z.staff||{},faltantes:0,encontrados:0,tratados:0,pendentes:0}));
  const unknown=groups.get("Sem lado identificado");
  if(unknown&&(unknown.rows||[]).some(r=>isAM1(r)&&num(r.faltantes)))
    state.sides.push({label:"Sem lado identificado",title:"Sem lado identificado",staff:{},faltantes:0,encontrados:0,tratados:0,pendentes:0});
  for(const side of state.sides){
    for(const row of groups.get(side.label)?.rows||[]){
      // Registros de CHP, AM0, AMDE, PM e SD não afetam os indicadores.
      if(!isAM1(row))continue;
      const events=Array.isArray(row.ocorrencias)?row.ocorrencias:null;
      const missing=events?events.filter(i=>i.estado==="faltantes"):null;
      const total=missing?missing.length:num(row.faltantes);
      side.faltantes+=total;
      if(!total)continue;
      const common={lado:side.label,titulo:side.title,rota:row.rota||"",doca:row.doca||"",
        coord:side.staff.coordenador||"Não informado",ps:side.staff.ps||"Não informado"};
      if(missing&&missing.length){
        for(const item of missing){
          const id=idKey(item.shipmentId);
          // A conferência é feita pelo ID, independentemente do lado onde foi bipado.
          // Um mesmo ID físico importado duas vezes continua valendo apenas como ID único.
          const found=Boolean(id&&physicalIds.has(id));
          const details=found?(physicalDetails[id]||{}):{};
          if(found)side.encontrados++;
          state.items.push({...common,id:item.shipmentId||"",qty:1,found,ladoFisico:found?(details.ladoFisico||""):""});
        }
      }else{
        // Base ao vivo ou arquivos antigos sem IDs: não é seguro abater por quantidade.
        state.items.push({...common,id:"",qty:total,found:false,ladoFisico:""});
      }
    }
    side.tratados=state.items.filter(item=>item.lado===side.label&&manualResolved(item)).reduce((sum,item)=>sum+item.qty,0);
    side.pendentes=Math.max(0,side.faltantes-side.encontrados-side.tratados);
  }
  const totalSistema=state.sides.reduce((a,g)=>a+g.faltantes,0);
  const encontrados=state.sides.reduce((a,g)=>a+g.encontrados,0);
  const tratados=state.sides.reduce((a,g)=>a+g.tratados,0);
  const pendentes=state.sides.reduce((a,g)=>a+g.pendentes,0);
  const routes=new Set(state.items.filter(pending).map(r=>r.rota)).size;
  el("faltantesStatus").innerHTML=
    '<span><i class="bi bi-calendar3"></i> Data: <b>'+esc(state.date||"Não informada")+'</b></span>'+
    '<span><i class="bi bi-database-check"></i> '+(state.final?"Sistema aplicado: "+fmt(totalSistema)+" FALTANTES AM1":"Contagens ao vivo da Base Aduana")+'</span>'+
    '<span><i class="bi bi-box-seam"></i> '+(state.physicalReady?"IDs Físicos: "+esc(state.physicalFile):"IDs Físicos: aguardando importação da mesma data")+'</span>'+
    '<span><i class="bi bi-funnel-fill"></i> Somente <b>_AM1</b> · '+fmt(routes)+' rotas com pendência</span>';
  el("faltantesKpis").innerHTML=[
    '<article class="falt-kpi system"><span class="falt-kpi-icon"><i class="bi bi-database-fill" aria-hidden="true"></i></span><div class="falt-kpi-copy"><span>Faltantes no sistema AM1</span><strong>'+fmt(totalSistema)+'</strong><small>Total original da auditoria, sem alterações</small></div></article>',
    '<article class="falt-kpi found"><span class="falt-kpi-icon"><i class="bi bi-check-circle-fill" aria-hidden="true"></i></span><div class="falt-kpi-copy"><span>Faltantes encontrados no físico</span><strong>'+fmt(encontrados)+'</strong><small>Conciliados pela planilha de IDs Físicos</small></div></article>',
    '<article class="falt-kpi treated"><span class="falt-kpi-icon"><i class="bi bi-clipboard2-check-fill" aria-hidden="true"></i></span><div class="falt-kpi-copy"><span>Tratados no inventário</span><strong>'+fmt(tratados)+'</strong><small>Status resolvido manualmente no Firebase</small></div></article>',
    '<article class="falt-kpi missing"><span class="falt-kpi-icon"><i class="bi bi-box-seam-fill" aria-hidden="true"></i></span><div class="falt-kpi-copy"><span>Faltantes pendentes AM1</span><strong>'+fmt(pendentes)+'</strong><small>Saldo atualizado após a conciliação física</small></div></article>',
  ].join("");
  el("faltantesSideCards").innerHTML=state.sides.map((side,index)=>{
    const percent=pendentes?side.pendentes/pendentes*100:0;
    const letter=side.label==="Sem lado identificado"?"?":String.fromCharCode(65+index);
    return '<article class="falt-side"><div class="falt-side-heading"><span class="falt-side-icon" aria-hidden="true">'+letter+'</span><h4>'+esc(side.title)+'</h4></div>'+
      '<div class="falt-staff"><span><b>Coordenador:</b> '+esc(side.staff.coordenador||"Não informado")+'</span>'+
      '<span><b>PS:</b> '+esc(side.staff.ps||"Não informado")+'</span></div>'+
      '<div class="falt-count"><strong>'+fmt(side.pendentes)+'</strong><small>'+percent.toFixed(1).replace(".",",")+'% dos pendentes</small></div>'+
      '<span class="falt-meter"><i style="width:'+Math.min(100,percent).toFixed(2)+'%"></i></span>'+
      '<small class="falt-extra">Sistema: <b>'+fmt(side.faltantes)+'</b> · Físico: <b>'+fmt(side.encontrados)+'</b> · Tratados: <b>'+fmt(side.tratados)+'</b></small></article>';
  }).join("");
  // Apenas Coordenadores. Não duplicar cards de PS.
  const people=new Map();
  state.sides.forEach(side=>{
    const name=String(side.staff.coordenador||"").trim();
    if(!name)return;
    const key=norm(name);
    if(!people.has(key))people.set(key,{name,qty:0,found:0,treated:0});
    people.get(key).qty+=side.pendentes;
    people.get(key).found+=side.encontrados;
    people.get(key).treated+=side.tratados;
  });
  el("faltantesPeople").innerHTML=people.size?[...people.values()].sort((a,b)=>b.qty-a.qty).map(p=>
    '<article class="falt-person"><span class="falt-person-icon" aria-hidden="true"><i class="bi bi-person-fill"></i></span><div class="falt-person-copy"><span>Coordenador</span><b>'+esc(p.name)+'</b>'+
    '<small>'+fmt(p.found)+' no físico · '+fmt(p.treated)+' tratado(s) no inventário</small></div><strong>'+fmt(p.qty)+'</strong></article>'
  ).join(""):'<p>Cadastre os Coordenadores no Editor de Dados para exibir o saldo.</p>';
  const options=['<option value="">Todos os lados</option>'].concat(state.sides.map(s=>
    '<option value="'+esc(s.label)+'">'+esc(s.title)+'</option>'));
  el("faltantesSideFilter").innerHTML=options.join("");
  if(!state.sides.some(s=>s.label===state.side))state.side="";
  el("faltantesSideFilter").value=state.side;
  el("faltantesSearch").value=state.search;
  el("faltantesStatusFilter").value=state.statusFilter;
  el("faltantesTableSub").textContent=state.final?
    "Pendentes, encontrados no físico e tratados no inventário juntos. Situação e valores registrados por Shipment ID.":
    "Ainda sem CSV final desta data: contagens por rota, sem Shipment IDs individuais.";
  const notice=state.final
    ? state.physicalReady
      ? "Conciliação ativa com "+state.physicalFile+". Todo Shipment ID físico que também esteja como FALTANTE na AM1 é abatido do saldo pendente, inclusive quando bipado em outro lado. Os lados e Coordenadores seguem a rota do SISTEMA."
      : "Aguardando a importação/aplicação da planilha IDs Físicos da mesma data no Editor de Dados. Os status tratados no inventário continuam separados da localização física."
    : "Fonte: Base Aduana do Editor de Dados. O abatimento individual por Shipment ID começa depois que o CSV/XLSX final do sistema e a planilha IDs Físicos da mesma data forem aplicados.";
  el("faltantesNote").textContent=notice+
    " Total original = encontrados no físico + tratados no inventário + pendentes (por ocorrência da rota). IDs repetidos no físico não geram abatimento extra; somente ocorrências FALTANTES da AM1 são consideradas. CHP, AM0, AMDE, PM e SD são ignorados."+
    (model.final&&!model.useFinal?" ATENÇÃO: o CSV do sistema salvo é de outra data.":"");
  renderTable();
}
function redraw(){
  const root=el("faltantesView");
  const top=root?.scrollTop||0;
  const table=root?.querySelector?.(".falt-table-wrap");
  const tableTop=table?.scrollTop||0;
  if(state.payload)render(state.payload);
  if(root)root.scrollTop=top;
  const newTable=root?.querySelector?.(".falt-table-wrap");
  if(newTable)newTable.scrollTop=tableTop;
}
function canChange(row){
  return Boolean(row&&row.id&&!row.found&&canAdmin()&&state.final&&
    state.inventoryLoaded&&!state.inventorySaving);
}
async function saveInventoryStatus(rawId,status){
  const id=idKey(rawId);
  const row=state.items.find(r=>idKey(r.id)===id);
  if(!canChange(row)||!INVENTORY_OPTIONS.includes(status)){renderTable();return;}
  if(status===itemStatus(row))return;
  const day=state.inventoryDay;
  state.inventorySaving=true;state.inventoryError="Gravando status do ID "+id+" no Firebase...";
  renderTable();
  try{
    if(!window.FaltantesAm1?.onSetInventory)throw Error("Serviço do inventário indisponível.");
    await window.FaltantesAm1.onSetInventory(day,id,status);
    if(state.inventoryDay!==day)return;
    state.inventoryMap[id]={...itemInventory(row),inventoryStatus:status};
    state.editingValue="";state.selected.delete(id);
    state.inventoryError="Inventário do Shipment ID "+id+" salvo: "+status+".";
  }catch(error){
    state.inventoryError="Falha ao salvar ID "+id+": "+(error?.message||String(error));
  }finally{
    if(state.inventoryDay===day){state.inventorySaving=false;redraw();}
  }
}
async function saveBulkInventory(){
  if(!canAdmin()||!state.final||!state.inventoryLoaded||state.inventorySaving||
     !state.selected.size||!state.bulkStatus||state.bulkStatus==="Pendente")return;
  const ids=[...state.selected],day=state.inventoryDay,status=state.bulkStatus;
  state.inventorySaving=true;state.inventoryError="Gravando "+ids.length+" ID(s) no Firebase...";
  renderTable();
  try{
    if(!window.FaltantesAm1?.onSetInventoryBatch)throw Error("Atualização em massa indisponível.");
    await window.FaltantesAm1.onSetInventoryBatch(day,ids,status);
    if(state.inventoryDay!==day)return;
    for(const id of ids)state.inventoryMap[id]={...(state.inventoryMap[id]||{}),inventoryStatus:status};
    state.selected.clear();state.bulkStatus="";
    state.inventoryError=ids.length+" ID(s) atualizados em massa para "+status+".";
  }catch(error){
    state.inventoryError="Falha na atualização em massa: "+(error?.message||String(error));
  }finally{
    if(state.inventoryDay===day){state.inventorySaving=false;redraw();}
  }
}
async function saveInventoryValue(rawId){
  const id=idKey(rawId);
  const row=state.items.find(r=>idKey(r.id)===id);
  if(!canChange(row)||!canEditValue(row)||state.editingValue!==id)return;
  const input=[...el("faltantesRows").querySelectorAll("[data-falt-value-input]")]
    .find(input=>idKey(input.dataset.faltValueInput)===id);
  if(!input)return;
  let cents;
  try{cents=parseReais(input.value);}
  catch(error){
    state.inventoryError=error.message;el("faltInventoryFeedback").textContent=state.inventoryError;
    input.focus();return;
  }
  const day=state.inventoryDay;
  state.inventorySaving=true;state.inventoryError="Salvando valor de "+id+" no Firebase...";
  renderTable();
  try{
    if(!window.FaltantesAm1?.onSetInventoryValue)throw Error("Serviço de valores indisponível.");
    await window.FaltantesAm1.onSetInventoryValue(day,id,cents);
    if(state.inventoryDay!==day)return;
    state.inventoryMap[id]={...itemInventory(row),inventoryValueCents:cents};
    state.editingValue="";
    state.inventoryError="Valor do ID "+id+" salvo: "+real(cents)+".";
  }catch(error){
    state.inventoryError="Falha ao salvar valor do ID "+id+": "+(error?.message||String(error));
  }finally{
    if(state.inventoryDay===day){state.inventorySaving=false;redraw();}
  }
}

function csvCell(v){
  let s=String(v==null?"":v);
  if(/^\s*[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function exportCsv(){
  const lines=[["Data","Lado Sistema","Rota AM1","Doca","Coordenador","PS","Shipment ID","Lado Físico","Quantidade","Estado no Sistema","Situação Física","Inventário","Valor (R$)"]];
  selectedRows().forEach(r=>{
    const inventory=canAdmin()?itemStatus(r):r.found?"Encontrado":"Acesso restrito";
    const value=canAdmin()?real(itemInventory(r).inventoryValueCents):"—";
    const situacao=r.found?"Encontrado no físico":manualResolved(r)?"Tratado no inventário":state.physicalReady?"Pendente":"Aguardando físico";
    lines.push([state.date,r.titulo,r.rota,r.doca,r.coord,r.ps,r.id,r.ladoFisico,r.qty,
      "FALTANTE",situacao,inventory,value]);
  });
  const blob=new Blob(["\uFEFF"+lines.map(row=>row.map(csvCell).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="faltantes_AM1_"+String(state.date||"sem-data").replace(/\W+/g,"-")+".csv";
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
window.FaltantesAm1={render};
})();