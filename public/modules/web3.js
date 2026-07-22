// ============================================ //
// WEB3 FUNCTIONS
// ============================================ //

import { VIZ_CHAINS, MINT_CHAIN, getAllRpcUrls, getRpcUrl } from './chains.js';
import { UI } from './state.js';
import { showToast, showWarning, setButtonLoading, showProgress, hideProgress } from './ui.js';
import { login, getNFTPrice, getContractAddress } from './api.js';

let platformUnavailable = false;

export async function updateChainStatus() {
  if (!window.ethereum || !UI.chainStatus) return;
  try {
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    const selectedChainKey = UI.chainSelect ? UI.chainSelect.value : null;
    const selectedChain = VIZ_CHAINS[selectedChainKey];
    if (selectedChain && chainIdHex && chainIdHex.toLowerCase() === selectedChain.chainIdHex.toLowerCase()) {
      UI.chainStatus.className = 'chain-status connected';
      UI.chainStatus.title = `✓ Connected to ${selectedChain.name}`;
    } else {
      UI.chainStatus.className = 'chain-status disconnected';
      UI.chainStatus.title = '⚠️ Please switch network in your wallet';
    }
  } catch (error) {
    UI.chainStatus.className = 'chain-status disconnected';
    UI.chainStatus.title = '❌ Unable to detect network';
  }
}

export async function switchToMintChain() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MINT_CHAIN.chainIdHex }] });
  } catch (error) {
    if (error.code === 4902) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: MINT_CHAIN.chainIdHex, chainName: MINT_CHAIN.name, nativeCurrency: { name: MINT_CHAIN.nativeCurrency, symbol: MINT_CHAIN.nativeCurrency, decimals: 18 }, rpcUrls: getAllRpcUrls('baseSepolia'), blockExplorerUrls: [MINT_CHAIN.blockExplorer] }] });
    } else {
      throw error;
    }
  }
}

function isNetworkMissingError(error) {
  return error.code === 4902 || (error.message && (error.message.includes('not supported') || error.message.includes('wallet_switchEthereumChain')));
}

function findChainConfig(chainIdHex) {
  return Object.values(VIZ_CHAINS).find(c => c.chainIdHex && chainIdHex && c.chainIdHex.toLowerCase() === chainIdHex.toLowerCase());
}

function getAddChainParams(chainConfig) {
  const isAmoy = chainConfig.chainIdHex.toLowerCase() === '0x13882';
  const currencySymbol = isAmoy ? 'POL' : (chainConfig.nativeCurrency || 'ETH');
  const explorerUrl = isAmoy ? 'https://amoy.polygonscan.com/' : chainConfig.blockExplorer;
  const rpcUrlsArray = isAmoy ? ['https://rpc-amoy.polygon.technology'] : (Array.isArray(chainConfig.rpc) ? chainConfig.rpc : [chainConfig.rpc]);
  const chainName = isAmoy ? 'Polygon Amoy Testnet' : chainConfig.name;
  return { chainId: chainConfig.chainIdHex, chainName, nativeCurrency: { name: currencySymbol, symbol: currencySymbol, decimals: 18 }, rpcUrls: rpcUrlsArray, blockExplorerUrls: explorerUrl ? [explorerUrl] : [] };
}

export async function switchToVizChain(chainIdHex) {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    await updateChainStatus();
  } catch (error) {
    if (isNetworkMissingError(error)) {
      const chainConfig = findChainConfig(chainIdHex);
      if (chainConfig) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [getAddChainParams(chainConfig)] });
        await updateChainStatus();
      }
    } else {
      throw error;
    }
  }
}

function setButtonPriceState(btn, price, disabled, title = '') {
  if (!btn) return;
  btn.dataset.price = price;
  btn.disabled = disabled;
  if (title) btn.title = title;
}

async function checkServiceStatus() {
  const res = await fetch('/api/status');
  return res.json();
}

async function fetchBalanceAndPrice(account) {
  const rpc = getRpcUrl('baseSepolia') || 'https://sepolia.base.org';
  const provider = new ethers.JsonRpcProvider(rpc);
  const contractAddress = await getContractAddress();
  if (!contractAddress) throw new Error('Contract not found');
  const contract = new ethers.Contract(contractAddress, ["function mintPrice() view returns (uint256)"], provider);
  const [mintPriceWei, balanceWei] = await Promise.all([contract.mintPrice(), provider.getBalance(account)]);
  return { mintPriceWei, balanceWei, provider };
}

async function updateBalanceDisplay(account) {
  const balanceDisplay = document.getElementById('balanceDisplay');
  if (!balanceDisplay) return;
  platformUnavailable = false;

  try {
    const status = await checkServiceStatus();
    if (!status.canMint) {
      platformUnavailable = true;
      throw new Error('Service unavailable');
    }

    balanceDisplay.textContent = '💰 Checking balance...';
    balanceDisplay.className = 'balance-display checking';

    const { mintPriceWei, balanceWei } = await fetchBalanceAndPrice(account);
    const balanceFormatted = Number.parseFloat(ethers.formatEther(balanceWei)).toFixed(5);
    const mintPriceFormatted = Number.parseFloat(ethers.formatEther(mintPriceWei)).toFixed(5);

    const enough = balanceWei >= mintPriceWei;
    balanceDisplay.textContent = enough ? `✅ Balance: ${balanceFormatted} Base ETH (enough to mint)` : `⚠️ Balance: ${balanceFormatted} Base ETH (need ${mintPriceFormatted} Base ETH to mint)`;
    balanceDisplay.className = enough ? 'balance-display sufficient' : 'balance-display insufficient';

    const canMint = enough && status.canMint;
    setButtonPriceState(UI.generateNFTBtn, `${mintPriceFormatted} Base ETH`, !canMint, enough ? '' : 'Insufficient balance to mint');

  } catch (error) {
    console.error("Balance check failed:", error);
    balanceDisplay.textContent = '❌ Unable to check balance. Please refresh.';
    balanceDisplay.className = 'balance-display insufficient';
    setButtonPriceState(UI.generateNFTBtn, 'Unavailable', true, 'Unable to check balance');
    platformUnavailable = true;
    showWarning('⛔ Platform temporarily unavailable due to external circumstances. Please try again later.', true);
  }
}

function getConnectErrorMessage(err) {
  if (err.message && err.message.includes('User rejected')) return 'You cancelled the connection. Please approve to continue.';
  if (err.message && err.message.includes('Login rejected')) return 'You need to sign the message to access your wallet data.';
  if (err.message && err.message.includes('Already processing')) return 'Please wait, wallet is busy. Try again in a moment.';
  return 'Unable to connect wallet. Please try again.';
}

export async function connectWallet(app) {
  setButtonLoading(UI.connectBtn, true);
  showProgress();
  platformUnavailable = false;

  try {
    if (!window.ethereum) {
      alert('Please install a wallet like MetaMask, Rabby, or Enkrypt to use this app.');
      return;
    }

    app.currentVizChain = UI.chainSelect.value;
    const vizChainConfig = VIZ_CHAINS[app.currentVizChain];
    if (!vizChainConfig) { showToast('Please select a valid blockchain network', 'warning'); throw new Error('Invalid chain selected'); }

    await switchToVizChain(vizChainConfig.chainIdHex);

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const account = await signer.getAddress();
    Object.assign(app, { provider, signer, account });

    UI.accountDisplay.textContent = `Connected account: ${account}`;
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!(await login(signer, account))) {
      showToast('🔐 You need to sign the message to continue', 'warning');
      throw new Error('Login rejected');
    }

    await app.renderSnapshot(app.currentVizChain);
    UI.recordBtn.disabled = false;
    setButtonPriceState(UI.generateNFTBtn, 'Checking...', true);

    await updateChainStatus();
    await updateBalanceDisplay(account);

    const tokenCount = app.tokens.filter(t => !t.isNFT).length;
    if (platformUnavailable) {
      showToast('⚠️ Platform operating in limited mode. Minting is disabled.', 'warning');
    } else {
      showToast(`✅ Connected to ${vizChainConfig.name}! Loaded ${app.tokens.length} assets (${tokenCount} tokens, ${app.nftCenters.length} NFTs)`, 'success');
    }
  } catch (err) {
    console.error(err);
    showToast(getConnectErrorMessage(err), 'error');
    if (err.message && (err.message.includes('User rejected') || err.message.includes('Login rejected'))) {
      app.provider = null; app.signer = null; app.account = null;
      if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    }
  } finally {
    setButtonLoading(UI.connectBtn, false);
    hideProgress();
  }
}
