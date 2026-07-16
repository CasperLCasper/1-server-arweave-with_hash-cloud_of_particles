// ============================================ //
// ARWEAVE/TURBO STORAGE FUNCTIONS
// ============================================ //

import { showToast, showProgress, setProgress, hideProgress } from './ui.js';
import { ARWEAVE_GATEWAY } from './config.js';
import { UI } from './state.js';

import 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

export function showArweavePreview(imageId, videoId, metadataId) {
  if (UI.previewImage) {
    while (UI.previewImage.firstChild) UI.previewImage.removeChild(UI.previewImage.firstChild);
    if (imageId) {
      UI.previewImage.appendChild(document.createTextNode('🖼️ Image: '));
      const a = document.createElement('a');
      a.href = `${ARWEAVE_GATEWAY}${imageId}`;
      a.target = '_blank';
      a.textContent = `${imageId.substring(0, 20)}...`;
      UI.previewImage.appendChild(a);
    }
  }
  if (UI.previewVideo) {
    while (UI.previewVideo.firstChild) UI.previewVideo.removeChild(UI.previewVideo.firstChild);
    if (videoId) {
      UI.previewVideo.appendChild(document.createTextNode('🎬 Video: '));
      const a = document.createElement('a');
      a.href = `${ARWEAVE_GATEWAY}${videoId}`;
      a.target = '_blank';
      a.textContent = `${videoId.substring(0, 20)}...`;
      UI.previewVideo.appendChild(a);
    }
  }
  if (UI.previewMetadata) {
    while (UI.previewMetadata.firstChild) UI.previewMetadata.removeChild(UI.previewMetadata.firstChild);
    if (metadataId) {
      UI.previewMetadata.appendChild(document.createTextNode('📄 Metadata: '));
      const a = document.createElement('a');
      a.href = `${ARWEAVE_GATEWAY}${metadataId}`;
      a.target = '_blank';
      a.textContent = `${metadataId.substring(0, 20)}...`;
      UI.previewMetadata.appendChild(a);
    }
  }
  if (UI.ipfsPreview) {
    UI.ipfsPreview.style.display = 'block';
    setTimeout(() => { if (UI.ipfsPreview) UI.ipfsPreview.style.display = 'none'; }, 10000);
  }
}

export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`💾 Lejupielādēts: ${filename}`);
}

export async function downloadAllFiles(files) {
  if (!window.JSZip) {
    throw new Error("JSZip bibliotēka vēl nav pilnībā ielādējusies. Lūdzu, mēģiniet vēlreiz!");
  }
  
  const zip = new window.JSZip();
  
  for (const { blob, filename } of files) {
    zip.file(filename, blob);
  }
  
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nft_assets_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  
  console.log(`💾 ZIP arhīvs saglabāts ar ${files.length} failiem`);
}

export async function calculateHashFromBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export async function uploadFileToArweave(file) {
  showToast('Uploading file to Arweave (Turbo)...', 'info');
  
  const formData = new FormData();
  formData.append('file', file);
  
  const token = localStorage.getItem("auth_token");
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  const res = await fetch('/api/uploadFileToArweave', {
    method: 'POST',
    headers,
    body: formData
  });
  
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`File upload failed: ${res.status} ${errorText}`);
  }
  
  const result = await res.json();
  if (!result.id) throw new Error("Upload failed - no transaction ID returned");
  
  console.log("File uploaded to Arweave:", result.id, "Hash:", result.hash);
  return result;
}

export async function uploadMetadataToArweave(metadata) {
  showToast('Preparing metadata for Arweave...', 'info');
  
  const { apiFetch } = await import('./api.js');
  const response = await apiFetch('/api/uploadMetadataToArweave', {
    method: 'POST',
    body: JSON.stringify(metadata)
  });
  
  if (!response.ok) throw new Error(`Metadata upload failed: ${response.status}`);
  
  showToast('Metadata uploaded to Arweave!', 'success');
  return await response.json();
}

export async function uploadImageToArweave(canvas) {
  showToast('Preparing image for Arweave...', 'info');
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Failed to create image')); return; }
      const file = new File([blob], `snapshot_${Date.now()}.png`, { type: 'image/png' });
      try { 
        showToast('Uploading image to Arweave...', 'info'); 
        resolve(await uploadFileToArweave(file)); 
      } catch (error) { reject(error); }
    }, 'image/png');
  });
}

export async function uploadVideoToArweave(stream, duration = 15000) {
  showToast('Recording video for Arweave...', 'info');
  let mimeType = 'video/webm';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const ext = mimeType === 'video/mp4' ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      const file = new File([blob], `video_${Date.now()}.${ext}`, { type: mimeType });
      try { 
        showToast('Uploading video to Arweave...', 'info'); 
        resolve(await uploadFileToArweave(file)); 
      } catch (error) { reject(error); }
    };
    recorder.onerror = (event) => {
      const error = event?.error instanceof Error ? event.error : new Error('Recording failed');
      reject(error);
    };
    recorder.start(1000);
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, duration);
  });
}
