import { escapeHtmlAttribute } from '@/domain/forum/html';
import { isLinuxDoPacketCover, LINUX_DO_PACKET_ORIGIN } from '@/domain/forum/linuxDoPacket';

// Chromium owns the credentials. Native callers only receive display or identity status.
const sessionScript = `
const report=(status)=>window.ReactNativeWebView.postMessage(status);
async function readWithTimeout(url, options, milliseconds, read){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),milliseconds);
  try{
    const response=await fetch(url,{...options,cache:'no-store',redirect:'error',signal:abort.signal});
    if(!response.ok)throw Error();
    return await read(response);
  }
  finally{clearTimeout(timer);}
}
async function packetIdentity(viewer){
  const session=await readWithTimeout('/api/session',{credentials:'same-origin'},5000,response=>response.json());
  if(session.user===null)return 'anonymous';
  const username=session.user?.username;
  return viewer && typeof username==='string' && username.toLowerCase()===viewer.toLowerCase()?'matching':'mismatch';
}`;

export function packetSessionDocument(username: string) {
  return {
    baseUrl: LINUX_DO_PACKET_ORIGIN + '/',
    html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'nonce-wzPacketCover'; base-uri 'none'; form-action 'none'">
<body data-viewer="${escapeHtmlAttribute(username)}"><script nonce="wzPacketCover">${sessionScript}
packetIdentity(document.body.dataset.viewer).then(report,()=>report('error'));
</script></body>`
  };
}

// Only the packet site's image enters the page. Its session and image bytes stay in Chromium.
export function packetCoverDocument(cover: string, username: string) {
  if (!isLinuxDoPacketCover(cover)) throw new Error('红包封面地址无效');
  return {
    baseUrl: LINUX_DO_PACKET_ORIGIN + '/',
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-wzPacketCover'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,img{margin:0;width:100%;height:100%;overflow:hidden}img:not([hidden]){display:block;object-fit:contain}</style></head>
<body><img hidden alt="红包封面" data-cover="${escapeHtmlAttribute(cover)}" data-viewer="${escapeHtmlAttribute(username)}">
<script nonce="wzPacketCover">
${sessionScript}
const image=document.querySelector('img');
image.onload=()=>{image.hidden=false;report('displayed');};
image.onerror=()=>report('error');
async function showCover(){
  const viewer=image.dataset.viewer.toLowerCase();
  if(viewer){
    try{
      if(await packetIdentity(viewer)==='matching'){
        image.src=image.dataset.cover;
        return;
      }
    }catch{}
  }
  const svg=await readWithTimeout(image.dataset.cover,{credentials:'omit',headers:{Accept:'image/svg+xml,image/*;q=0.8'}},10000,async response=>{
    if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/svg+xml')throw Error();
    return response.blob();
  });
  image.src=URL.createObjectURL(svg);
}
showCover().catch(()=>report('error'));
</script></body></html>`
  };
}
