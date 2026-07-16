// ============================================ //
// MAIN APP - MULTICHAIN WALLET VISUALIZER
// CSP-DROŠA VERSIJA - NAV inline style / innerHTML ar stiliem
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

// ==================== PALĪGFUNKCIJAS CSP DROŠĪBAI ====================

function safeShow(element) {
  if (!element) return;
  element.classList.remove('hidden-element');
  element.classList.add('visible-block');
}

function safeHide(element) {
  if (!element) return;
  element.classList.add('hidden-element');
  element.classList.remove('visible-block');
}

function safeClearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function safeSetText(element, text) {
  if (!element) return;
  element.textContent = text;
}

// ==================== APP OBJEKTS ====================

const App = Object.assign({}, AppState, {
  setAddonStyle(styleName) {
    if (MAINTENANCE_CONFIG.isMaintenance) return;
    this.currentAddonStyle = styleName;
    
    const style = ADDON_STYLES[styleName];
    if (!style) return;

    // ✅ Izmantojam data atribūtus un klases, nevis inline stilus
    UI.styleIndicator.setAttribute('data-active-style', styleName);
    safeSetText(UI.indicatorText, style.indicatorText);
    
    UI.styleIndicator.classList.add('style-transition-active');
    setTimeout(() => { 
      UI.styleIndicator.classList.remove('style-transition-active'); 
    }, 300);
  },

  resetApp() {
    console.log("🔄 Resetting app data after network change...");
    
    stopAnimation(this);
    
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    this.account = null;
    this.provider = null;
    this.signer = null;
    
    safeSetText(UI.accountDisplay, 'Connected account: —');
    safeSetText(UI.recordTimer, 'Recording: 0 / 15 s');
    safeSetText(UI.statusMsg, '');
    safeHide(UI.tokenListContainer);
    safeClearElement(UI.tokenListContent);
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
    
    updateChainStatus();
    
    console.log("✅ App data cleared. Auth token preserved.");
  },

  handleSessionExpired() {
    console.log("Session expired, cleaning up...");
    showToast('⏰ Session expired. Please reconnect your wallet.', 'warning');
    
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    this.account = null;
    this.provider = null;
    this.signer = null;
    
    safeSetText(UI.accountDisplay, 'Connected account: —');
    safeHide(UI.tokenListContainer);
    safeClearElement(UI.tokenListContent);
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
    
    showToast('⏰ Session expired. Please click "Connect Wallet" to reconnect.', 'warning');
  },

  async generateNFT() {
    if (MAINTENANCE_CONFIG.isMaintenance) {
      showToast('🛠️ Minting is disabled during maintenance.', 'warning');
      return;
    }

    if (!this.account || !this.provider || !this.signer) { 
      showToast('🔌 Please connect your wallet first', 'warning');
      return; 
    }
    
    setButtonLoading(UI.generateNFTBtn, true);
    showWarning('⚠️ Do not close this tab until minting is complete and you have saved the ZIP file with your NFT files!', true);

    const snapshotEthBalance = this.ethBalance ? this.ethBalance.toString() : "0";
    const snapshotTxCount = this.txCount ? this.txCount.toString() : "0";
    const snapshotTokenCount = this.tokens ? this.tokens.filter(t => !t.isNFT).length.toString() : "0";
    const snapshotNftCount = this.tokens ? this.tokens.filter(t => t.isNFT).length.toString() : "0";
    
    const previousShowInfo = this.showInfo;
    this.showInfo = false;
    
    try {
      // ... PĀRĒJAIS generateNFT KODS PALIEK TĀDS PATS ...
      // Tikai jānomaina innerHTML izsaukumi
      
    } catch (error) {
      // ... kļūdu apstrāde ...
    } finally { 
      this.showInfo = previousShowInfo;
      setButtonLoading(UI.generateNFTBtn, false);
    }
  },

  async renderSnapshot(chain) {
    if (MAINTENANCE_CONFIG.isMaintenance) return;
    await renderSnapshot(this, chain);
    
    if (UI.recordBtn) UI.recordBtn.disabled = false;
    if (UI.renderBtn) UI.renderBtn.disabled = false;
    if (UI.generateNFTBtn) {
      const price = await getNFTPrice();
      UI.generateNFTBtn.setAttribute('data-price', price);
    }
  },

  cleanupUI() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    safeHide(UI.tokenListContainer);
    safeClearElement(UI.tokenListContent);
    safeSetText(UI.accountDisplay, 'Connected account: —');
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
  },

  renderMaintenanceScreen() {
    stopAnimation(this);
    if (this.ctx || UI.canvas) {
      this.ctx = this.ctx || UI.canvas.getContext('2d');
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
      
      // Canvas teksta zīmēšana IR ATĻAUTA ar CSP
      this.ctx.fillStyle = '#ff3333';
      this.ctx.font = 'bold 28px Inter, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(MAINTENANCE_CONFIG.title, UI.canvas.width / 2, UI.canvas.height / 2 - 15);
      
      this.ctx.fillStyle = '#aaa';
      this.ctx.font = '16px Inter, sans-serif';
      this.ctx.fillText(MAINTENANCE_CONFIG.subtitle, UI.canvas.width / 2, UI.canvas.height / 2 + 30);
    }

    if (UI.connectBtn) {
      UI.connectBtn.disabled = true;
      UI.connectBtn.textContent = '🛠️ Maintenance Active';
    }
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) UI.generateNFTBtn.disabled = true;
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.chainSelect) UI.chainSelect.disabled = true;
  },

  init() {
    console.log("🚀 Starting Wallet Visualizer with Arweave Permanent Storage...");
    initUI();
    resizeCanvas(this);
    
    if (MAINTENANCE_CONFIG.isMaintenance) {
      console.warn("⚠️ Application initialization stopped: Maintenance Mode is active.");
      this.renderMaintenanceScreen();
      window.addEventListener('resize', () => {
        resizeCanvas(this);
        this.renderMaintenanceScreen();
      });
      showToast('🛠️ System is undergoing planned maintenance.', 'warning');
      return; 
    }

    window.addEventListener('auth:expired', () => {
      this.handleSessionExpired();
    });
    
    UI.connectBtn.addEventListener('click', async () => {
      this.tokens = [];
      this.ethBalance = 0;
      this.txCount = 0;
      this.particles = [];
      this.initialParticles = [];
      this.nftCenters = [];
      this.particleCache.clear();
      
      safeClearElement(UI.tokenListContent);
      
      await connectWallet(this);
    });
    
    UI.renderBtn.addEventListener('click', () => this.renderSnapshot(this.currentVizChain));
    UI.generateNFTBtn.addEventListener('click', () => this.generateNFT());
    UI.recordBtn.addEventListener('click', () => startRecording(this));
    
    UI.chainSelect.addEventListener('change', async () => {
      if (this.account) {
        showToast(`You changed the network! Please reconnect wallet to switch to ${UI.chainSelect.value}`, 'info');
      }
    });
    
    // Tēmu pogas - bez innerHTML
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setAddonStyle(btn.getAttribute('data-theme'));
      });
    });
    
    UI.fullscreenIcon.addEventListener('click', () => { 
      if (!document.fullscreenElement) UI.canvas.requestFullscreen().catch(() => {}); 
      else document.exitFullscreen().catch(() => {}); 
    });
    
    UI.toggleInfoIcon.addEventListener('click', () => { 
      this.showInfo = !this.showInfo; 
      if (this.showInfo) {
        safeShow(UI.tokenListContainer);
        updateTokenListUI(this.tokens);
      } else {
        safeHide(UI.tokenListContainer);
      }
    });

    // Modal - izmanto klases, nevis inline stilus
    const modal = document.getElementById("aboutModal");
    const aboutBtn = document.getElementById("aboutBtn");
    const closeBtn = document.querySelector(".close-modal");

    if (aboutBtn && modal && closeBtn) {
      aboutBtn.addEventListener("click", () => { 
        modal.classList.remove('modal-hidden');
        modal.classList.add('modal-visible');
      });
      closeBtn.addEventListener("click", () => { 
        modal.classList.add('modal-hidden');
        modal.classList.remove('modal-visible');
      });
      window.addEventListener("click", (event) => { 
        if (event.target === modal) {
          modal.classList.add('modal-hidden');
          modal.classList.remove('modal-visible');
        }
      });
    } else {
      console.warn("⚠️ About modal elements were not found in the DOM.");
    }
    
    window.addEventListener('resize', () => resizeCanvas(this));
    
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => { this.resetApp(); });
    }
    
    window.LOW_POWER_MODE = LOW_POWER_MODE;
    
    showToast('✨ Welcome! Connect your wallet to begin.', 'info');
    console.log('✅ Wallet Visualizer Ready with Arweave Permanent Storage!');
  }
});

window.App = App;
App.init();
