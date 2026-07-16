// ============================================ //
// UI FUNCTIONS - CSP DROŠA VERSIJA
// Dizains nemainīgs, tikai bez inline stiliem
// ============================================ //

import { UI } from './state.js';

export function showWarning(message, show = true) {
  if (UI.warningBanner) {
    UI.warningBanner.textContent = message;
    if (show) UI.warningBanner.classList.add('show');
    else UI.warningBanner.classList.remove('show');
  }
}

export function showToast(message, type = 'info') {
  UI.statusMsg.textContent = message;
  console.log(`[${type}] ${message}`);
}

export function showProgress() { 
  if (!UI.progressBarContainer || !UI.progressBar) return;
  UI.progressBarContainer.classList.remove('progress-hidden');
  UI.progressBar.classList.remove('progress-full');
  UI.progressBar.classList.add('progress-empty');
}

export function hideProgress() { 
  if (!UI.progressBarContainer || !UI.progressBar) return;
  UI.progressBar.classList.remove('progress-empty');
  UI.progressBar.classList.add('progress-full');
  setTimeout(() => { 
    UI.progressBarContainer.classList.add('progress-hidden');
    UI.progressBar.classList.remove('progress-full');
    UI.progressBar.classList.add('progress-empty');
  }, 500); 
}

export function setProgress(percent) { 
  if (!UI.progressBar) return;
  UI.progressBar.style.transform = `scaleX(${Math.min(percent / 100, 1)})`;
}

export function setButtonLoading(button, isLoading) { 
  if (isLoading) { button.classList.add('loading'); button.disabled = true; } 
  else { button.classList.remove('loading'); button.disabled = false; } 
}

export function updateTokenListUI(tokens) {
  if (!UI.tokenListContent) return;
  
  // Notīrām saturu droši, bez innerHTML
  while (UI.tokenListContent.firstChild) {
    UI.tokenListContent.removeChild(UI.tokenListContent.firstChild);
  }
  
  if (!tokens || tokens.length === 0) { 
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '2');
    td.classList.add('no-assets-cell');
    td.textContent = 'No assets';
    tr.appendChild(td);
    UI.tokenListContent.appendChild(tr);
    return; 
  }
  
  const fragment = document.createDocumentFragment();
  const maxTokens = tokens.length;
  tokens.slice(0, maxTokens).forEach(t => {
    const tr = document.createElement('tr');
    
    const addrTd = document.createElement('td');
    addrTd.textContent = t.address;
    addrTd.title = t.address;
    
    const balTd = document.createElement('td');
    balTd.textContent = t.isNFT ? t.balance : t.balance.toFixed(4);
    
    tr.appendChild(addrTd);
    tr.appendChild(balTd);
    fragment.appendChild(tr);
  });
  
  UI.tokenListContent.appendChild(fragment);
}

export function safeClearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
