'use strict';
// Minimal OOXML with string cells. ZIP STORE avoids additional CDN dependencies.
(function() {
  const enc=new TextEncoder();
  const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc=data=>{let n=0xffffffff;for(const b of data)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
  function zip(files) {
    const chunks=[],directory=[];let offset=0,dirSize=0;
    for(const [name,text] of Object.entries(files)) {
      const data=enc.encode(text),path=enc.encode(name),checksum=crc(data);
      const header=new Uint8Array(30),h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,checksum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,path.length,true);
      const central=new Uint8Array(46),c=new DataView(central.buffer);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,checksum,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);
      chunks.push(header,path,data);directory.push(central,path);offset+=header.length+path.length+data.length;dirSize+=central.length+path.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer),count=Object.keys(files).length;
    e.setUint32(0,0x06054b50,true);e.setUint16(8,count,true);e.setUint16(10,count,true);e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
    return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function sheet(rows) {
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="5" width="26" customWidth="1"/></cols><sheetData>'+rows.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')+'</sheetData></worksheet>';
  }
  function create(records) {
    const main=[['型号','内存 / 存储','IMEI 1','IMEI 2']],audit=[['结果行号','原图文件','状态','人工已核对','错误 / 待核对原因']];
    const names={success:'识别成功',verified:'已核对',review:'待核对',error:'识别错误',queued:'等待识别',processing:'识别中'};
    records.forEach((r,i)=>{main.push(PhoneFields.keys.map(k=>r.fields[k]||''));audit.push([String(i+2),r.filename,names[r.status],r.reviewed?'是':'否',[...Object.values(r.errors),...r.warnings,r.engine_error].filter(Boolean).join('；')]);});
    return zip({
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="识别结果" sheetId="1" r:id="rId1"/><sheet name="核对记录" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':sheet(main),'xl/worksheets/sheet2.xml':sheet(audit)
    });
  }
  window.BrowserExcel={create};
})();
