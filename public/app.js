// ============================================ //
// MAIN APP - MULTICHAIN WALLET VISUALIZER
// Arweave/Turbo Storage + Base Sepolia Minting
// ============================================ //

import { AppState, initUI, UI } from './modules/state.js';
import { VIZ_CHAINS, MINT_CHAIN } from './modules/chains.js';
import { ARWEAVE_GATEWAY, CONTRACT_ABI, LOW_POWER_MODE, getMintProvider } from './modules/config.js'; 
import { showToast, showWarning, setButtonLoading, updateTokenListUI, hideProgress, showProgress } from './modules/ui.js';
import { login, getNFTPrice, getContractAddress } from './modules/api.js'; 
import { connectWallet, updateChainStatus, switchToMintChain, switchToVizChain } from './modules/web3.js';
import { 
  uploadMetadataToArweave,
  showArweavePreview, downloadFile, downloadAllFiles, calculateHashFromBlob 
} from './modules/storage.js';
import { startRecording, cleanupRecording } from './modules/recording.js';
import { getCanvasDimensions, resizeCanvas, cleanup, drawFrame, animate, stopAnimation, renderSnapshot, updateNFTCenters, initParticlesOnce, cloneParticles, hashStringToInt, seededRandomFloat, createParticleCache } from './modules/visualizer.js';
import { apiFetch } from './modules/api.js';

import { ADDON_STYLES } from './themes.js';

import { MAINTENANCE_CONFIG } from './maintenance.js';

// ============================================
// PALĪGFUNKCIJAS
// ============================================

async function createImageBlob() {
  return new Promise((resolve, reject) => {
    UI.canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create image'));
    }, 'image/png');
  });
}

async function createVideoBlob() {
  const stream = UI.canvas.captureStream(30);
  return new Promise((resolve, reject) => {
    let mimeType = 'video/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (event) => reject(event?.error || new Error('Recording failed'));
    recorder.start(1000);
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 15000);
  });
}

async function signAntiBotMessage(signer, account) {
  const message = `Wallet Visualizer NFT Generation\nTimestamp: ${Date.now()}\nWallet: ${account}`;
  try {
    await signer.signMessage(message);
    return true;
  } catch (signError) {
    if (signError.message?.includes('User denied') || signError.code === 'ACTION_REJECTED') {
      showToast('🛑 Cancelled by user', 'warning');
    } else {
      showToast('❌ Verification failed', 'error');
    }
    return false;
  }
}

async function captureMedia() {
  let imageBlob, videoBlob, imageHash, videoHash;
  let imageFileName, videoFileName, imageFile, videoFile;

  try {
    imageBlob = await createImageBlob();
    imageFileName = `snapshot_${Date.now()}.png`;
    imageFile = new File([imageBlob], imageFileName, { type: 'image/png' });
    imageHash = await calculateHashFromBlob(imageBlob);
  } catch (err) {
    showToast('❌ Failed to create image. Cannot mint NFT.', 'error');
    return null;
  }

  try {
    videoBlob = await createVideoBlob();
    const ext = videoBlob.type === 'video/mp4' ? 'mp4' : 'webm';
    videoFileName = `video_${Date.now()}.${ext}`;
    videoFile = new File([videoBlob], videoFileName, { type: videoBlob.type });
    videoHash = await calculateHashFromBlob(videoBlob);
    showToast('🎬 Video recorded!', 'success');
  } catch (err) {
    showToast('❌ Failed to record video. Cannot mint NFT.', 'error');
    return null;
  }

  return { imageBlob, imageFile, imageFileName, imageHash, videoBlob, videoFile, videoFileName, videoHash };
}

async function switchToBaseAndReauth(app) {
  showToast('🔄 Switching to Base...', 'info');
  await switchToMintChain();
  await new Promise(resolve => setTimeout(resolve, 400));
  app.provider = new ethers.BrowserProvider(window.ethereum);
  app.signer = await app.provider.getSigner();
  app.account = await app.signer.getAddress();
  
  if (!(await login(app.signer, app.account))) {
    showToast('🔐 Authentication failed. Please reconnect your wallet.', 'error');
    return false;
  }
  return true;
}

async function fetchMintPrice() {
  const addr = await getContractAddress();
  if (!addr) return;
  try {
    const p = await getMintProvider();
    const c = new ethers.Contract(addr, CONTRACT_ABI, p);
    UI.generateNFTBtn.dataset.price = ethers.formatEther(await c.mintPrice());
  } catch(e) { /* klusē */ }
}

async function requestDeposit(app, imageHash, videoHash, contentHash) {
  const res = await apiFetch('/api/request-mint', {
    method: 'POST',
    body: JSON.stringify({ wallet: app.account, imageHash, videoHash, contentHash })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Mint request failed');
  
  const tx = await app.signer.sendTransaction({
    to: data.transaction.to, data: data.transaction.data,
    value: BigInt(data.transaction.value), gasLimit: BigInt(data.transaction.gasLimit)
  });
  showToast('⏳ Waiting for deposit confirmation...', 'info');
  await tx.wait();
  showToast('✅ Deposit confirmed!', 'success');
  return { tx, txValue: BigInt(data.transaction.value) };
}

async function uploadMediaToArweave(imageFile, videoFile) {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('video', videoFile);
  const token = localStorage.getItem("auth_token");
  const headers = token ? { "Authorization": `Bearer ${token}` } : {};
  const res = await fetch('/api/prepare-nft', { method: 'POST', headers, body: fd });
  if (!res.ok) throw new Error('Arweave upload failed. Refund will be processed by cleanup robot.');
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Arweave processing failed');
  return data;
}

function buildMetadata(app, imageFileName, videoFileName, tokenList, nftList, snap, nativeSymbol) {
  const m = {
    name: "Wallet Visualization NFT",
    description: `Generated from wallet ${app.account} on ${new Date().toISOString()}. Stored permanently on Arweave.`,
    image: imageFileName, animation_url: videoFileName,
    attributes: [
      { trait_type: "Balance Amount", value: snap.ethBalance },
      { trait_type: "Native Token", value: nativeSymbol },
      { trait_type: "Token Count", value: snap.tokenCount },
      { trait_type: "NFT Count", value: snap.nftCount },
      { trait_type: "Transaction Count", value: snap.txCount },
      { trait_type: "Visual Style", value: ADDON_STYLES[app.currentAddonStyle]?.name || app.currentAddonStyle },
      { trait_type: "Source Chain", value: app.currentVizChain },
      { trait_type: "Storage", value: "Arweave (Permanent)" },
      { trait_type: "Generated At", value: new Date().toISOString() }
    ],
    tokens: tokenList, nfts: nftList
  };
  if (!app.lastVideoBlob) delete m.animation_url;
  return m;
}

async function finalizeMintProcess(app, serverData, imageHash, videoHash, imageBlob, videoBlob, imageFileName, videoFileName, snap, nativeSymbol, tokenList, nftList, tx, txValue) {
  const gw = ARWEAVE_GATEWAY;
  const imageUrl = serverData.image.id ? `${gw}${serverData.image.id}` : `local://${imageHash}`;
  const costWei = serverData.storage?.costWei || "0";
  const costEth = serverData.storage?.costEth || "0";

  const localMeta = buildMetadata(app, imageFileName, videoFileName, tokenList, nftList, snap, nativeSymbol);
  if (!videoBlob) delete localMeta.animation_url;
  const metaStr = JSON.stringify(localMeta, null, 2);
  const finalContentHash = await calculateHashFromBlob(new Blob([metaStr]));

  const arweaveMeta = { ...localMeta, image: imageUrl, animation_url: serverData.video?.id ? `${gw}${serverData.video.id}` : undefined };
  if (!arweaveMeta.animation_url) delete arweaveMeta.animation_url;

  let metaId;
  try {
    const r = await uploadMetadataToArweave(arweaveMeta);
    metaId = r.id || r.cid;
    showToast('✅ Metadata uploaded to Arweave!', 'success');
  } catch (e) {
    showToast('❌ Failed to upload metadata. Deposit will be refunded automatically.', 'error');
    return false;
  }

  try {
    const r = await apiFetch('/api/finalize-mint', {
      method: 'POST',
      body: JSON.stringify({ wallet: app.account, metadataUri: `${gw}${metaId}`, storageCostWei: costWei, contentHash: finalContentHash })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Finalize failed');
    showToast('✅ NFT finalized on blockchain!', 'success');
  } catch (e) {
    showToast('❌ Finalize failed. Refund will be processed automatically.', 'error');
  }

  const metaBlob = new Blob([metaStr], { type: 'application/json' });
  await downloadAllFiles([
    { blob: imageBlob, filename: imageFileName },
    { blob: metaBlob, filename: `metadata_${Date.now()}.json` },
    { blob: videoBlob, filename: videoFileName }
  ]);
  showToast('✅ All files saved as ZIP!', 'success');

  alert(`✅ NFT minted!\n\nTx: ${tx.hash}\nPrice: ${ethers.formatEther(txValue)} ETH\n(Storage: ${costEth} ETH)\n\n🔐 Image Hash: ${imageHash}\n🔐 Video Hash: ${videoHash}\n🔐 Content Hash: ${finalContentHash}\n${metaId ? '📄 Arweave Metadata: ' + metaId + '\n' : ''}${serverData.image?.id ? '🖼️ Arweave Image: ' + serverData.image.id + '\n' : ''}${serverData.video?.id ? '🎬 Arweave Video: ' + serverData.video.id : ''}`);
  return true;
}

function getNativeSymbol(app) {
  const cfg = VIZ_CHAINS[app.currentVizChain];
  const isAmoy = app.currentVizChain === 'polygonAmoy' || cfg?.chainIdHex?.toLowerCase() === '0x13882';
  return isAmoy ? 'POL' : (cfg?.nativeCurrency || 'ETH');
}

async function restoreAfterMint(app) {
  showToast('🔄 Refreshing view...', 'info');
  await switchToVizChain(VIZ_CHAINS[app.currentVizChain].chainIdHex);
  await new Promise(r => setTimeout(r, 500));
  app.provider = new ethers.BrowserProvider(window.ethereum);
  app.signer = await app.provider.getSigner();
  app.account = await app.signer.getAddress();
  await app.renderSnapshot(app.currentVizChain);
}

// ============================================
// GALVENĀ APLIKĀCIJA
// ============================================

const App = Object.assign({}, AppState, {
  setAddonStyle(styleName) {
    if (MAINTENANCE_CONFIG.isMaintenance) return;
    this.currentAddonStyle = styleName;
    const style = ADDON_STYLES[styleName];
    if (!style) return;
    UI.styleIndicator.style.borderLeftColor = style.color;
    UI.indicatorText.textContent = style.indicatorText;
    UI.styleIndicator.style.transform = 'scale(1.05)';
    setTimeout(() => { UI.styleIndicator.style.transform = 'scale(1)'; }, 300);
  },

  resetApp() {
    console.log("🔄 Resetting app data...");
    stopAnimation(this);
    if (this.ctx) { this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height); this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height); }
    this.tokens = []; this.ethBalance = 0; this.txCount = 0;
    this.particles = []; this.initialParticles = []; this.nftCenters = []; this.particleCache.clear();
    this.account = null; this.provider = null; this.signer = null;
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    if (UI.recordTimer) UI.recordTimer.textContent = 'Recording: 0 / 15 s';
    if (UI.statusMsg) UI.statusMsg.textContent = '';
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) { while (UI.tokenListContent.firstChild) UI.tokenListContent.removeChild(UI.tokenListContent.firstChild); }
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) { UI.generateNFTBtn.disabled = true; UI.generateNFTBtn.dataset.price = ''; }
    if (UI.balanceDisplay) { UI.balanceDisplay.textContent = ''; UI.balanceDisplay.className = 'balance-display'; }
    updateChainStatus();
    console.log("✅ App data cleared.");
  },

  handleSessionExpired() {
    console.log("Session expired, cleaning up...");
    showToast('⏰ Session expired. Please reconnect your wallet.', 'warning');
    if (this.ctx) { this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height); this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height); }
    this.tokens = []; this.ethBalance = 0; this.txCount = 0;
    this.particles = []; this.initialParticles = []; this.nftCenters = []; this.particleCache.clear();
    this.account = null; this.provider = null; this.signer = null;
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) { while (UI.tokenListContent.firstChild) UI.tokenListContent.removeChild(UI.tokenListContent.firstChild); }
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) { UI.generateNFTBtn.disabled = true; UI.generateNFTBtn.dataset.price = ''; }
    showToast('⏰ Session expired. Please click "Connect Wallet" to reconnect.', 'warning');
  },

  async generateNFT() {
    if (MAINTENANCE_CONFIG.isMaintenance) { showToast('🛠️ Minting is disabled during maintenance.', 'warning'); return; }
    if (!this.account || !this.provider || !this.signer) { showToast('🔌 Please connect your wallet first', 'warning'); return; }

    setButtonLoading(UI.generateNFTBtn, true);
    showWarning('⚠️ Do not close this tab until minting is complete and you have saved the ZIP file with your NFT files!', true);

    const snap = {
      ethBalance: this.ethBalance ? this.ethBalance.toString() : "0",
      txCount: this.txCount ? this.txCount.toString() : "0",
      tokenCount: this.tokens ? this.tokens.filter(t => !t.isNFT).length.toString() : "0",
      nftCount: this.tokens ? this.tokens.filter(t => t.isNFT).length.toString() : "0"
    };
    const nativeSymbol = getNativeSymbol(this);
    const tokenList = this.tokens.filter(t => !t.isNFT).map(t => ({ symbol: t.symbol, address: t.address, balance: t.balance }));
    const nftList = this.tokens.filter(t => t.isNFT).map(n => ({ symbol: n.symbol, address: n.address, tokenId: n.tokenId }));
    const prevShowInfo = this.showInfo;
    this.showInfo = false;

    try {
      if (!(await signAntiBotMessage(this.signer, this.account))) { showWarning('', false); return; }

      showToast('📸 Creating your NFT files...', 'info');
      const media = await captureMedia();
      if (!media) { showWarning('', false); return; }
      const { imageBlob, imageFile, imageFileName, imageHash, videoBlob, videoFile, videoFileName, videoHash } = media;
      this.lastVideoBlob = videoBlob;

      const tempHash = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('WalletVisualizer'), imageHash, videoHash, ethers.toUtf8Bytes(this.account)]));

      if (!(await switchToBaseAndReauth(this))) {
        setButtonLoading(UI.generateNFTBtn, false);
        await restoreAfterMint(this);
        return;
      }
      await fetchMintPrice();

      showToast('📝 Requesting mint reservation...', 'info');
      const { tx, txValue } = await requestDeposit(this, imageHash, videoHash, tempHash);

      showToast('📤 Uploading to Arweave...', 'info');
      let serverData;
      try {
        serverData = await uploadMediaToArweave(imageFile, videoFile);
      } catch (upErr) {
        showToast('❌ ' + upErr.message, 'error');
        showWarning('', false);
        return;
      }

      if (!(serverData.arweave?.success)) {
        showToast('⚠️ Arweave upload failed. Refund will be processed by cleanup robot.', 'warning');
        showWarning('', false);
        return;
      }

      await finalizeMintProcess(this, serverData, imageHash, videoHash, imageBlob, videoBlob, imageFileName, videoFileName, snap, nativeSymbol, tokenList, nftList, tx, txValue);
      await restoreAfterMint(this);

    } catch (error) {
      console.error(error);
      let msg = 'Something went wrong. Please try again.';
      if (error.message?.includes('User denied') || error.code === 'ACTION_REJECTED') msg = '🛑 Transaction was cancelled in your wallet.';
      else if (error.message?.includes('insufficient funds')) msg = '💰 Insufficient funds.';
      showToast('❌ ' + msg, 'error');
      showWarning('', false);
      alert(msg);
      try { await restoreAfterMint(this); } catch (e) {}
    } finally {
      this.showInfo = prevShowInfo;
      setButtonLoading(UI.generateNFTBtn, false);
    }
  },

  async renderSnapshot(chain) {
    if (MAINTENANCE_CONFIG.isMaintenance) return;
    await renderSnapshot(this, chain);
    if (UI.recordBtn) UI.recordBtn.disabled = false;
    if (UI.renderBtn) UI.renderBtn.disabled = false;
    if (UI.generateNFTBtn) UI.generateNFTBtn.dataset.price = await getNFTPrice();
  },

  cleanupUI() {
    if (this.ctx) { this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height); this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height); }
    this.tokens = []; this.ethBalance = 0; this.txCount = 0;
    this.particles = []; this.initialParticles = []; this.nftCenters = []; this.particleCache.clear();
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) { while (UI.tokenListContent.firstChild) UI.tokenListContent.removeChild(UI.tokenListContent.firstChild); }
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) { UI.generateNFTBtn.disabled = true; UI.generateNFTBtn.dataset.price = ''; }
  },

  renderMaintenanceScreen() {
    stopAnimation(this);
    if (this.ctx || UI.canvas) {
      this.ctx = this.ctx || UI.canvas.getContext('2d');
      this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#ff3333'; this.ctx.font = 'bold 28px Inter, sans-serif'; this.ctx.textAlign = 'center';
      this.ctx.fillText(MAINTENANCE_CONFIG.title, UI.canvas.width / 2, UI.canvas.height / 2 - 15);
      this.ctx.fillStyle = '#aaa'; this.ctx.font = '16px Inter, sans-serif';
      this.ctx.fillText(MAINTENANCE_CONFIG.subtitle, UI.canvas.width / 2, UI.canvas.height / 2 + 30);
    }
    if (UI.connectBtn) { UI.connectBtn.disabled = true; UI.connectBtn.textContent = '🛠️ Maintenance Active'; }
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) UI.generateNFTBtn.disabled = true;
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.chainSelect) UI.chainSelect.disabled = true;
  },

  init() {
    console.log("🚀 Starting Wallet Visualizer...");
    initUI(); resizeCanvas(this); this.resetApp();
    if (MAINTENANCE_CONFIG.isMaintenance) { this.renderMaintenanceScreen(); return; }
    window.addEventListener('auth:expired', () => this.handleSessionExpired());
    UI.connectBtn.addEventListener('click', async () => { this.tokens = []; this.ethBalance = 0; this.txCount = 0; this.particles = []; this.initialParticles = []; this.nftCenters = []; this.particleCache.clear(); if (UI.tokenListContent) { while (UI.tokenListContent.firstChild) UI.tokenListContent.removeChild(UI.tokenListContent.firstChild); } await connectWallet(this); });
    UI.renderBtn.addEventListener('click', () => this.renderSnapshot(this.currentVizChain));
    UI.generateNFTBtn.addEventListener('click', () => this.generateNFT());
    UI.recordBtn.addEventListener('click', () => startRecording(this));
    UI.chainSelect.addEventListener('change', async () => { if (this.account) showToast(`You changed the network! Please reconnect wallet to switch to ${UI.chainSelect.value}`, 'info'); });
    document.querySelectorAll('.theme-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.setAddonStyle(btn.dataset.theme); }); });
    UI.fullscreenIcon.addEventListener('click', () => { if (!document.fullscreenElement) UI.canvas.requestFullscreen().catch(() => {}); else document.exitFullscreen().catch(() => {}); });
    UI.toggleInfoIcon.addEventListener('click', () => { this.showInfo = !this.showInfo; if (UI.tokenListContainer) UI.tokenListContainer.style.display = this.showInfo ? 'block' : 'none'; if (this.showInfo) updateTokenListUI(this.tokens); });
    const modal = document.getElementById("aboutModal"), aboutBtn = document.getElementById("aboutBtn"), closeBtn = document.querySelector(".close-modal");
    if (aboutBtn && modal && closeBtn) { aboutBtn.addEventListener("click", () => { modal.style.display = "block"; }); closeBtn.addEventListener("click", () => { modal.style.display = "none"; }); window.addEventListener("click", (event) => { if (event.target === modal) modal.style.display = "none"; }); }
    window.addEventListener('resize', () => resizeCanvas(this));
    if (window.ethereum) window.ethereum.on('chainChanged', () => { this.resetApp(); });
    window.LOW_POWER_MODE = LOW_POWER_MODE;
    showToast('✨ Welcome! Connect your wallet to begin.', 'info');
  }
});

window.App = App;
App.init();
