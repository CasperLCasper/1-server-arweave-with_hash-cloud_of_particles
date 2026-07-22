// ============================================ //
// API FUNCTIONS (with JWT nonce support)
// ============================================ //

import { CONTRACT_ABI, getMintProvider } from './config.js';
import { MINT_CHAIN } from './chains.js';

const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 1000;
const MAX_PAGES = 10;

async function safeJson(response) {
  try { return await response.json(); } catch { throw new Error('Invalid response from server'); }
}

async function safeErrorText(response) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const { value } = await reader.read();
    return value ? new TextDecoder().decode(value).substring(0, 200) : '';
  } catch { return ''; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, retries = RETRY_COUNT) {
  const method = (options.method || 'GET').toUpperCase();
  const canRetry = method === 'GET';
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      if (response.status >= 500 && canRetry && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if ((error.name === 'AbortError' || error instanceof TypeError) && canRetry && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      if (error.name === 'AbortError') throw new Error('Request took too long. Please check your connection.');
      throw error;
    }
  }
  throw lastError || new Error('Unable to complete request. Please try again.');
}

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("auth_token");
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetchWithTimeout(url, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem("auth_token");
    window.dispatchEvent(new CustomEvent("auth:expired", { detail: { message: "Your session has expired. Please reconnect your wallet." } }));
    throw new Error("SESSION_EXPIRED");
  }
  if (!response.ok) {
    const errorText = await safeErrorText(response);
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }
  return response;
}

async function getNonce() {
  const res = await fetch('/api/auth/nonce');
  if (!res.ok) throw new Error(`Failed to get nonce: ${await safeErrorText(res)}`);
  return (await safeJson(res)).nonce;
}

export async function login(signer, account) {
  if (!signer) return false;
  try {
    const nonceToken = await getNonce();
    const message = `${nonceToken} - Login to NFT Wallet Visualizer`;
    const signature = await signer.signMessage(message);
    const res = await fetchWithTimeout('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: account, message, signature }) });
    if (!res.ok) throw new Error(`Login failed: ${await safeErrorText(res)}`);
    const data = await safeJson(res);
    if (data.token) { localStorage.setItem("auth_token", data.token); return true; }
    return false;
  } catch (error) { console.error("Login error:", error); return false; }
}

export async function getContractAddress() {
  try {
    const res = await fetchWithTimeout('/api/getContractAddress');
    if (!res.ok) throw new Error('Failed to get contract address');
    const data = await safeJson(res);
    if (!data.address) throw new Error('Contract address not found');
    return data.address;
  } catch (error) { console.error("Failed to get contract address:", error); return null; }
}

export async function getNFTPrice() {
  try {
    const contractAddress = await getContractAddress();
    if (!contractAddress) return "Price unavailable";
    const provider = await getMintProvider();
    const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
    return `${ethers.formatEther(await contract.mintPrice())} ETH`;
  } catch (error) { console.error("Failed to get NFT price:", error); return "Price unavailable"; }
}

function formatTokenBalance(t) {
  const decimals = t.decimals || 18;
  const rawBalance = t.balance || "0";
  try {
    const formatted = Number(ethers.formatUnits(rawBalance, decimals));
    return Number.isFinite(formatted) ? formatted : 0;
  } catch { return 0; }
}

function getTokenSymbol(t) {
  return t.symbol || t.name || (t.contract || t.contractAddress || '').substring(0, 8) + '...';
}

export async function getTokens(account, chain) {
  if (!account) return [];
  try {
    const backendChain = chain === 'polygonAmoy' ? 'mumbai' : chain;
    const url = `/api/getTokens?account=${encodeURIComponent(account)}&chain=${backendChain}`;
    const res = await apiFetch(url);
    const data = await safeJson(res);
    if (!data?.tokens) return [];
    return data.tokens.map(t => ({
      address: t.contract || t.contractAddress || "",
      balance: formatTokenBalance(t),
      symbol: getTokenSymbol(t),
      isNFT: false
    })).filter(t => t.balance > 0);
  } catch(e) { console.error("GetTokens Error:", e); return []; }
}

function extractNFTsFromResponse(data) {
  if (data?.result?.nfts) return data.result.nfts;
  if (data?.nfts) return data.nfts;
  if (Array.isArray(data)) return data;
  return [];
}

function formatNFT(nft) {
  const symbol = nft.contract?.symbol || nft.symbol || nft.contract?.name || 'NFT';
  return {
    address: nft.contract?.address || nft.contractAddress || nft.address || '',
    symbol, balance: 1, isNFT: true,
    tokenId: nft.id?.tokenId || nft.tokenId || nft.id || ''
  };
}

export async function getAllNFTs(account, chain) {
  if (!account) return [];
  try {
    const backendChain = chain === 'polygonAmoy' ? 'mumbai' : chain;
    const allNFTs = [];
    let pageKey = null;
    const seenPageKeys = new Set();

    for (let i = 0; i < MAX_PAGES; i++) {
      let url = `/api/getAllNFTs?account=${encodeURIComponent(account)}&chain=${backendChain}`;
      if (pageKey) url += `&pageKey=${pageKey}`;
      const res = await apiFetch(url);
      const data = await safeJson(res);
      const nfts = extractNFTsFromResponse(data);
      if (!nfts || nfts.length === 0) break;
      allNFTs.push(...nfts);
      const newPageKey = data?.result?.pageKey || data?.pageKey;
      if (!newPageKey || seenPageKeys.has(newPageKey)) break;
      seenPageKeys.add(newPageKey);
      pageKey = newPageKey;
    }

    console.log(`✅ Loaded ${allNFTs.length} NFTs from ${chain}`);
    return allNFTs.map(formatNFT);
  } catch(e) { console.error("GetAllNFTs Error:", e); return []; }
}
