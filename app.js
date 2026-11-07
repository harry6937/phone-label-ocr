'use strict';
if (window.location.protocol === 'file:') {
  document.body.innerHTML = `<main class="launch-guide"><div class="launch-card"><h1>请通过测试网址打开浏览器版</h1><p>浏览器 OCR 需要 HTTPS 或本机网页地址来加载识别引擎。这里无需运行 Mac 识别服务。</p><a class="button primary" href="http://127.0.0.1:8890/">打开浏览器 OCR 测试版</a><p>发布后可以直接通过网站地址使用。</p></div></main>`;
} else {
const $ = id => document.getElementById(id);
const icons = {
  scan:'M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 8h10M7 12h10M7 16h6',
  plus:'M12 5v14M5 12h14',minus:'M5 12h14',arrow:'M4 12h16m-6-6 6 6-6 6',
  upload:'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  download:'M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  images:'M8 3h12a1 1 0 0 1 1 1v12M3 8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1ZM3 17l4-4 4 4 2-2 4 4M12 11h.01',
  check:'M20 11v1a8 8 0 1 1-5-7M8 11l4 4 9-10',
  clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  alert:'M12 7v6m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  cpu:'M7 7h10v10H7ZM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
  search:'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  sliders:'M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6',
  left:'m14 6-6 6 6 6',right:'m10 6 6 6-6 6',rotate:'M3 9h5M3 9V4m0 5a9 9 0 1 1 0 7',
  expand:'M14 3h7v7m0-7-9 9M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6'
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.images}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = svg(el.dataset.icon));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {queued:'等待识别',processing:'识别中',success:'识别成功',review:'待核对',error:'识别错误',verified:'已核对'};
const keys = ['model','memory','imei1','imei2'];
let records = [], token = '', selected = null, filter = 'all', dirty = false, editRevision = null;
let uploading = false, saving = false, fetching = false, connected = false, zoom = 1, angle = 0, toastTimer;
const current = () => records.find(r => r.id === selected);
const working = r => ['queued','processing'].includes(r.status);

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500);
}
function ask(message) {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog');
    $('confirm-message').textContent = message;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), {once:true});
    dialog.showModal();
  });
}
async function request(path, options = {}) {
  if(path==='/api/state') return BrowserBackend.state();
  if(path==='/api/upload') return BrowserBackend.upload(options.body,decodeURIComponent(options.headers['X-Filename']));
  return BrowserBackend.mutate(path,JSON.parse(options.body));
}
const post = (path, value) => request(path, {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
function visible() {
  const query = $('search').value.toLowerCase().trim();
  return records.filter(r => (filter === 'all' || r.status === filter) && (!query || [r.filename,...Object.values(r.fields)].join(' ').toLowerCase().includes(query)));
}
function renderStats() {
  const count = status => records.filter(r => r.status === status).length;
  $('count-all').textContent = records.length;
  $('count-success').textContent = count('success') + count('verified');
  $('count-review').textContent = count('review');
  $('count-error').textContent = count('error');
  const pending = records.filter(working).length, done = records.length - pending;
  $('progress-title').textContent = uploading ? '正在导入图片…' : pending ? '正在浏览器识别…' : records.length ? '本批次识别完成' : '等待导入图片';
  $('progress-count').textContent = `${done} / ${records.length}`;
  $('progress-bar').style.width = `${records.length ? done / records.length * 100 : 0}%`;
  $('progress-caption').textContent = pending ? `还有 ${pending} 张 · 可先核对已完成的图片` : records.length ? '结果已保存，可继续人工核对或导出' : '导入后自动开始识别';
  $('export').disabled = !connected || !records.length || !!pending || uploading || saving;
  $('result-count').textContent = records.length;
}
function renderTable() {
  const rows = visible();
  $('rows').innerHTML = rows.map(r => {
    const value = key => r.fields[key] ? `<span title="${esc(r.errors[key] || '')}" class="${r.errors[key] ? 'field-error' : ''}">${esc(r.fields[key])}</span>` : `<span class="${working(r) ? 'missing-value' : 'field-error'}">${working(r) ? '—' : '识别错误'}</span>`;
    return `<tr tabindex="0" data-id="${r.id}" aria-selected="${r.id === selected}" class="${r.id === selected ? 'selected' : ''}"><td>${String(records.indexOf(r)+1).padStart(2,'0')}</td><td>${r.image_url ? `<img class="thumb" src="${r.thumb_url || r.image_url}" alt="${esc(r.filename)}" loading="lazy">` : `<span class="thumb-placeholder">${svg('images')}</span>`}</td><td class="model-cell"><span class="model-text">${value('model')}</span><span class="file-text" title="${esc(r.filename)}">${esc(r.filename)}</span></td><td>${value('memory')}</td><td class="imei-cell">${value('imei1')}</td><td class="imei-cell">${value('imei2')}</td><td><span class="badge ${r.status}">${labels[r.status]}</span></td></tr>`;
  }).join('');
  $('table-empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('table-empty').querySelector('h4').textContent = records.length ? '没有符合条件的记录' : '从第一张照片开始';
    $('table-empty').querySelector('p').textContent = records.length ? '试试切换筛选条件，或搜索其他型号、IMEI。' : '批量导入手机盒标签照片，识别结果会显示在这里。';
    $('import-empty').hidden = !!records.length;
  }
  $('table-summary').textContent = `共 ${records.length} 条 · 当前显示 ${rows.length} 条`;
}
function resetImage() { zoom = 1; angle = 0; applyZoom(); $('image-stage').scrollTo(0,0); }
function applyZoom(anchor) {
  const stage = $('image-stage'), img = $('preview'), canvas = $('image-canvas');
  if (!stage.clientWidth || !stage.clientHeight || !img.naturalWidth) return;
  const x = anchor?.x ?? stage.clientWidth/2, y = anchor?.y ?? stage.clientHeight/2;
  const oldWidth = canvas.offsetWidth || stage.clientWidth, oldHeight = canvas.offsetHeight || stage.clientHeight;
  const positionX = (stage.scrollLeft + x) / oldWidth, positionY = (stage.scrollTop + y) / oldHeight;
  const rotated = angle % 180 !== 0;
  const naturalW = rotated ? img.naturalHeight : img.naturalWidth, naturalH = rotated ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(stage.clientWidth/naturalW, stage.clientHeight/naturalH) * zoom;
  const w = Math.max(stage.clientWidth, naturalW*scale), h = Math.max(stage.clientHeight, naturalH*scale);
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  img.style.width = `${img.naturalWidth*scale}px`; img.style.height = `${img.naturalHeight*scale}px`;
  img.style.left = `${(w-img.naturalWidth*scale)/2}px`; img.style.top = `${(h-img.naturalHeight*scale)/2}px`;
  img.style.transform = `rotate(${angle}deg)`;
  stage.scrollLeft = positionX*w-x; stage.scrollTop = positionY*h-y;
  if(document.activeElement !== $('zoom-label')) $('zoom-label').value = Math.round(zoom*100);
}
function setZoom(value, anchor) {
  if (!Number.isFinite(value) || value < .25) { $('zoom-label').value = Math.round(zoom*100); return; }
  zoom = value; applyZoom(anchor);
}
$('preview').addEventListener('load', () => {applyZoom();$('image-stage').scrollTo(0,0);});
new ResizeObserver(() => applyZoom()).observe($('image-stage'));
// Reuse the very same form and viewer: opening/closing never copies or loses a draft.
const reviewNodes = ['.image-heading','#image-stage','.image-tools','#record-notice','#edit-form','#toast'].map(selector => {
  const node = document.querySelector(selector), home = document.createComment('review-home');
  node.before(home); return {node,home};
});
function openReview() {
  const r = current(); if (!r?.image_url) return;
  for (const {node} of reviewNodes) {
    const target = ['image-stage'].includes(node.id) || node.classList.contains('image-tools') ? $('large-image-panel') : node.id === 'toast' ? $('lightbox') : $('large-edit-panel');
    target.appendChild(node);
  }
  $('lightbox-name').textContent = r.filename;
  $('lightbox').showModal(); document.body.classList.add('review-open');
  applyZoom();
}
$('lightbox').addEventListener('close', () => {
  for (const {node,home} of reviewNodes) home.after(node);
  document.body.classList.remove('review-open'); applyZoom(); $('original').focus();
});
function renderEditor(force = false) {
  const r = current();
  $('editor').hidden = !r; $('editor-empty').hidden = !!r;
  if (!r) { $('editor-caption').textContent = '选中记录后即可开始核对'; return; }
  const subset = visible(), index = subset.findIndex(x => x.id === r.id);
  $('filename').textContent = r.filename;
  $('filename').title = r.filename;
  $('lightbox-name').textContent = r.filename;
  $('image-index').textContent = index >= 0 ? `${index+1} / ${subset.length}` : '已筛出';
  $('prev').disabled = index <= 0;
  $('next').disabled = index < 0 || index >= subset.length-1;
  $('editor-caption').textContent = dirty ? '有未保存的修改' : '放大原图，逐项核对识别结果';
  const src = r.image_url || '';
  if ($('preview').getAttribute('src') !== src) {
    if (src) $('preview').src = src; else $('preview').removeAttribute('src');
    resetImage();
  }
  $('preview').hidden = !src;
  $('image-placeholder').hidden = !!src;
  $('image-placeholder').textContent = working(r) ? '正在生成图片预览…' : '图片无法预览，可移除后重新导入';
  for (const id of ['zoom-in','zoom-out','zoom-label','zoom-fit','rotate','original']) $(id).disabled = !src;
  const issues = [...Object.values(r.errors),...r.warnings];
  if (r.engine_error) issues.unshift(r.engine_error);
  $('record-notice').className = 'record-notice '+r.status;
  $('record-notice').textContent = working(r) ? '正在浏览器识别这张图片，完成后可修改。' : issues.length ? [...new Set(issues)].join('；') : r.reviewed ? '已人工核对并保存。仍可继续修改。' : '识别完成。请对照原图核对，确认后勾选“已核对”。';
  if (force || (!dirty && editRevision !== r.revision)) {
    keys.forEach(k => $(k).value = r.fields[k] || '');
    $('reviewed').checked = r.reviewed;
    editRevision = r.revision;
  }
  keys.forEach(k => {
    $(k).disabled = working(r) || saving;
    $(k).classList.toggle('invalid', !!r.errors[k]);
    $(k+'-error').textContent = r.errors[k] || '';
  });
  for (const id of ['save','save-next','retry','delete','reviewed']) $(id).disabled = working(r) || saving;
  $('ocr-text').textContent = r.ocr_lines.map(line => line.text).join('\n') || '暂无识别文字';
  $('save-state').textContent = dirty ? '● 有未保存的修改' : '修改后请保存';
  $('save-state').classList.toggle('unsaved', dirty);
}
async function canLeave() { return !dirty || await ask('当前修改尚未保存。放弃修改并切换？'); }
async function select(id) {
  if (id === selected) return;
  if (!await canLeave()) return;
  dirty = false; selected = id; editRevision = null; resetImage(); renderTable(); renderEditor(true);
}
async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const data = await request('/api/state');
    records = data.records; token = data.token; connected = true;
    $('connection').innerHTML = '<i></i> 浏览器运行 · 图片不上传';
    $('pause-queue').textContent = data.paused ? '继续识别' : '暂停队列';
    $('startup-error').hidden = true;
    if (!selected && records.length) selected = records[0].id;
    if (selected && !current()) {selected = records[0]?.id || null; dirty = false; editRevision = null;}
    renderStats(); renderTable(); renderEditor();
    if(!records.some(r=>r.status==='processing')) {
      $('engine-status').textContent = data.paused ? '队列已暂停 · 点击继续识别恢复' : records.some(working) ? '正在准备下一张…' : records.length ? '浏览器识别已完成 · 请对照原图核对结果' : '浏览器 OCR 测试版 · 首次识别需加载模型';
    }
    if(data.paused && records.some(working)) $('progress-title').textContent = '队列已暂停';
  } catch (error) {
    connected = false;
    $('connection').textContent = '浏览器工作台暂不可用';
    $('progress-title').textContent = '请查看页面提示';
    $('startup-error').textContent = error.message; $('startup-error').hidden = false;
    $('export').disabled = true;
  } finally { fetching = false; }
}
async function upload(files) {
  if (uploading) return toast('当前图片正在导入，请稍后再添加');
  if (!connected) return toast('浏览器存储尚未就绪，请查看页面提示');
  files = Array.from(files); if (!files.length) return;
  uploading = true; renderStats();
  let added = 0, skipped = 0; const failed = [];
  $('upload-feedback').hidden = false;
  try {
    for (let i=0; i<files.length; i++) {
      const file = files[i];
      $('upload-feedback').textContent = `正在导入 ${i+1} / ${files.length}：${file.name}`;
      try {
        if (!/\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(file.name)) throw new Error('不支持的图片格式');
        if (!file.size || file.size > 30*1024*1024) throw new Error('文件为空或超过 30 MB');
        const result = await request('/api/upload', {method:'POST', headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)}, body:file});
        if (result.duplicate) skipped++; else added++;
      } catch (error) { failed.push(`${file.name}：${error.message}`); }
      await refresh();
    }
  } finally {
    uploading = false; $('file-input').value = '';
    $('upload-feedback').textContent = `导入完成：新增 ${added} 张，跳过重复 ${skipped} 张${failed.length ? `，导入失败 ${failed.length} 张\n${failed.join('\n')}` : '。识别结果会自动显示。'}`;
    await refresh();
  }
}
async function save(next = false) {
  const r = current(); if (!r || working(r) || saving) return false;
  const subset = visible(), index = subset.findIndex(x => x.id === r.id);
  const followingIds = subset.slice(index+1).map(row => row.id);
  saving = true;
  const fields = Object.fromEntries(keys.map(k => [k,$(k).value.trim()]));
  const reviewed = $('reviewed').checked;
  renderEditor();
  try {
    await post('/api/save',{id:r.id,revision:editRevision,fields,reviewed});
    dirty = false; editRevision = null;
    await refresh();
    const nextId = followingIds.find(id => records.some(row => row.id === id && ['review','error'].includes(row.status)));
    if (next && nextId) await select(nextId);
    toast(next && !nextId ? '已保存，当前列表后面没有待核对或识别错误的图片' : '已保存到此浏览器');
    return true;
  } catch (error) {toast(error.message); return false;}
  finally {saving = false; renderEditor(); renderStats();}
}
$('rows').addEventListener('click', event => {const row = event.target.closest('tr[data-id]'); if(row) select(row.dataset.id);});
$('rows').addEventListener('keydown', event => {if (['Enter',' '].includes(event.key)) {event.preventDefault(); select(event.target.closest('tr[data-id]')?.dataset.id);}});
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  filter = tab.dataset.filter;
  document.querySelectorAll('.tab').forEach(t => {t.classList.toggle('active',t===tab);t.setAttribute('aria-selected',String(t===tab));});
  renderTable();renderEditor();
}));
$('search').addEventListener('input', () => {renderTable();renderEditor();});
['import-top','import-empty','dropzone'].forEach(id => $(id).addEventListener('click', () => $('file-input').click()));
$('file-input').addEventListener('change', e => upload(e.target.files));
for (const type of ['dragenter','dragover']) $('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
for (const type of ['dragleave','drop']) $('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragover');});
$('dropzone').addEventListener('drop',e=>upload(e.dataTransfer.files));
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>e.preventDefault());
$('edit-form').addEventListener('input', event => {dirty = true; if(event.target.id !== 'reviewed') $('reviewed').checked = false; renderEditor();});
$('edit-form').addEventListener('submit', e => {e.preventDefault();save();});
$('save-next').addEventListener('click',()=>save(true));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();save();}});
window.addEventListener('beforeunload',e=>{if(dirty||uploading||records.some(working)){e.preventDefault();e.returnValue='';}});
['prev','next'].forEach(id=>$(id).addEventListener('click',()=>{const list=visible(),i=list.findIndex(r=>r.id===selected);select(list[i+(id==='prev'?-1:1)]?.id || selected);}));
$('zoom-in').addEventListener('click',()=>setZoom(zoom+.25));
$('zoom-out').addEventListener('click',()=>setZoom(Math.max(.25,zoom-.25)));
$('zoom-label').addEventListener('change',event=>setZoom(Number(event.target.value)/100));
$('zoom-label').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();setZoom(Number(event.target.value)/100);event.target.blur();}});
$('zoom-fit').addEventListener('click',()=>{setZoom(1);$('image-stage').scrollTo(0,0);});
$('rotate').addEventListener('click',()=>{angle=(angle+90)%360;applyZoom();});
let pan = null;
$('image-stage').addEventListener('pointerdown',e=>{if(e.button!==0)return;pan={x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};e.currentTarget.setPointerCapture(e.pointerId);});
$('image-stage').addEventListener('pointermove',e=>{if(pan){e.currentTarget.scrollLeft=pan.left-(e.clientX-pan.x);e.currentTarget.scrollTop=pan.top-(e.clientY-pan.y);}});
$('image-stage').addEventListener('pointerup',()=>pan=null);
$('image-stage').addEventListener('pointercancel',()=>pan=null);
$('image-stage').addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();setZoom(Math.max(.25,zoom*(event.deltaY<0?1.1:1/1.1)),{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
$('original').addEventListener('click',openReview);
$('close-lightbox').addEventListener('click',()=>$('lightbox').close());
$('retry').addEventListener('click',async()=>{
  const r=current();if(!r||!await ask('重新识别会替换此条当前结果。原结果会保留在浏览器修改历史中。继续？'))return;
  try{await post('/api/retry',{id:r.id,revision:r.revision});dirty=false;editRevision=null;await refresh();toast('已加入识别队列');}catch(e){toast(e.message);}
});
$('delete').addEventListener('click',async()=>{
  const r=current();if(!r||!await ask(`移除“${r.filename}”及其浏览器内副本和识别记录？不会修改你原来的图片文件。`))return;
  try{await post('/api/delete',{id:r.id,revision:r.revision});dirty=false;selected=null;editRevision=null;await refresh();toast('已移除记录');}catch(e){toast(e.message);}
});
$('export').addEventListener('click',async()=>{
  if(dirty){if(!await ask('当前修改尚未保存，先保存再导出？'))return;if(!await save())return;}
  const unreviewed=records.filter(r=>!r.reviewed||['review','error'].includes(r.status)).length;
  if(unreviewed&&!await ask(`有 ${unreviewed} 条未完成人工核对或仍有异常。导出将保留全部记录，并在“核对记录”工作表标明状态。继续导出？`))return;
  try{
    const state=await BrowserBackend.state();
    if(state.records.some(working))throw new Error('请等待识别完成再导出');
    const url=URL.createObjectURL(BrowserExcel.create(state.records)),a=document.createElement('a');
    a.href=url;a.download=`手机识别结果-${new Date().toLocaleDateString('sv-SE')}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Excel 已生成，请查看浏览器下载');
  }catch(e){toast(e.message);}
});
let refreshTimer;
window.addEventListener('records-changed',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,100);});
window.addEventListener('ocr-progress',event=>$('engine-status').textContent=event.detail);
$('pause-queue').addEventListener('click',async()=>{try{const paused=await BrowserBackend.togglePause();toast(paused?'已暂停队列，当前图片识别完成后停止':'已继续识别');await refresh();}catch(e){toast(e.message);}});
refresh();setInterval(refresh,2000);
}
