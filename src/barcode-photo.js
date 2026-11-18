// Keep the original image resolution for a small label in a large laptop photo.
export async function readBarcodePhoto(image, decodeCanvas, isActive, region = null) {
  const area = region || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const base=document.createElement('canvas'),ctx=base.getContext('2d',{willReadFrequently:true});
  const scale=Math.min(region ? 3 : 1,2200/Math.max(area.width,area.height));
  const width=Math.max(1,Math.round(area.width*scale)),height=Math.max(1,Math.round(area.height*scale));
  // Try both orientations and small tilts; no missing bars are invented.
  for(const angle of (region ? [0,90,-5,5,85,95,85.5,94.5,-4.5,4.5,-4,4,86,94,-6,6,84,96,-10,10,80,100,180,270] : [0,90])) {
    if(!isActive())return null;
    const radians=angle*Math.PI/180,sin=Math.abs(Math.sin(radians)),cos=Math.abs(Math.cos(radians));
    base.width=Math.ceil(width*cos+height*sin)+48;base.height=Math.ceil(width*sin+height*cos)+48;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,base.width,base.height);
    ctx.translate(base.width/2,base.height/2);ctx.rotate(radians);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(image,area.x,area.y,area.width,area.height,-width/2,-height/2,width,height);
    for(const contrast of [false,true]) {
      if(contrast){const pixels=ctx.getImageData(0,0,base.width,base.height);for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++)pixels.data[i+c]=(pixels.data[i+c]-128)*1.7+128;}ctx.putImageData(pixels,0,0);}
      try{return decodeCanvas(base).getText();}catch{}
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return null;
}

export function barcodePhotoEditor(container,image,onRead) {
  container.innerHTML=`<p>Geser jari membentuk kotak di sekeliling <b>seluruh label barcode</b>, lalu tekan Baca area label. Sertakan ruang putih di ujung garis.</p><canvas data-photo-crop aria-label="Pilih area label barcode pada foto"></canvas><p data-photo-selection role="status">Belum memilih area label.</p><button type="button" class="small-btn" data-photo-read disabled>Baca area label</button>`;
  const canvas=container.querySelector('canvas'),ctx=canvas.getContext('2d'),button=container.querySelector('button'),hint=container.querySelector('[data-photo-selection]');
  const scale=Math.min(1,850/image.naturalWidth);canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
  let anchor,selection;
  const draw=()=>{ctx.drawImage(image,0,0,canvas.width,canvas.height);if(selection){ctx.strokeStyle='#00e676';ctx.lineWidth=3;ctx.strokeRect(selection.x,selection.y,selection.width,selection.height);}};
  const position=event=>{const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};};
  canvas.onpointerdown=event=>{event.preventDefault();anchor=position(event);canvas.setPointerCapture(event.pointerId);selection=null;button.disabled=true;draw();};
  canvas.onpointermove=event=>{if(!anchor)return;const end=position(event);selection={x:Math.min(anchor.x,end.x),y:Math.min(anchor.y,end.y),width:Math.abs(end.x-anchor.x),height:Math.abs(end.y-anchor.y)};draw();};
  const finish=()=>{anchor=null;button.disabled=!selection || selection.width<10 || selection.height<10;hint.textContent=button.disabled?'Pilih area label lebih besar.':'Area label dipilih. Tekan Baca area label.';};
  canvas.onpointerup=finish;canvas.onpointercancel=()=>{anchor=null;};
  button.onclick=async()=>{
    if(button.disabled || !selection)return;
    button.disabled=true;
    const sx=image.naturalWidth/canvas.width,sy=image.naturalHeight/canvas.height;
    try{await onRead({x:selection.x*sx,y:selection.y*sy,width:selection.width*sx,height:selection.height*sy});}finally{button.disabled=false;}
  };
  draw();
}
