'use strict';
(function() {
  let db,ready,rows=[],paused=false,running=false,exclusive=false,fatal='';
  const urls=new Map();
  const clone=x=>structuredClone(x);
  const event=()=>window.dispatchEvent(new Event('records-changed'));
  const request=q=>new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  function transaction(stores,action) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,'readwrite');
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('保存失败'));tx.onerror=()=>{};
      action(tx);
    });
  }
  async function saveRow(row) {
    await transaction(['records'],tx=>tx.objectStore('records').put(row));
    const index=rows.findIndex(r=>r.id===row.id);if(index<0)rows.push(row);else rows[index]=row;
    event();
  }
  function storageError(error) {
    return error?.name==='QuotaExceededError' ? '浏览器存储空间不足。请先导出结果，再移除不需要的图片。' : error.message||String(error);
  }
  async function init() {
    if(!isSecureContext||!window.indexedDB||!navigator.locks)throw new Error('请使用支持 IndexedDB 和 Web Locks 的现代浏览器，通过 HTTPS 或本机测试网址打开');
    await new Promise((resolve,reject)=>{
      navigator.locks.request('phone-browser-ocr-writer',{ifAvailable:true},async lock=>{
        if(!lock){reject(new Error('此浏览器已有工作台正在使用，请关闭另一个工作台标签页后刷新'));return;}
        exclusive=true;resolve();await new Promise(()=>{});
      }).catch(reject);
    });
    const open=indexedDB.open('phone-browser-ocr-v1',1);
    open.onupgradeneeded=()=>{
      const d=open.result;d.createObjectStore('records',{keyPath:'id'});d.createObjectStore('images',{keyPath:'id'});d.createObjectStore('settings');
    };
    db=await request(open);
    db.onversionchange=()=>{db.close();fatal='页面已更新，请刷新工作台';event();};
    rows=await request(db.transaction('records').objectStore('records').getAll());
    rows.sort((a,b)=>a.created-b.created);
    paused=Boolean(await request(db.transaction('settings').objectStore('settings').get('paused')));
    for(const r of rows)if(r.status==='processing'){r.status='queued';await saveRow(r);}
    queueMicrotask(pump);
  }
  async function ensure() { if(!ready)ready=init();await ready;if(fatal)throw new Error(fatal); }
  async function image(id) {return request(db.transaction('images').objectStore('images').get(id));}
  async function state() {
    await ensure();
    const counts=new Map();
    for(const r of rows)for(const k of ['imei1','imei2']){const value=r.fields[k];if(value){if(!counts.has(value))counts.set(value,new Set());counts.get(value).add(r.id);}}
    const publicRows=[];
    for(const r of rows) {
      if(!urls.has(r.id)){const stored=await image(r.id);if(stored?.preview)urls.set(r.id,{original:URL.createObjectURL(stored.original),preview:URL.createObjectURL(stored.preview)});}
      const out=clone(r);out.image_url=urls.get(r.id)?.original||null;out.thumb_url=urls.get(r.id)?.preview||null;
      if(['imei1','imei2'].some(k=>(counts.get(r.fields[k])?.size||0)>1)) {
        out.warnings.push('IMEI 与其他图片重复，请核对是否重复导入');
        if(['success','verified'].includes(out.status))out.status='review';
      }
      publicRows.push(out);
    }
    return {records:publicRows,paused,token:'browser',engine:'Tesseract.js · 浏览器本地识别'};
  }
  async function upload(blob,filename) {
    await ensure();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const existing=rows.find(r=>r.sha256===digest);if(existing)return {id:existing.id,duplicate:true};
    const id=crypto.randomUUID();let preview=null,error='';
    try{preview=await BrowserOCR.thumbnail(blob);}catch(e){error=e.message;}
    const fields=Object.fromEntries(PhoneFields.keys.map(k=>[k,'']));
    const row={id,filename,sha256:digest,fields,status:error?'error':'queued',reviewed:false,revision:1,created:Date.now(),ocr_lines:[],history:[],errors:error?PhoneFields.validate(fields).errors:{},warnings:[],engine_error:error};
    try {
      await transaction(['records','images'],tx=>{tx.objectStore('records').put(row);tx.objectStore('images').put({id,original:blob,preview});});
      rows.push(row);event();pump();return {id,duplicate:false};
    } catch(e){throw new Error(storageError(e));}
  }
  async function mutate(path,data) {
    await ensure();
    const existing=rows.find(r=>r.id===data.id);
    if(!existing)throw new Error('记录不存在');
    if(['queued','processing'].includes(existing.status))throw new Error('请等待此图片识别完成');
    if(existing.revision!==data.revision)throw new Error('记录已更新，请重新选中后修改');
    const row=clone(existing);
    if(path==='/api/delete') {
      await transaction(['records','images'],tx=>{tx.objectStore('records').delete(row.id);tx.objectStore('images').delete(row.id);});
      rows=rows.filter(r=>r.id!==row.id);if(urls.has(row.id))Object.values(urls.get(row.id)).forEach(url=>URL.revokeObjectURL(url));urls.delete(row.id);event();return {ok:true};
    }
    row.history.push({at:Date.now(),fields:clone(row.fields),action:path==='/api/save'?'manual_save':'retry'});
    if(path==='/api/save') {
      if(PhoneFields.keys.some(k=>typeof data.fields[k]!=='string'||data.fields[k].length>150))throw new Error('字段内容无效');
      row.fields=Object.fromEntries(PhoneFields.keys.map(k=>[k,data.fields[k].trim()]));
      Object.assign(row,PhoneFields.validate(row.fields));row.engine_error='';row.reviewed=Boolean(data.reviewed);
      row.status=Object.keys(row.errors).length?'error':row.warnings.length?'review':row.reviewed?'verified':'review';
    } else if(path==='/api/retry') {
      row.status='queued';row.reviewed=false;row.engine_error='';row.errors={};row.warnings=[];
      row.fields=Object.fromEntries(PhoneFields.keys.map(k=>[k,'']));
    } else throw new Error('未知操作');
    row.revision++;await saveRow(row);pump();return {ok:true};
  }
  async function pump() {
    if(running||paused||fatal||!db)return;running=true;
    try {
      while(!paused&&!fatal) {
        const row=clone(rows.find(r=>r.status==='queued')||null);if(!row)break;
        row.status='processing';await saveRow(row);
        try {
          const stored=await image(row.id);if(!stored)throw new Error('原图不存在，请重新导入');
          Object.assign(row,await BrowserOCR.recognize(stored.original));row.engine_error='';
          row.status=Object.keys(row.errors).length?'error':row.warnings.length?'review':'success';
        } catch(e) {row.status='error';row.engine_error=storageError(e);Object.assign(row,PhoneFields.validate(row.fields));}
        row.revision++;await saveRow(row);
      }
    } catch(e) {fatal='浏览器保存失败：'+storageError(e);event();}
    finally {running=false;event();}
  }
  async function togglePause() {
    await ensure();paused=!paused;
    await transaction(['settings'],tx=>tx.objectStore('settings').put(paused,'paused'));event();pump();return paused;
  }
  window.BrowserBackend={state,upload,mutate,togglePause};
})();
