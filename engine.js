'use strict';
(function() {
  let worker=null, rejectWorker=null;
  const report=message=>window.dispatchEvent(new CustomEvent('ocr-progress',{detail:message}));
  async function withTimeout(task,ms=120000) {
    let timer;
    try{return await Promise.race([task,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('识别超时，请重试或缩小图片')),ms))]);}
    finally{clearTimeout(timer);}
  }
  async function getWorker() {
    if(worker){await worker.reinitialize(['eng','chi_sim']);await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'300'});return worker;}
    if(!window.Tesseract)throw new Error('OCR 引擎文件加载失败，请刷新网页');
    report('正在加载浏览器 OCR 引擎和中英文模型…');
    worker=await withTimeout(Tesseract.createWorker(['eng','chi_sim'],1,{
      workerPath:new URL('./worker.min.js',location.href).href,
      corePath:new URL('./',location.href).href,
      langPath:new URL('./',location.href).href.replace(/\/$/,''),
      workerBlobURL:false,
      logger:m=>{if(m.status==='recognizing text')report('正在识别文字 '+Math.round(m.progress*100)+'%');},
      errorHandler:error=>{if(rejectWorker)rejectWorker(new Error(String(error)));}
    }));
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'300'});
    return worker;
  }
  async function decode(blob) {
    const url=typeof blob==='string'?blob:URL.createObjectURL(blob),image=new Image();
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('此浏览器无法读取图片，请将 HEIC 等格式转换为 JPG / PNG 后重试'));image.src=url;});
      return image;
    } finally {if(typeof blob!=='string')URL.revokeObjectURL(url);}
  }
  function canvasFor(image,degrees=0,max=2600) {
    const factor=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
    const w=Math.round(image.naturalWidth*factor),h=Math.round(image.naturalHeight*factor),side=degrees%180!==0;
    const c=document.createElement('canvas');c.width=side?h:w;c.height=side?w:h;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
    ctx.translate(c.width/2,c.height/2);ctx.rotate(degrees*Math.PI/180);ctx.drawImage(image,-w/2,-h/2,w,h);
    return c;
  }
  async function thumbnail(blob) {
    const image=await decode(blob),canvas=canvasFor(image,0,2200);
    try{return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('生成预览失败')),'image/jpeg',.9));}
    finally{canvas.width=canvas.height=1;}
  }
  function linesFrom(data,width,height) {
    const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    return lines.map(l=>({text:l.text.trim(),confidence:l.confidence,box:[l.bbox.x0/width,l.bbox.y0/height,(l.bbox.x1-l.bbox.x0)/width,(l.bbox.y1-l.bbox.y0)/height]}));
  }
  const score=r=>Object.values(r.fields).filter(Boolean).length*10+['imei1','imei2'].filter(k=>PhoneFields.validIMEI(r.fields[k])).length*25-Object.keys(r.errors).length*4;
  async function recognize(blob) {
    const start=performance.now(),image=await decode(blob);
    let best=null;
    try {
      const active=await getWorker();
      for(const degrees of [0,90,270,180]) {
        report(`识别图片方向 ${degrees}°…`);
        const canvas=canvasFor(image,degrees);
        try {
          const failed=new Promise((_,reject)=>rejectWorker=reject);
          const result=await withTimeout(Promise.race([active.recognize(canvas,{rotateAuto:true},{text:true,blocks:true}),failed]));
          const lines=linesFrom(result.data,canvas.width,canvas.height);
          const parsed={...PhoneFields.extract(lines),ocr_lines:lines,rotation:degrees};
          if(!best||score(parsed)>score(best))best=parsed;
          if(Object.keys(parsed.errors).length===0 && ['imei1','imei2'].every(k=>PhoneFields.validIMEI(parsed.fields[k])))break;
          if(parsed.fields.model && parsed.fields.memory)break;
        } finally {canvas.width=canvas.height=1;rejectWorker=null;}
      }
      // Small label text can disappear in full-frame segmentation. Inspect overlapping
      // enlarged regions in the detected orientation without guessing missing digits.
      if(best && (!PhoneFields.validIMEI(best.fields.imei1)||!PhoneFields.validIMEI(best.fields.imei2))) {
        const full=canvasFor(image,best.rotation),extra=[];
        try {
          await active.reinitialize('eng');
          await active.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'300'});
          for(const [fx,fy] of [[.42,0],[.42,.42],[0,0],[0,.42]]) {
            report('正在放大检查小字与 IMEI…');
            const x=Math.floor(full.width*fx),y=Math.floor(full.height*fy),w=Math.min(full.width-x,Math.ceil(full.width*.58)),h=Math.min(full.height-y,Math.ceil(full.height*.58));
            const crop=document.createElement('canvas');crop.width=w*2;crop.height=h*2;
            crop.getContext('2d').drawImage(full,x,y,w,h,0,0,crop.width,crop.height);
            try {
              const data=(await withTimeout(active.recognize(crop,{rotateAuto:true},{text:true,blocks:true,imageColor:true}))).data;
              const lines=linesFrom(data,crop.width,crop.height);
              // Re-read number-heavy lines as single text lines so barcodes do not
              // suppress the tiny IMEI labels. Use the deskewed image's coordinates.
              const possible=lines.filter(l=>(l.text.match(/\d/g)||[]).length>=10).slice(0,8);
              if(possible.length && data.imageColor) {
                const straight=await decode(data.imageColor);
                await active.setParameters({tessedit_pageseg_mode:'7'});
                for(const line of possible) {
                  const [bx,by,bw,bh]=line.box;
                  const sx=Math.max(0,Math.floor((bx-.08)*crop.width)),sy=Math.max(0,Math.floor((by-bh*.22)*crop.height));
                  const sw=Math.min(crop.width-sx,Math.ceil((bw+.1)*crop.width)),sh=Math.min(crop.height-sy,Math.ceil(bh*1.44*crop.height));
                  if(sw<=0||sh<=0)continue;
                  const strip=document.createElement('canvas');strip.width=sw*2;strip.height=sh*2;
                  strip.getContext('2d').drawImage(straight,sx,sy,sw,sh,0,0,strip.width,strip.height);
                  try{
                    const reread=(await withTimeout(active.recognize(strip,{}, {text:true,blocks:true}))).data;
                    const rereadLines=linesFrom(reread,strip.width,strip.height);lines.push(...rereadLines);
                    const parsed=PhoneFields.extract(rereadLines);
                    if(!['imei1','imei2'].some(k=>PhoneFields.validIMEI(parsed.fields[k]))) {
                      await active.setParameters({tessedit_pageseg_mode:'13'});
                      const raw=(await withTimeout(active.recognize(strip,{}, {text:true,blocks:true}))).data;
                      lines.push(...linesFrom(raw,strip.width,strip.height));
                      await active.setParameters({tessedit_pageseg_mode:'7'});
                    }
                  }
                  finally{strip.width=strip.height=1;}
                }
                await active.setParameters({tessedit_pageseg_mode:'11'});
              }
              extra.push(...lines);
              const candidate=PhoneFields.extract(lines);
              for(const key of ['imei1','imei2']) {
                if(!PhoneFields.validIMEI(candidate.fields[key]))continue;
                if(!best.fields[key]||!PhoneFields.validIMEI(best.fields[key])){best.fields[key]=candidate.fields[key];delete best.errors[key];}
                else if(best.fields[key]!==candidate.fields[key]){best.errors[key]='不同区域识别结果不一致，请人工核对';}
                best.warnings.push(...candidate.warnings.filter(w=>w.startsWith(PhoneFields.names[key])));
              }
              if(['imei1','imei2'].every(k=>PhoneFields.validIMEI(best.fields[k])))break;
            } finally {crop.width=crop.height=1;}
          }
          best.ocr_lines.push(...extra);
          const checks=PhoneFields.validate(best.fields);
          best.errors={...best.errors,...checks.errors};
          best.warnings=[...new Set([...best.warnings.filter(w=>!w.includes('校验位')), ...checks.warnings])];
        } finally {full.width=full.height=1;}
      }
      return {...best,elapsed_ms:Math.round(performance.now()-start)};
    } catch(error) {
      if(worker)await worker.terminate().catch(()=>{});
      worker=null;throw error;
    }
  }
  window.BrowserOCR={thumbnail,recognize};
})();
