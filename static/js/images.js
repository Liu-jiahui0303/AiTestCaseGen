// ── 图片粘贴（千问多模态） ──
// ── 图片粘贴 & 拖拽（千问多模态） ──
let _pastedImages=[],_previewIndex=-1;
function handleImagePaste(e){
  const cd=e.clipboardData||(e.originalEvent&&e.originalEvent.clipboardData);
  if(!cd||!cd.files||!cd.files.length)return;
  const f=cd.files[0];
  if(!f.type.startsWith('image/'))return;
  e.preventDefault();
  const reader=new FileReader();
  reader.onload=function(ev){_pastedImages.push({dataUrl:ev.target.result,name:f.name||'paste.png'});renderImageThumbnails();};
  reader.readAsDataURL(f);
}
function handleImageDragOver(e){e.preventDefault();}
function handleImageDrop(e){
  e.preventDefault();
  if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
  const files=Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'));
  if(!files.length)return;
  let loaded=0;
  files.forEach(f=>{
    const reader=new FileReader();
    reader.onload=function(ev){_pastedImages.push({dataUrl:ev.target.result,name:f.name||'drop.png'});loaded++;if(loaded===files.length)renderImageThumbnails();};
    reader.readAsDataURL(f);
  });
}
function removeImage(index){_pastedImages.splice(index,1);renderImageThumbnails();}
function renderImageThumbnails(){
  const scroll=document.getElementById('imageScroll'),ph=document.getElementById('imagePlaceholder');
  document.getElementById('imageCount').textContent=_pastedImages.length;
  ph.style.display=_pastedImages.length?'none':'';
  scroll.querySelectorAll('.img-thumb').forEach(el=>el.remove());
  _pastedImages.forEach((img,i)=>{
    const div=document.createElement('div');
    div.className='img-thumb';
    div.innerHTML='<button class="img-thumb-del" onclick="event.stopPropagation();removeImage('+i+')">✕</button><img src="'+img.dataUrl+'" alt="图片'+(i+1)+'" onclick="openImgPreview('+i+')">';
    scroll.appendChild(div);
  });
}
function openImgPreview(index){_previewIndex=index;updateImgPreview();document.getElementById('imgPreviewModal').style.display='';}
function closeImgPreview(){document.getElementById('imgPreviewModal').style.display='none';_previewIndex=-1;}
function navigateImage(dir){const n=_previewIndex+dir;if(n>=0&&n<_pastedImages.length){_previewIndex=n;updateImgPreview();}}
function updateImgPreview(){
  if(_previewIndex<0||_previewIndex>=_pastedImages.length)return;
  document.getElementById('imgPreviewImg').src=_pastedImages[_previewIndex].dataUrl;
  document.getElementById('imgPreviewCounter').textContent=(_previewIndex+1)+' / '+_pastedImages.length;
  document.getElementById('imgPreviewPrev').style.display=_previewIndex>0?'':'none';
  document.getElementById('imgPreviewNext').style.display=_previewIndex<_pastedImages.length-1?'':'none';
}

