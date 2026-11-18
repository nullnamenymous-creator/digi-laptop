// Software decoding also works in browsers without the BarcodeDetector API.
let currentScanner;

export async function startCameraScanner(host, input, formats, onDetected, notify) {
  currentScanner?.();
  if (!host?.isConnected || !input?.isConnected) return;
  let active = true, stream, timer, observer;
  host.innerHTML = `<section class="barcode-scanner"><p data-scan-status role="status">Arahkan barcode ke kamera. Pastikan seluruh garis terlihat dan label cukup terang.</p><div class="camera-wrap"><video autoplay playsinline muted></video></div><div class="actions-cell"><button type="button" class="small-btn" data-scan-flip>Ganti kamera</button><button type="button" class="small-btn" data-scan-torch hidden>Lampu</button><label class="small-btn">Scan foto<input type="file" accept="image/*" capture="environment" data-scan-photo hidden /></label><button type="button" class="small-btn" data-scan-stop>Tutup pemindai</button></div></section>`;
  const panel = host.firstElementChild, video = panel.querySelector('video'), status = panel.querySelector('[data-scan-status]');
  video.muted = true;
  const releaseCamera = () => { clearTimeout(timer); stream?.getTracks().forEach(track=>track.stop()); stream = null; video.srcObject = null; };
  const stop = () => {
    if (!active) return;
    active = false; releaseCamera(); observer?.disconnect();
    window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', onHidden);
    if (currentScanner === stop) currentScanner = null;
    panel.remove();
  };
  const onHidden = () => { if (document.hidden) stop(); };
  currentScanner = stop;
  observer = new MutationObserver(()=>{ if(!panel.isConnected || !input.isConnected)stop(); });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',stop); document.addEventListener('visibilitychange',onHidden);
  panel.querySelector('[data-scan-stop]').onclick = stop;
  const deliver = value => {
    if(!active || !input.isConnected || !value?.trim())return;
    input.value=value.trim(); stop();
    input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    Promise.resolve().then(()=>onDetected()).catch(error=>notify(error.message || 'Barcode terbaca, tetapi aksi berikutnya gagal.',true));
  };
  const cameraError = error => {
    const message = error.name==='NotAllowedError' ? 'Izin kamera ditolak. Izinkan Kamera di pengaturan situs browser, lalu buka pemindai lagi.'
      : error.name==='NotFoundError' ? 'Kamera tidak ditemukan.'
      : error.name==='NotReadableError' ? 'Kamera sedang dipakai aplikasi lain. Tutup kamera aplikasi tersebut lalu coba lagi.'
      : !window.isSecureContext ? 'Kamera memerlukan HTTPS. Buka alamat resmi aplikasi dengan https://.' : 'Kamera belum bisa dibuka. Coba buka aplikasi di Chrome atau Safari langsung.';
    if(active)status.textContent=message+' Anda tetap bisa memilih Scan foto atau memasukkan kode secara manual.';
  };
  try {
    const {Code128Reader,Code39Reader,EAN13Reader,EAN8Reader,UPCAReader,UPCEReader,QRCodeReader,DecodeHintType,RGBLuminanceSource,BinaryBitmap,HybridBinarizer} = await import('@zxing/library');
    if(!active)return;
    const constructors={code_128:Code128Reader,code_39:Code39Reader,ean_13:EAN13Reader,ean_8:EAN8Reader,upc_a:UPCAReader,upc_e:UPCEReader,qr_code:QRCodeReader};
    const readers=formats.map(format=>constructors[format]).filter(Boolean).map(Reader=>new Reader());
    const hints=new Map([[DecodeHintType.TRY_HARDER,true]]);
    const decodeCanvas = source => {
      const pixels=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height).data;
      const luminance=new Uint8ClampedArray(source.width*source.height);
      for(let i=0,j=0;i<pixels.length;i+=4,j++)luminance[j]=pixels[i+3]===0?255:(pixels[i]+2*pixels[i+1]+pixels[i+2])/4;
      const bitmap=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance,source.width,source.height)));
      for(const decoder of readers){try{return decoder.decode(bitmap,hints);}catch{}finally{decoder.reset();}}
      throw new Error('No matching barcode');
    };
    let rotated=false;
    const draw = (image,width,height,rotate=false) => {
      const scale=Math.min(1,1920/Math.max(width,height));width=Math.round(width*scale);height=Math.round(height*scale);
      canvas.width=rotate?height:width;canvas.height=rotate?width:height;
      if(rotate){context.translate(height,0);context.rotate(Math.PI/2);}
      context.drawImage(image,0,0,width,height);
    };
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
    const scan = () => {
      if(!active || !stream)return;
      if(video.readyState>=2 && video.videoWidth){
        rotated=!rotated;draw(video,video.videoWidth,video.videoHeight,rotated);
        try { const result=decodeCanvas(canvas);deliver(result.getText()); } catch { /* A frame without a barcode is normal. */ }
      }
      if(active)timer=setTimeout(scan,220);
    };
    panel.querySelector('[data-scan-photo]').onchange=async event=>{
      const file=event.target.files?.[0]; if(!file || !active)return;
      releaseCamera(); const url=URL.createObjectURL(file);
      try {
        const image=new Image();image.src=url;await image.decode();
        if(!active)return;
        let result;
        draw(image,image.naturalWidth,image.naturalHeight);
        try { result=decodeCanvas(canvas); } catch { draw(image,image.naturalWidth,image.naturalHeight,true);result=decodeCanvas(canvas); }
        deliver(result.getText());
      } catch { if(active)status.textContent='Barcode belum terbaca dari foto. Ambil foto lebih dekat dan fokus, seluruh barcode terlihat, atau masukkan kodenya manual.'; }
      finally { URL.revokeObjectURL(url);event.target.value=''; }
    };
    let facing='environment',opening=false;
    const openCamera = async () => {
      if(opening || !active)return;
      opening=true;releaseCamera();
      try {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera unavailable');
        const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}}});
        if(!active){next.getTracks().forEach(track=>track.stop());return;}
        stream=next; video.srcObject=next;await video.play();
        if(!active)return;
        const track=next.getVideoTracks()[0],capabilities=track.getCapabilities?.() || {};
        if(capabilities.focusMode?.includes('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
        const torch=panel.querySelector('[data-scan-torch]');torch.hidden=!capabilities.torch;
        let lit=false;torch.onclick=async()=>{try{await track.applyConstraints({advanced:[{torch:!lit}]});lit=!lit;}catch{status.textContent='Lampu kamera tidak tersedia. Tambahkan pencahayaan pada label.';}};
        status.textContent='Arahkan seluruh barcode ke kamera. Gerakkan jarak perlahan sampai fokus.';scan();
      } catch(error){releaseCamera();cameraError(error);} finally{opening=false;}
    };
    panel.querySelector('[data-scan-flip]').onclick=()=>{facing=facing==='environment'?'user':'environment';openCamera();};
    await openCamera();
  } catch(error){ if(active){stop();notify('Pemindai gagal dimuat. Periksa koneksi lalu coba lagi; kode tetap bisa diketik manual.',true);} }
}
