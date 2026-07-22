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

async function checkAlchemyRPC(rpcUrl, status) {
  if (!rpcUrl) { status.rpc.error = 'RPC URL not configured'; return; }
  try {
    await (new ethers.JsonRpcProvider(rpcUrl)).getBlockNumber();
    status.rpc.available = true; console.log('✅ [STATUS] Alchemy RPC pieejams');
  } catch (err) { status.rpc.error = err.message; console.error(`❌ [STATUS] Alchemy RPC: ${err.message}`); }
}

export async function onRequestGet(context) {
  const { env } = context;
  const status = {
    alchemy: { available: false, error: null },
    moralis: { available: false, error: null },
    rpc: { available: false, error: null }
  };

  await Promise.all([
    checkAlchemyAPI(env.ALCHEMY_API_KEY, status),
    checkMoralisAPI(env.MORALIS_API_KEY, status),
    checkAlchemyRPC(env.ALCHEMY_RPC_URL, status)
  ]);

  const anyAvailable = status.alchemy.available || status.moralis.available;
  const canMint = anyAvailable && status.rpc.available;
  console.log(`📊 [STATUS] Dati: ${anyAvailable ? '✅' : '❌'} | RPC: ${status.rpc.available ? '✅' : '❌'} | Mint: ${canMint ? '✅' : '❌'}`);

  return new Response(JSON.stringify({ ...status, canMint, anyAvailable }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
