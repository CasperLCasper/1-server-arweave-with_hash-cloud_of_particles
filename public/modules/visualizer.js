// ============================================ //
// VISUALIZER FUNCTIONS
// ============================================ //

import { UI } from './state.js';
import { showToast, showProgress, setProgress, hideProgress, setButtonLoading, updateTokenListUI } from './ui.js';
import { MAX_PARTICLES, CONNECTION_DISTANCE, VIZ_LOW_POWER_MODE } from './config.js';
import { getTokens, getAllNFTs } from './api.js';
import { VIZ_CHAINS } from './chains.js';

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
  app.particles = []; app.initialParticles = []; app.nftCenters = []; app.particleCache.clear();
  if (app.ctx) app.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
}

export function hashStringToInt(str, mod = 1000) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.codePointAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % mod;
}

export function seededRandomFloat(seedStr) { return hashStringToInt(seedStr, 10000) / 10000; }

export function createParticleCache(app, particle) {
  const cacheKey = `${particle.hue}_${particle.r}_${particle.balanceFactor}`;
  if (app.particleCache.has(cacheKey)) return app.particleCache.get(cacheKey);
  const size = Math.ceil(particle.r * 5);
  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = size; cacheCanvas.height = size;
  const cctx = cacheCanvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const gradient = cctx.createRadialGradient(cx, cy, 0, cx, cy, particle.r * 2.2);
  gradient.addColorStop(0, `hsla(${particle.hue}, 100%, 82%, 1)`);
  gradient.addColorStop(0.6, `hsla(${particle.hue}, 100%, 70%, 0.9)`);
  gradient.addColorStop(1, `hsla(${particle.hue + 20}, 100%, 55%, 0.4)`);
  cctx.fillStyle = gradient; cctx.beginPath(); cctx.arc(cx, cy, particle.r, 0, Math.PI * 2); cctx.fill();
  const cached = { canvas: cacheCanvas, size, offset: size / 2 };
  app.particleCache.set(cacheKey, cached);
  return cached;
}

export function updateNFTCenters(app) {
  app.nftCenters = [];
  const nftTokens = app.tokens.filter(t => t.isNFT);
  const W = app.canvasWidth || UI.canvas.width, H = app.canvasHeight || UI.canvas.height;
  const cx0 = W / 2, cy0 = H / 2;
  nftTokens.forEach((nft, idx) => {
    const angle = seededRandomFloat(nft.address + 'position') * Math.PI * 2;
    const radius = 80 + seededRandomFloat(nft.address + 'radius') * 150;
    app.nftCenters.push({ x: cx0 + Math.cos(angle) * radius, y: cy0 + Math.sin(angle) * radius, radius: 15, influence: 0.02, token: nft });
  });
}

function applyGravity(particles, nftCenters, cx0, cy0, txSpeedFactor) {
  for (const p of particles) {
    let gx = 0, gy = 0;
    for (const nft of nftCenters) {
      const dx = nft.x - (p.x || 0), dy = nft.y - (p.y || 0);
      const distSq = dx * dx + dy * dy;
      if (distSq > 0 && distSq < 62500) {
        const force = nft.influence * (1 - Math.sqrt(distSq) / 250) * txSpeedFactor;
        gx += dx * force; gy += dy * force;
      }
    }
    p.angleVelocity = Math.min(Math.max((p.angleVelocity || p.speed) + (gx + gy) * 0.0005, 0.001), 0.025);
    p.angle += p.angleVelocity * txSpeedFactor;
    p.x = cx0 + Math.cos(p.angle) * p.radius;
    p.y = cy0 + Math.sin(p.angle) * p.radius;
  }
}

function buildConnectionGroups(particles, addon, frame) {
  const thresholdSq = CONNECTION_DISTANCE * CONNECTION_DISTANCE;
  const groups = new Map();
  for (let i = 0; i < particles.length; i++) {
    const p1 = particles[i];
    for (let j = i + 1; j < particles.length; j++) {
      const p2 = particles[j];
      const dx = p1.x - p2.x, dy = p1.y - p2.y;
      if (dx * dx + dy * dy < thresholdSq) {
        const avgBalance = (Math.min(p1.token.balance, 20) + Math.min(p2.token.balance, 20)) / 40;
        const hue = (p1.hue + p2.hue) / 2 + frame * 0.3;
        const modified = addon.connectionColorModifier(hue, 100, 70, 0.5, 0);
        const colorKey = `${Math.floor(modified.hue / 30)}_${modified.sat}_${modified.light}`;
        if (!groups.has(colorKey)) groups.set(colorKey, { paths: [], color: `hsla(${modified.hue}, ${modified.sat}%, ${modified.light}%, ${modified.alpha})`, lineWidth: 1.2 + 1.8 * avgBalance });
        groups.get(colorKey).paths.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      }
    }
  }
  return groups;
}

function drawConnections(ctx, groups) {
  for (const group of groups.values()) {
    ctx.beginPath(); ctx.lineWidth = group.lineWidth; ctx.strokeStyle = group.color;
    for (const path of group.paths) { ctx.moveTo(path.x1, path.y1); ctx.lineTo(path.x2, path.y2); }
    ctx.stroke();
  }
}

function drawParticles(ctx, particles, addon, app, frame) {
  const useCache = !addon.particleColorModifier;
  for (let idx = 0; idx < particles.length; idx++) {
    const p = particles[idx];
    if (useCache) {
      if (!p.cachedGradient) p.cachedGradient = createParticleCache(app, p);
      ctx.drawImage(p.cachedGradient.canvas, p.x - p.cachedGradient.offset, p.y - p.cachedGradient.offset);
    } else {
      const m = addon.particleColorModifier(p.hue, 100, 70, idx, p.balanceFactor, frame);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.2);
      g.addColorStop(0, `hsla(${m.hue}, ${m.sat}%, ${m.light + 12}%, 1)`);
      g.addColorStop(0.6, `hsla(${m.hue}, ${m.sat}%, ${m.light}%, 0.9)`);
      g.addColorStop(1, `hsla(${m.hue + 20}, ${m.sat}%, ${m.light - 15}%, 0.4)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawNFTCenters(ctx, nftCenters) {
  for (const nft of nftCenters) {
    ctx.beginPath(); ctx.arc(nft.x, nft.y, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'; ctx.fill();
    ctx.beginPath(); ctx.arc(nft.x, nft.y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 215, 0, 0.8)'; ctx.fill();
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
  else { const tc = app.tokens.filter(t => !t.isNFT).length; ctx.fillText(`TX: ${app.txCount} | Assets: ${app.tokens.length} (${tc} tokens, ${app.nftCenters.length} NFTs)`, 15, 125); }
}

export function drawFrame(app, frame, showTokensFrame) {
  const addon = window.ADDON_STYLES[app.currentAddonStyle];
  const W = app.canvasWidth || UI.canvas.width, H = app.canvasHeight || UI.canvas.height;
  const ctx = app.ctx || UI.canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cx0 = W / 2, cy0 = H / 2;
  const txSpeedFactor = Math.min(1 + Math.log(app.txCount + 1) / 15, 2.0);
  applyGravity(app.particles, app.nftCenters, cx0, cy0, txSpeedFactor);
  const groups = buildConnectionGroups(app.particles, addon, frame);
  drawConnections(ctx, groups);
  drawParticles(ctx, app.particles, addon, app, frame);
  drawNFTCenters(ctx, app.nftCenters);
  if (!VIZ_LOW_POWER_MODE || frame % 2 === 0) addon.drawExtraEffects(ctx, W, H, frame, app.particles, cx0, cy0);
  if (showTokensFrame && app.showInfo) drawOverlayText(ctx, app, addon);
}

export function animate(app, frame = 0) { drawFrame(app, frame, true); app.animFrameId = requestAnimationFrame(() => animate(app, frame + 1)); }
export function stopAnimation(app) { if (app.animFrameId) cancelAnimationFrame(app.animFrameId); app.animFrameId = null; }

export async function initParticlesOnce(app) {
  app.initialParticles = [];
  const count = Math.min(MAX_PARTICLES, 40 + (app.tokens.filter(t => !t.isNFT).length || 0) * 8);
  const seedBase = (app.account || '') + String(app.ethBalance) + String(app.txCount);
  updateNFTCenters(app);
  for (let i = 0; i < count; i++) {
    const ti = i % (app.tokens.length || 1);
    const t = app.tokens.length ? app.tokens[ti] : { balance: 1, address: String(i), symbol: 'T', isNFT: false };
    const bf = t.isNFT ? 1 : Math.min(t.balance || 0, 20) / 20;
    let hue = (hashStringToInt((t.address || '') + seedBase + i) % 360 + (Math.min(app.ethBalance / 10, 1)) * 100) % 360;
    const speed = (0.0015 + 0.004 * (hashStringToInt((t.symbol || t.address) + seedBase + i, 10) / 10)) * Math.min(1 + Math.log(app.txCount + 1) / 15, 2.0);
    app.initialParticles.push({ angle: seededRandomFloat(seedBase + i + 'angle') * 2 * Math.PI, radius: 60 + seededRandomFloat(seedBase + i + 'radius') * 380, r: t.isNFT ? 12 : 2 + 5 * bf, hue, speed, angleVelocity: speed, token: t, balanceFactor: bf, x: 0, y: 0 });
  }
}

export function cloneParticles(app) { return app.initialParticles.map(p => ({ ...p, x: 0, y: 0 })); }

export async function renderSnapshot(app, chain) {
  if (!app.account) return;
  app.tokens = []; app.ethBalance = 0; app.txCount = 0; app.nftCenters = [];
  setButtonLoading(UI.renderBtn, true); stopAnimation(app); cleanup(app); showProgress(); app.particleCache.clear();
  showToast(`Loading ${chain} wallet data...`, 'info');
  
  const steps = [
    { name: 'Fetching balance...', func: async () => { 
      const res = await fetch(`/api/getBalance?account=${app.account}&chain=${chain}`);
      const data = await res.json();
      app.ethBalance = Number(data.balance) || 0;
    }},
    { name: 'Transaction count...', func: async () => { 
      const res = await fetch(`/api/getTransactionCount?account=${app.account}&chain=${chain}`);
      const data = await res.json();
      app.txCount = data.txCount || 0;
    }},
    { name: 'ERC-20 tokens...', func: async () => { app.tokens = await getTokens(app.account, chain); }},
    { name: 'NFTs...', func: async () => { const nfts = await getAllNFTs(app.account, chain); app.tokens = [...app.tokens, ...nfts]; updateNFTCenters(app); }},
    { name: 'Creating visualization...', func: async () => { await initParticlesOnce(app); app.particles = cloneParticles(app); }}
  ];
  
  let current = 0, visual = 0, running = true;
  const anim = () => { if (!running) return; visual += ((current / steps.length) - visual) * 0.05; UI.progressBar.style.transform = `scaleX(${visual})`; requestAnimationFrame(anim); };
  requestAnimationFrame(anim);
  
  try {
    for (const s of steps) { showToast(s.name, 'info'); await s.func(); current++; }
    if (app.showInfo && UI.tokenListContainer) { UI.tokenListContainer.style.display = 'block'; updateTokenListUI(app.tokens); }
    running = false; UI.progressBar.style.transform = 'scaleX(1)';
    const cfg = VIZ_CHAINS[chain]; const name = cfg ? cfg.name : chain;
    showToast(`✅ Connected to ${name}! Loaded ${app.tokens.length} assets (${app.tokens.filter(t => !t.isNFT).length} tokens, ${app.nftCenters.length} NFTs)`, 'success');
    hideProgress(); animate(app);
  } catch (e) { running = false; hideProgress(); console.error(e); showToast('Render failed: ' + e.message, 'error'); }
  finally { setButtonLoading(UI.renderBtn, false); }
}
