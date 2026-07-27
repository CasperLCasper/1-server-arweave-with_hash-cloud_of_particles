// ============================================ //
// AVATAR TREE VISUALIZER
// ============================================ //

import { UI } from './state.js';
import { showToast, showProgress, setProgress, hideProgress, setButtonLoading, updateTokenListUI } from './ui.js';
import { MAX_PARTICLES, CONNECTION_DISTANCE, VIZ_LOW_POWER_MODE } from './config.js';
import { getTokens, getAllNFTs } from './api.js';
import { VIZ_CHAINS } from './chains.js';

// ============================================
// PAMATA FUNKCIJAS (SAGLABĀTAS)
// ============================================

export function getCanvasDimensions() {
  const isMobile = VIZ_LOW_POWER_MODE;
  return { width: isMobile ? 1080 : 1920, height: isMobile ? 720 : 1080, isMobile };
}

export function resizeCanvas(app) {
  const { width, height } = getCanvasDimensions();
  if (UI.canvas.width === width && UI.canvas.height === height) return;
  UI.canvas.width = width; UI.canvas.height = height;
  UI.canvas.style.width = '100%'; UI.canvas.style.height = 'auto';
  app.canvasWidth = width; app.canvasHeight = height;
  app.ctx = UI.canvas.getContext('2d');
  app.particleCache.clear();
}

export function cleanup(app) {
  if (app.animFrameId) { cancelAnimationFrame(app.animFrameId); app.animFrameId = null; }
  app.isAnimationActive = false;
  app.branches = [];
  app.leaves = [];
  app.glowingSeeds = [];
  app._fallingParticles = [];
  app.particleCache.clear();
  if (app.ctx) app.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
}

export function hashStringToInt(str, mod = 1000) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.codePointAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % mod;
}

export function seededRandomFloat(seedStr) { return hashStringToInt(seedStr, 10000) / 10000; }

export function createParticleCache(app, leaf) {
  const cacheKey = `${leaf.hue}_${leaf.r}_${leaf.balanceFactor}`;
  if (app.particleCache.has(cacheKey)) return app.particleCache.get(cacheKey);
  const size = Math.ceil(leaf.r * 4);
  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = size; cacheCanvas.height = size;
  const cctx = cacheCanvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const gradient = cctx.createRadialGradient(cx, cy, 0, cx, cy, leaf.r * 2);
  gradient.addColorStop(0, `hsla(${leaf.hue}, 100%, 90%, 0.9)`);
  gradient.addColorStop(0.5, `hsla(${leaf.hue}, 90%, 70%, 0.7)`);
  gradient.addColorStop(1, `hsla(${leaf.hue + 30}, 80%, 40%, 0)`);
  cctx.fillStyle = gradient; cctx.beginPath(); cctx.arc(cx, cy, leaf.r, 0, Math.PI * 2); cctx.fill();
  const cached = { canvas: cacheCanvas, size, offset: size / 2 };
  app.particleCache.set(cacheKey, cached);
  return cached;
}

// ============================================
// KOKA ĢENERĒŠANA
// ============================================

function ensureTreeTrunk(app) {
  if (!app.treeTrunk) {
    const W = app.canvasWidth || UI.canvas.width || 1920;
    const H = app.canvasHeight || UI.canvas.height || 1080;
    app.treeTrunk = { x: W / 2, y: H * 0.85, width: 15, height: 250 };
  }
}

export function updateNFTCenters(app) {
  ensureTreeTrunk(app);
  app.glowingSeeds = [];
  const nftTokens = app.tokens.filter(t => t.isNFT);
  
  nftTokens.forEach((nft, idx) => {
    const angle = seededRandomFloat(nft.address + 'seed_pos') * Math.PI * 2;
    const distance = 100 + seededRandomFloat(nft.address + 'seed_dist') * 300;
    app.glowingSeeds.push({
      x: app.treeTrunk.x + Math.cos(angle) * distance,
      y: app.treeTrunk.y - 100 + Math.sin(angle) * distance * 0.6,
      radius: 3 + seededRandomFloat(nft.address + 'seed_size') * 5,
      influence: 0.01 + seededRandomFloat(nft.address + 'seed_inf') * 0.02,
      token: nft,
      angle: angle,
      orbitRadius: distance,
      orbitSpeed: 0.002 + seededRandomFloat(nft.address + 'seed_spd') * 0.005,
      glowPhase: seededRandomFloat(nft.address + 'seed_glow') * Math.PI * 2
    });
  });
}

function generateBranches(app) {
  ensureTreeTrunk(app);
  app.branches = [];
  const tokens = app.tokens.filter(t => !t.isNFT);
  const seedBase = (app.account || '') + String(app.ethBalance) + String(app.txCount);
  const trunkX = app.treeTrunk.x;
  const trunkY = app.treeTrunk.y;
  const trunkHeight = app.treeTrunk.height;
  
  // Galvenie zari (tieši no stumbra)
  const mainBranchCount = Math.min(8, Math.max(3, tokens.length));
  
  for (let i = 0; i < mainBranchCount; i++) {
    const angle = -Math.PI / 2 + (i / Math.max(1, mainBranchCount - 1)) * Math.PI * 0.7 - Math.PI * 0.35;
    const length = trunkHeight * (0.4 + seededRandomFloat(seedBase + i + 'len') * 0.5);
    const thickness = 3 + (i < tokens.length ? Math.min(tokens[i]?.balance || 1, 20) / 20 * 8 : 3);
    const hue = (hashStringToInt((tokens[i]?.address || '') + seedBase + i) % 120) + 80;
    
    const endX = trunkX + Math.cos(angle) * length;
    const endY = trunkY - trunkHeight * 0.3 + Math.sin(angle) * length;
    
    app.branches.push({
      startX: trunkX,
      startY: trunkY - trunkHeight * 0.2,
      endX: endX,
      endY: endY,
      thickness: thickness,
      hue: hue,
      token: tokens[i] || null,
      level: 0,
      angle: angle,
      length: length
    });
    
    // Apakšzari
    const subBranchCount = 1 + Math.floor(seededRandomFloat(seedBase + i + 'sub') * 3);
    for (let j = 0; j < subBranchCount; j++) {
      const subAngle = angle + (j - subBranchCount / 2) * 0.5;
      const subLength = length * (0.3 + seededRandomFloat(seedBase + i + j + 'sublen') * 0.4);
      const subThickness = thickness * 0.5;
      const subHue = hue + 15;
      
      app.branches.push({
        startX: endX,
        startY: endY,
        endX: endX + Math.cos(subAngle) * subLength,
        endY: endY + Math.sin(subAngle) * subLength,
        thickness: subThickness,
        hue: subHue,
        token: tokens[i] || null,
        level: 1,
        angle: subAngle,
        length: subLength
      });
    }
  }
}

function generateLeaves(app) {
  app.leaves = [];
  const seedBase = (app.account || '') + String(app.ethBalance) + String(app.txCount);
  const txFactor = Math.min(1 + Math.log(Math.max(1, app.txCount)) / 15, 2.0);
  const leafCount = Math.min(MAX_PARTICLES, 40 + app.tokens.filter(t => !t.isNFT).length * 10);
  const branchCount = Math.max(1, app.branches.length);
  
  for (let i = 0; i < leafCount; i++) {
    const branchIdx = i % branchCount;
    const branch = app.branches[branchIdx];
    
    const t = 0.2 + seededRandomFloat(seedBase + i + 'leaf_t') * 0.8;
    const perpAngle = branch.angle + Math.PI / 2;
    const spread = (seededRandomFloat(seedBase + i + 'leaf_spread') - 0.5) * 60;
    
    const baseX = branch.startX + (branch.endX - branch.startX) * t;
    const baseY = branch.startY + (branch.endY - branch.startY) * t;
    
    const leafX = baseX + Math.cos(perpAngle) * spread;
    const leafY = baseY + Math.sin(perpAngle) * spread;
    
    const tokenForLeaf = branch.token || { balance: 1, address: String(i), symbol: 'T', isNFT: false };
    const bf = Math.min(tokenForLeaf.balance || 0, 20) / 20;
    
    app.leaves.push({
      x: leafX,
      y: leafY,
      baseX: baseX,
      baseY: baseY,
      r: 1.5 + 4 * bf,
      hue: branch.hue + (seededRandomFloat(seedBase + i + 'leaf_hue') - 0.5) * 30,
      token: tokenForLeaf,
      balanceFactor: bf,
      sway: seededRandomFloat(seedBase + i + 'sway') * Math.PI * 2,
      swaySpeed: 0.01 + seededRandomFloat(seedBase + i + 'swayspd') * 0.03 * txFactor,
      swayAmplitude: 5 + seededRandomFloat(seedBase + i + 'swayamp') * 15,
      branchRef: branchIdx
    });
  }
}

// ============================================
// ANIMĀCIJA UN KUSTĪBA
// ============================================

function animateLeaves(app, txSpeedFactor) {
  for (const leaf of app.leaves) {
    leaf.sway += leaf.swaySpeed * txSpeedFactor;
    const swayX = Math.cos(leaf.sway) * leaf.swayAmplitude;
    const swayY = Math.sin(leaf.sway * 1.3) * leaf.swayAmplitude * 0.5;
    leaf.x = leaf.baseX + swayX;
    leaf.y = leaf.baseY + swayY;
  }
}

function animateGlowingSeeds(app, txSpeedFactor) {
  ensureTreeTrunk(app);
  for (const seed of app.glowingSeeds) {
    seed.angle += seed.orbitSpeed * txSpeedFactor;
    seed.x = app.treeTrunk.x + Math.cos(seed.angle) * seed.orbitRadius;
    seed.y = app.treeTrunk.y - 100 + Math.sin(seed.angle) * seed.orbitRadius * 0.6;
    seed.glowPhase += 0.03 * txSpeedFactor;
  }
}

// ============================================
// ZĪMĒŠANA
// ============================================

function drawTrunk(ctx, app) {
  ensureTreeTrunk(app);
  const tx = app.treeTrunk.x;
  const ty = app.treeTrunk.y;
  const th = app.treeTrunk.height;
  const tw = app.treeTrunk.width;
  
  // Stumbrs
  const trunkGradient = ctx.createLinearGradient(tx - tw, 0, tx + tw, 0);
  trunkGradient.addColorStop(0, '#2d1f0e');
  trunkGradient.addColorStop(0.3, '#5c3a1e');
  trunkGradient.addColorStop(0.5, '#7a4f2b');
  trunkGradient.addColorStop(0.7, '#5c3a1e');
  trunkGradient.addColorStop(1, '#2d1f0e');
  
  ctx.fillStyle = trunkGradient;
  ctx.beginPath();
  ctx.moveTo(tx - tw * 0.5, ty);
  ctx.lineTo(tx - tw * 0.3, ty - th * 0.6);
  ctx.quadraticCurveTo(tx, ty - th, tx + tw * 0.3, ty - th * 0.6);
  ctx.lineTo(tx + tw * 0.5, ty);
  ctx.closePath();
  ctx.fill();
  
  // Saknes
  ctx.strokeStyle = '#3d2b1a';
  ctx.lineWidth = tw * 0.4;
  for (let i = 0; i < 5; i++) {
    const rootAngle = Math.PI / 2 + (i - 2) * 0.3;
    const rootLen = th * (0.3 + seededRandomFloat('root' + i) * 0.3);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(
      tx + Math.cos(rootAngle) * rootLen * 0.5,
      ty + Math.sin(rootAngle) * rootLen * 0.5,
      tx + Math.cos(rootAngle) * rootLen,
      ty + Math.sin(rootAngle) * rootLen
    );
    ctx.stroke();
  }
}

function drawBranches(ctx, app, frame) {
  for (const branch of app.branches) {
    const alpha = 0.6 + branch.level * 0.2;
    
    ctx.strokeStyle = `hsla(${branch.hue}, 40%, ${25 + branch.level * 10}%, ${alpha})`;
    ctx.lineWidth = branch.thickness;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(branch.startX, branch.startY);
    
    const midX = (branch.startX + branch.endX) / 2 + Math.sin(frame * 0.02 + branch.angle) * 5;
    const midY = (branch.startY + branch.endY) / 2 + Math.cos(frame * 0.02 + branch.angle) * 3;
    
    ctx.quadraticCurveTo(midX, midY, branch.endX, branch.endY);
    ctx.stroke();
  }
}

function drawLeaves(ctx, app, frame) {
  for (const leaf of app.leaves) {
    if (!leaf.cachedGradient) {
      leaf.cachedGradient = createParticleCache(app, leaf);
    }
    
    const alpha = 0.4 + Math.sin(frame * 0.05 + leaf.sway) * 0.2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      leaf.cachedGradient.canvas,
      leaf.x - leaf.cachedGradient.offset,
      leaf.y - leaf.cachedGradient.offset
    );
    ctx.globalAlpha = 1;
  }
}

function drawGlowingSeeds(ctx, app, frame) {
  for (const seed of app.glowingSeeds) {
    const glowIntensity = 0.5 + Math.sin(seed.glowPhase) * 0.5;
    
    // Ārējais mirdzums
    const outerGlow = ctx.createRadialGradient(seed.x, seed.y, 0, seed.x, seed.y, seed.radius * 4);
    outerGlow.addColorStop(0, `rgba(200, 255, 220, ${0.6 * glowIntensity})`);
    outerGlow.addColorStop(0.5, `rgba(150, 255, 180, ${0.3 * glowIntensity})`);
    outerGlow.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = outerGlow;
    ctx.beginPath(); ctx.arc(seed.x, seed.y, seed.radius * 4, 0, Math.PI * 2); ctx.fill();
    
    // Iekšējā sēkla
    const innerGlow = ctx.createRadialGradient(seed.x, seed.y, 0, seed.x, seed.y, seed.radius);
    innerGlow.addColorStop(0, `rgba(255, 255, 255, ${0.9 * glowIntensity})`);
    innerGlow.addColorStop(1, `rgba(180, 255, 200, ${0.7 * glowIntensity})`);
    ctx.fillStyle = innerGlow;
    ctx.beginPath(); ctx.arc(seed.x, seed.y, seed.radius, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFallingParticles(ctx, app, frame, W, H) {
  if (!app._fallingParticles) app._fallingParticles = [];
  const branchCount = Math.max(1, app.branches.length);
  const particleCount = 15 + Math.floor(app.txCount / 10);
  
  for (let i = 0; i < particleCount; i++) {
    if (!app._fallingParticles[i]) {
      const branch = app.branches[i % branchCount];
      app._fallingParticles[i] = {
        x: branch ? branch.endX + (Math.random() - 0.5) * 40 : W / 2,
        y: branch ? branch.endY : H * 0.3,
        r: 1 + Math.random() * 2,
        speed: 0.5 + Math.random() * 1.5,
        hue: branch ? branch.hue + Math.random() * 40 : 120,
        life: 1,
        decay: 0.003 + Math.random() * 0.007
      };
    }
    
    const p = app._fallingParticles[i];
    p.y += p.speed;
    p.life -= p.decay;
    
    if (p.life <= 0 || p.y > H + 50) {
      const branch = app.branches[i % branchCount];
      p.x = branch ? branch.endX + (Math.random() - 0.5) * 40 : W / 2;
      p.y = branch ? branch.endY : H * 0.3;
      p.life = 1;
      p.speed = 0.5 + Math.random() * 1.5;
      p.hue = branch ? branch.hue + Math.random() * 40 : 120;
    }
    
    if (p.life > 0) {
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${p.life * 0.7})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawOverlayText(ctx, app, addon) {
  const cfg = VIZ_CHAINS[app.currentVizChain];
  const isAmoy = app.currentVizChain === 'polygonAmoy' || cfg?.chainIdHex?.toLowerCase() === '0x13882';
  const sym = isAmoy ? 'POL' : (cfg?.nativeCurrency || 'ETH');
  const loading = UI.renderBtn && UI.renderBtn.disabled;
  ctx.fillStyle = '#0ff'; ctx.font = '20px Inter';
  ctx.fillText(loading ? `${sym}: Loading data...` : `${sym}: ${app.ethBalance.toFixed(4)}`, 15, 70);
  ctx.font = '14px Inter'; ctx.fillStyle = addon.color; ctx.fillText(`${addon.displayName} ACTIVE`, 15, 100);
  ctx.font = '11px Inter'; ctx.fillStyle = '#888';
  if (loading) { ctx.fillText('Updating blockchain state, please wait...', 15, 125); }
  else { const tc = app.tokens.filter(t => !t.isNFT).length; ctx.fillText(`TX: ${app.txCount} | Assets: ${app.tokens.length} (${tc} tokens, ${app.glowingSeeds.length} NFTs)`, 15, 125); }
}

// ============================================
// GALVENĀS ZĪMĒŠANAS FUNKCIJAS
// ============================================

export function drawFrame(app, frame, showTokensFrame) {
  const addon = window.ADDON_STYLES[app.currentAddonStyle];
  const W = app.canvasWidth || UI.canvas.width;
  const H = app.canvasHeight || UI.canvas.height;
  const ctx = app.ctx || UI.canvas.getContext('2d');
  
  // Fons
  const bgGradient = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H, H);
  bgGradient.addColorStop(0, '#0a0a1a');
  bgGradient.addColorStop(0.5, '#050510');
  bgGradient.addColorStop(1, '#000005');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, W, H);
  
  const txSpeedFactor = Math.min(1 + Math.log(Math.max(1, app.txCount + 1)) / 15, 2.0);
  
  animateLeaves(app, txSpeedFactor);
  animateGlowingSeeds(app, txSpeedFactor);
  
  // Zīmēšanas secība (no aizmugures uz priekšu)
  if (!VIZ_LOW_POWER_MODE || frame % 2 === 0) {
    drawFallingParticles(ctx, app, frame, W, H);
  }
  drawBranches(ctx, app, frame);
  drawLeaves(ctx, app, frame);
  drawGlowingSeeds(ctx, app, frame);
  drawTrunk(ctx, app);
  
  if (!VIZ_LOW_POWER_MODE || frame % 2 === 0) {
    addon.drawExtraEffects(ctx, W, H, frame, app.leaves, app.treeTrunk?.x || W / 2, app.treeTrunk?.y || H * 0.85);
  }
  if (showTokensFrame && app.showInfo) drawOverlayText(ctx, app, addon);
}

export function animate(app, frame = 0) {
  drawFrame(app, frame, true);
  app.animFrameId = requestAnimationFrame(() => animate(app, frame + 1));
}

export function stopAnimation(app) {
  if (app.animFrameId) { cancelAnimationFrame(app.animFrameId); app.animFrameId = null; }
}

// ============================================
// INICIALIZĀCIJA
// ============================================

export async function initParticlesOnce(app) {
  ensureTreeTrunk(app);
  
  // Atjauno stumbra izmērus pēc datiem
  const W = app.canvasWidth || UI.canvas.width || 1920;
  const H = app.canvasHeight || UI.canvas.height || 1080;
  app.treeTrunk.x = W / 2;
  app.treeTrunk.y = H * 0.85;
  app.treeTrunk.width = 15 + Math.min(Math.max(0, app.ethBalance) / 0.1, 1) * 20;
  app.treeTrunk.height = 250 + Math.min(app.txCount / 50, 1) * 200;
  
  app._fallingParticles = [];
  
  updateNFTCenters(app);
  generateBranches(app);
  generateLeaves(app);
}

export function cloneParticles(app) {
  return app.leaves.map(l => ({ ...l, x: l.baseX, y: l.baseY }));
}

// ============================================
// RENDERĒŠANA
// ============================================

export async function renderSnapshot(app, chain) {
  if (!app.account) return;
  app.tokens = [];
  app.ethBalance = 0;
  app.txCount = 0;
  app.glowingSeeds = [];
  app.branches = [];
  app.leaves = [];
  
  // Nodrošina treeTrunk uzreiz
  ensureTreeTrunk(app);
  
  setButtonLoading(UI.renderBtn, true);
  stopAnimation(app);
  cleanup(app);
  showProgress();
  app.particleCache.clear();
  
  showToast(`Loading ${chain} wallet data...`, 'info');
  
  const steps = [
    {
      name: 'Fetching balance...',
      func: async () => {
        const res = await fetch(`/api/getBalance?account=${app.account}&chain=${chain}`);
        const data = await res.json();
        app.ethBalance = Number(data.balance) || 0;
      }
    },
    {
      name: 'Transaction count...',
      func: async () => {
        const res = await fetch(`/api/getTransactionCount?account=${app.account}&chain=${chain}`);
        const data = await res.json();
        app.txCount = data.txCount || 0;
      }
    },
    {
      name: 'ERC-20 tokens...',
      func: async () => { app.tokens = await getTokens(app.account, chain); }
    },
    {
      name: 'NFTs...',
      func: async () => {
        const nfts = await getAllNFTs(app.account, chain);
        app.tokens = [...app.tokens, ...nfts];
        updateNFTCenters(app);
      }
    },
    {
      name: 'Growing the tree...',
      func: async () => {
        await initParticlesOnce(app);
        app.leaves = cloneParticles(app);
      }
    }
  ];
  
  let current = 0, visual = 0, running = true;
  const anim = () => {
    if (!running) return;
    visual += ((current / steps.length) - visual) * 0.05;
    UI.progressBar.style.transform = `scaleX(${visual})`;
    requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);
  
  try {
    for (const s of steps) {
      showToast(s.name, 'info');
      await s.func();
      current++;
    }
    
    if (app.showInfo && UI.tokenListContainer) {
      UI.tokenListContainer.style.display = 'block';
      updateTokenListUI(app.tokens);
    }
    
    running = false;
    UI.progressBar.style.transform = 'scaleX(1)';
    const cfg = VIZ_CHAINS[chain];
    const name = cfg ? cfg.name : chain;
    showToast(
      `✅ Connected to ${name}! Loaded ${app.tokens.length} assets (${app.tokens.filter(t => !t.isNFT).length} tokens, ${app.glowingSeeds.length} NFTs)`,
      'success'
    );
    hideProgress();
    animate(app);
  } catch (e) {
    running = false;
    hideProgress();
    console.error(e);
    showToast('Render failed: ' + e.message, 'error');
  } finally {
    setButtonLoading(UI.renderBtn, false);
  }
}
