import { ethers } from 'ethers';

export async function onRequestGet(context) {
  const { env } = context;
  
  const status = {
    alchemy: { available: false, error: null },
    moralis: { available: false, error: null },
    rpc: { available: false, error: null }
  };

  // Pārbauda Alchemy REST API
  if (env.ALCHEMY_API_KEY) {
    try {
      const res = await fetch(`https://eth-sepolia.g.alchemy.com/nft/v2/${env.ALCHEMY_API_KEY}/getNFTs?owner=0x0000000000000000000000000000000000000000`);
      if (res.ok) {
        status.alchemy.available = true;
        console.log('✅ [STATUS] Alchemy API pieejams');
      } else {
        status.alchemy.error = `HTTP ${res.status}`;
        console.warn(`⚠️ [STATUS] Alchemy API: ${res.status}`);
      }
    } catch (err) {
      status.alchemy.error = err.message;
      console.error(`❌ [STATUS] Alchemy API: ${err.message}`);
    }
  } else {
    status.alchemy.error = 'API key not configured';
    console.warn('⚠️ [STATUS] Alchemy API key nav konfigurēts');
  }

  // Pārbauda Moralis REST API
  if (env.MORALIS_API_KEY) {
    try {
      const res = await fetch('https://deep-index.moralis.io/api/v2.2/0x0000000000000000000000000000000000000000/nft?chain=0xaa36a7', {
        headers: { 'accept': 'application/json', 'X-API-Key': env.MORALIS_API_KEY }
      });
      if (res.ok) {
        status.moralis.available = true;
        console.log('✅ [STATUS] Moralis API pieejams');
      } else {
        status.moralis.error = `HTTP ${res.status}`;
        console.warn(`⚠️ [STATUS] Moralis API: ${res.status}`);
      }
    } catch (err) {
      status.moralis.error = err.message;
      console.error(`❌ [STATUS] Moralis API: ${err.message}`);
    }
  } else {
    status.moralis.error = 'API key not configured';
    console.warn('⚠️ [STATUS] Moralis API key nav konfigurēts');
  }

  // Pārbauda Alchemy RPC
  if (env.ALCHEMY_RPC_URL) {
    try {
      const provider = new ethers.JsonRpcProvider(env.ALCHEMY_RPC_URL);
      await provider.getBlockNumber();
      status.rpc.available = true;
      console.log('✅ [STATUS] Alchemy RPC pieejams');
    } catch (err) {
      status.rpc.error = err.message;
      console.error(`❌ [STATUS] Alchemy RPC: ${err.message}`);
    }
  } else {
    status.rpc.error = 'RPC URL not configured';
    console.warn('⚠️ [STATUS] Alchemy RPC URL nav konfigurēts');
  }

  const anyAvailable = status.alchemy.available || status.moralis.available;
  const rpcAvailable = status.rpc.available;
  const canMint = anyAvailable && rpcAvailable;

  console.log(`📊 [STATUS] Dati: ${anyAvailable ? '✅' : '❌'} | RPC: ${rpcAvailable ? '✅' : '❌'} | Mint: ${canMint ? '✅' : '❌'}`);

  return new Response(JSON.stringify({
    ...status,
    canMint,
    anyAvailable
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
