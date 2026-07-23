import { ethers } from 'ethers';

async function checkAlchemyAPI(apiKey, status) {
  if (!apiKey) { status.alchemy.error = 'API key not configured'; return; }
  try {
    const res = await fetch(`https://eth-sepolia.g.alchemy.com/nft/v2/${apiKey}/getNFTs?owner=0x0000000000000000000000000000000000000000`);
    if (res.ok || res.status === 400) { status.alchemy.available = true; console.log('✅ [STATUS] Alchemy API pieejams'); }
    else { status.alchemy.error = `HTTP ${res.status}`; console.warn(`⚠️ [STATUS] Alchemy API: ${res.status}`); }
  } catch (err) { status.alchemy.error = err.message; console.error(`❌ [STATUS] Alchemy API: ${err.message}`); }
}

async function checkMoralisAPI(apiKey, status) {
  if (!apiKey) { status.moralis.error = 'API key not configured'; return; }
  try {
    const res = await fetch('https://deep-index.moralis.io/api/v2.2/0x0000000000000000000000000000000000000000/nft?chain=0xaa36a7', {
      headers: { 'accept': 'application/json', 'X-API-Key': apiKey }
    });
    if (res.ok) { status.moralis.available = true; console.log('✅ [STATUS] Moralis API pieejams'); }
    else { status.moralis.error = `HTTP ${res.status}`; console.warn(`⚠️ [STATUS] Moralis API: ${res.status}`); }
  } catch (err) { status.moralis.error = err.message; console.error(`❌ [STATUS] Moralis API: ${err.message}`); }
}

async function testRPC(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: controller.signal
    });
    return res.ok;
  } catch { return false; }
  finally { clearTimeout(timeoutId); }
}

async function checkRPC(rpcUrl, label, statusObj) {
  if (!rpcUrl) { statusObj.error = 'RPC URL not configured'; return; }
  if (await testRPC(rpcUrl)) {
    statusObj.available = true;
    console.log(`✅ [STATUS] ${label} pieejams`);
  } else {
    statusObj.error = 'timeout';
    console.warn(`⚠️ [STATUS] ${label}: timeout`);
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const status = {
    alchemy: { available: false, error: null },
    moralis: { available: false, error: null },
    rpc: { alchemy: { available: false, error: null }, moralis: { available: false, error: null } }
  };

  await Promise.all([
    checkAlchemyAPI(env.ALCHEMY_API_KEY, status),
    checkMoralisAPI(env.MORALIS_API_KEY, status),
    checkRPC(env.ALCHEMY_RPC_URL, 'Alchemy RPC', status.rpc.alchemy),
    checkRPC(env.MORALIS_RPC_URL, 'Moralis RPC', status.rpc.moralis)
  ]);

  const anyAvailable = status.alchemy.available || status.moralis.available;
  const rpcAvailable = status.rpc.alchemy.available || status.rpc.moralis.available;
  const canMint = anyAvailable && rpcAvailable;

  console.log(`📊 [STATUS] Dati: ${anyAvailable ? '✅' : '❌'} | RPC: ${rpcAvailable ? '✅' : '❌'} | Mint: ${canMint ? '✅' : '❌'}`);

  return new Response(JSON.stringify({ ...status, canMint, anyAvailable }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
