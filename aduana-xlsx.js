/* Leitor local XLSX para Controle de Aduana.
   Não envia o arquivo à internet e não depende de CDN.
   Suporta pastas XLSX padrão (ZIP/OOXML) e planilhas com strings compartilhadas,
   strings inline, números e datas de auditoria.
*/
(function () {
  "use strict";
  const MAX_FILE = 16 * 1024 * 1024;
  const MAX_XML = 24 * 1024 * 1024;
  const decoder = new TextDecoder("utf-8");
  const isXlsx = file => /\.xlsx$/i.test(String(file && file.name || ""));
  function archive(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = at => dv.getUint16(at, true);
    const u32 = at => dv.getUint32(at, true);
    let eocd = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (u32(at) === 0x06054b50 && at + 22 + u16(at+20) <= bytes.length) { eocd=at; break; }
    }
    if (eocd < 0) throw Error("XLSX inválido: não foi encontrado o diretório ZIP.");
    if (u16(eocd + 10) > 3000) throw Error("XLSX com muitas entradas internas.");
    const total = u16(eocd + 10), offset = u32(eocd + 16);
    if (offset === 0xffffffff) throw Error("Formato ZIP64 não é aceito para esta importação.");
    const files = new Map();
    let at = offset;
    for (let i=0; i<total; i++) {
      if (at + 46 > bytes.length || u32(at) !== 0x02014b50) throw Error("Índice ZIP do XLSX danificado.");
      const flags = u16(at+8), method = u16(at+10);
      const compressed = u32(at+20), inflated = u32(at+24);
      const nameLength = u16(at+28), extraLength=u16(at+30), commentLength=u16(at+32);
      const pos = u32(at+42);
      if (at+46+nameLength+extraLength+commentLength>bytes.length) throw Error("Índice ZIP incompleto.");
      const name = decoder.decode(bytes.subarray(at+46,at+46+nameLength)).replace(/^\/+/,"");
      if ((flags & 1) && name.endsWith(".xml")) throw Error("XLSX com criptografia não é aceito.");
      if (pos !== 0xffffffff && (name.endsWith(".xml") || name.endsWith(".rels"))) files.set(name,{pos,method,compressed,inflated});
      at+=46+nameLength+extraLength+commentLength;
    }
    async function xmlText(path) {
      const file=files.get(path);
      if (!file) return "";
      if (file.inflated > MAX_XML || file.compressed > MAX_FILE) throw Error("Planilha XLSX muito grande para leitura.");
      const pos=file.pos;
      if (pos + 30 > bytes.length || u32(pos)!==0x04034b50) throw Error("Conteúdo ZIP inválido: "+path);
      const start=pos+30+u16(pos+26)+u16(pos+28);
      if (start+file.compressed>bytes.length) throw Error("Conteúdo ZIP incompleto: "+path);
      const input=bytes.subarray(start,start+file.compressed);
      let result;
      if (file.method===0) result=input;
      else if (file.method===8) {
        if (typeof DecompressionStream === "undefined") throw Error("Atualize o navegador para permitir a leitura de XLSX.");
        let stream;
        try { stream = new DecompressionStream("deflate-raw"); }
        catch (_) { throw Error("Este navegador não suporta a compactação XLSX. Use Chrome atualizado ou importe CSV."); }
        const decompressed=new Blob([input]).stream().pipeThrough(stream);
        result=new Uint8Array(await new Response(decompressed).arrayBuffer());
      } else throw Error("Compactação XLSX não suportada: "+file.method);
      if (result.byteLength>MAX_XML) throw Error("Conteúdo XLSX maior que o limite seguro.");
      return decoder.decode(result);
    }
    return {xmlText, listPaths:()=>[...files.keys()]};
  }
  function parseXml(string, name) {
    const doc=new DOMParser().parseFromString(string,"application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw Error("Estrutura XML danificada: "+name);
    return doc;
  }
  const children = (el,tag) => Array.from(el.getElementsByTagNameNS("*",tag));
  function resolvePath(path) {
    let parts=String(path||"").startsWith("/") || String(path||"").startsWith("xl/") ? [] : ["xl"];
    for (const bit of String(path||"").split("/")) {
      if (!bit || bit===".") continue;
      if (bit==="..") parts.pop();
      else parts.push(bit);
    }
    return parts.join("/");
  }
  function richValue(el) { return children(el,"t").map(t=>t.textContent||"").join(""); }
  function columnIndex(ref) {
    const code=(String(ref).match(/^[A-Z]+/i)||["A"])[0].toUpperCase();
    let num=0;for(const c of code)num=num*26+c.charCodeAt(0)-64;
    return num-1;
  }
  function worksheetRows(doc, shared) {
    const root=children(doc,"sheetData")[0];if(!root)return [];
    const out=[];
    for(const row of children(root,"row")) {
      const arr=[];
      let sequential=0;
      for(const cell of children(row,"c")) {
        const col=cell.getAttribute("r")?columnIndex(cell.getAttribute("r")):sequential;
        sequential=col+1;
        if(col<0||col>100)continue;
        const kind=cell.getAttribute("t")||"";
        const v=children(cell,"v")[0]?.textContent||"";
        let value="";
        if(kind==="inlineStr")value=richValue(cell);
        else if(kind==="s")value=shared[Number(v)]||"";
        else if(kind==="str" || kind==="e")value=v;
        else if(kind==="b")value=v==="1"?"VERDADEIRO":"FALSO";
        else value=v; // Texto preservado (inclusive Shipment ID numérico).
        arr[col]=String(value||"").trim();
      }
      if(arr.some(v=>v))out.push(arr);
      if(out.length>150000)throw Error("Planilha excede o limite de registros.");
    }
    return out;
  }
  async function read(file) {
    if (!file || !isXlsx(file))throw Error("Selecione um arquivo XLSX válido.");
    if(file.size>MAX_FILE)throw Error("Arquivo XLSX acima do limite de 16 MB.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const zip=archive(bytes);
    const workbookXml=await zip.xmlText("xl/workbook.xml");
    const relationXml=await zip.xmlText("xl/_rels/workbook.xml.rels");
    if(!workbookXml)throw Error("Não foi possível ler xl/workbook.xml. Confirme se o arquivo é uma planilha XLSX válida.");
    const workbook=parseXml(workbookXml,"workbook.xml");
    // Nem todos os exportadores preservam o índice de relacionamentos.
    // A primeira aba continua legível pelos caminhos worksheet padrão.
    const relation=relationXml ? parseXml(relationXml,"workbook.xml.rels") : null;
    const rels=new Map(relation ? children(relation,"Relationship").map(e=>[e.getAttribute("Id"),e.getAttribute("Target")]) : []);
    const settings=children(workbook,"workbookPr")[0];
    const date1904=Boolean(settings&&["1","true"].includes(settings.getAttribute("date1904")));
    const ss=await zip.xmlText("xl/sharedStrings.xml");
    const shared=ss?children(parseXml(ss,"sharedStrings.xml"),"si").map(richValue):[];
    const sheets=children(workbook,"sheet");
    if(!sheets.length)throw Error("Arquivo XLSX sem abas de planilha.");
    for(const sheet of sheets) {
      const relId=sheet.getAttribute("r:id")||sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id");
      const target=rels.get(relId);
      const paths=[
        ...(target ? [resolvePath(target)] : []),
        "xl/worksheets/sheet"+(sheet.getAttribute("sheetId")||"1")+".xml",
        ...zip.listPaths().filter(path=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      ];
      for(const path of new Set(paths)) {
        const xml=await zip.xmlText(path);
        if(!xml)continue;
        const rows=worksheetRows(parseXml(xml,"worksheet.xml"),shared);
        if(rows.length) return { rows, sheetName:sheet.getAttribute("name")||"", date1904 };
      }
    }
    throw Error("O XLSX não contém registros em nenhuma aba.");
  }
  function excelDate(value, date1904) {
    const serial=Number(value);
    if(!Number.isFinite(serial)||serial<1||serial>120000)return value;
    const date=new Date(Math.round((serial-25569+(date1904?1462:0))*86400000));
    if(!Number.isFinite(date.getTime()))return value;
    const pad=n=>String(n).padStart(2,"0");
    return pad(date.getUTCDate())+"/"+pad(date.getUTCMonth()+1)+"/"+date.getUTCFullYear()+
      " "+pad(date.getUTCHours())+":"+pad(date.getUTCMinutes())+":"+pad(date.getUTCSeconds());
  }
  function toCsv(result) {
    const rows=result.rows;
    const header=rows[0]||[];
    const normalized=header.map(h=>String(h||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim());
    const auditDateColumn=normalized.indexOf("data auditoria");
    return rows.map((row,r)=>row.map((value,c)=>{
      const item=(r>0 && c===auditDateColumn && auditDateColumn>=0 && /^\d+(\.\d+)?$/.test(String(value||"")))
        ? excelDate(value,result.date1904) : value;
      return '"'+String(item??"").replace(/"/g,'""')+'"';
    }).join(";")).join("\r\n");
  }
  window.AduanaXlsx={isXlsx,read,toCsv,version:"20261024-r3"};
})();