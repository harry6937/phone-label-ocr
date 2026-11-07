'use strict';
// Explicit labels and checksum checks; never infer a SIM slot from an unlabeled number.
(function(root) {
  const keys = ['model','memory','imei1','imei2'];
  const names = {model:'型号',memory:'内存 / 存储',imei1:'IMEI 1',imei2:'IMEI 2'};
  function validIMEI(s) {
    return /^[0-9]{15}$/.test(s) && [...s].reduce((sum,c,i)=>{const n=Number(c)*(i%2?2:1);return sum+Math.floor(n/10)+n%10;},0)%10===0;
  }
  function validate(fields) {
    const errors={},warnings=[];
    for(const k of keys) {
      const s=(fields[k]||'').trim();
      if(!s) errors[k]='未识别到，请对照原图补充';
      else if(k.startsWith('imei')) {
        if(!/^[0-9]{15}$/.test(s))errors[k]='应为 15 位数字，请核对';
        else if(!validIMEI(s))warnings.push(names[k]+' 校验位不符，请核对原图');
      }
    }
    if(fields.imei1 && fields.imei1===fields.imei2)warnings.push('IMEI 1 与 IMEI 2 相同，请核对');
    return {errors,warnings};
  }
  function extract(lines) {
    const candidates=Object.fromEntries(keys.map(k=>[k,[]]));
    lines=lines.map(l=>({...l,text:l.text.normalize('NFKC').trim()}));
    for(const line of lines) {
      const text=line.text, add=(k,v,confidence=line.confidence)=>candidates[k].push({value:v,confidence});
      const model=text.match(/(?:Xiaomi|Redmi|POCO|iPhone|Samsung\s*(?:Galaxy)?|Galaxy|HUAWEI|HONOR|OPPO|vivo|iQOO|realme|OnePlus|小米|红米|华为|荣耀|一加)[A-Za-z0-9 .+\-]*?(?=\s*\d+\s*(?:GB|TB)|[^A-Za-z0-9 .+\-]|$)/i);
      if(model && /\d/.test(model[0])) {
        const value=model[0].trim().replace(/\s+(Black|White|Blue|Green|Purple|Silver|Gold|Gray|Grey|Titanium)(\s.*)?$/i,'');
        add('model',value);
      }
      const sizes=[...text.matchAll(/(\d+)\s*(GB|TB)/gi)];
      if(sizes.length)add('memory',sizes.map(m=>m[1]+m[2].toUpperCase()).join(' + '));
      const labels=[...text.matchAll(/[I1l|]ME[I1l|]\s*([12])\s*[:：]?/gi)];
      for(let i=0;i<labels.length;i++) {
        const label=labels[i],tail=text.slice(label.index+label[0].length,labels[i+1]?.index??text.length).trim();
        const digits=tail.match(/^([0-9][0-9 \-]{9,20})(?![0-9])/);
        if(digits)add('imei'+label[1],digits[1].replace(/[ \-]/g,''));
        else if(!tail && line.box) {
          const [x,y,w,h]=line.box;
          const near=lines.filter(l=>{
            if(!l.box || !/^[0-9]{15}$/.test(l.text) || l.confidence<85 || line.confidence<85)return false;
            const [a,b,c,d]=l.box;
            return h>0 && Math.abs(b+d/2-y-h/2)<Math.min(h,d)*.55 && a-x-w>=-.01 && a-x-w<=.15;
          });
          if(near.length===1)add('imei'+label[1],near[0].text,near[0].confidence);
        }
      }
    }
    const fields={},conflicts={},low=[];
    for(const k of keys) {
      let unique=[...new Set(candidates[k].map(c=>c.value))];
      if(k==='memory') {
        const full=unique.filter(v=>v.includes(' + '));
        if(full.length===1 && unique.every(v=>v===full[0]||full[0].split(' + ').includes(v)))unique=full;
      }
      fields[k]=unique.length===1?unique[0]:'';
      if(unique.length>1)conflicts[k]='多个候选，请对照原图选择：'+unique.join(' / ');
      if(candidates[k].some(c=>c.confidence<80))low.push(names[k]+' 识别置信度偏低');
    }
    const checks=validate(fields);
    return {fields,errors:{...checks.errors,...conflicts},warnings:[...new Set([...checks.warnings,...low])]};
  }
  const api={keys,names,validIMEI,validate,extract};
  root.PhoneFields=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
