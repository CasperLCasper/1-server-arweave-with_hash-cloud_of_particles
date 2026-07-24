// ============================================ //
// getTokens.js - IZLABOTS
// ============================================ //

import { ethers } from "ethers";
import { getOptionalUser } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { getCache, setCache } from "../_lib/cache.js";

const getChainConfig = (chain, apiKey) => {
  const configs = {
    sepolia: {
      type: 'alchemy',
      url: `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    polygonAmoy: {
      type: 'alchemy',
      url: `https://polygon-amoy.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    bscTestnet: {
      type: 'alchemy',
      url: `https://bnb-testnet.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    arbitrumSepolia: {
      type: 'alchemy',
      url: `https://arb-sepolia.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    optimismSepolia: {
      type: 'alchemy',
      url: `https://opt-sepolia.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    baseSepolia: {
      type: 'alchemy',
      url: `https://base-sepolia.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    avalancheFuji: {
      type: 'alchemy',
      url: `https://avax-fuji.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    }
  };
  return configs[chain] || null;
};

const getMoralisChain = (chain) => {
  const chains = {
    sepolia: 'sepolia',
    polygonAmoy: 'amoy',
    arbitrumSepolia: 'arbitrum sepolia',
    optimismSepolia: 'optimism sepolia',
    baseSepolia: 'base sepolia',
    avalancheFuji: 'avalanche testnet'
  };
  return chains[chain] || 'sepolia';
};

async function fetchMoralisTokens(API_KEY, chain, owner) {
  const moralisChain = getMoralisChain(chain);
  const url = `https://deep-index.moralis.io/api/v2.2/${owner}/erc20?chain=${moralisChain}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-API-Key": API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Moralis Token API pievīla ar statusu: ${response.status}`);
  }

  const data = await response.json();
  
  return (data || []).map(t => ({
    contract: t.token_address,
    balance: t.balance,
    decimalBalance: BigInt(t.balance).toString()
  }));
}

async function fetchTokensWithFallback(env, chain, chainConfig, safeAccount) {
  try {
    const response = await fetch(chainConfig.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: chainConfig.method,
        params: [safeAccount],
        id: 42
      })
    });

    if (!response.ok) {
      throw new Error(`Alchemy Token API atgrieza statusu: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const balances = data?.result?.tokenBalances || [];
    
    return balances.map(t => ({
      contract: t.contractAddress,
      balance: t.tokenBalance,
      decimalBalance: BigInt(t.tokenBalance).toString()
    }));

  } catch (alchemyError) {
    console.warn("Alchemy Token API pārslogots vai pievīla. Slēdzamies pie Moralis...", alchemyError.message);
    
    try {
      return await fetchMoralisTokens(env.MORALIS_API_KEY, chain, safeAccount);
    } catch (moralisError) {
      console.error("Kritiskā kļūda: Abi Token servisi (Alchemy un Moralis) ir pievīluši!");
      throw moralisError;
    }
  }
}

export async function onRequestGet(context) {
  let chain = 'sepolia';

  try {
    const { request, env } = context;

    const url = new URL(request.url);
    const accountParam = url.searchParams.get("account");
    chain = url.searchParams.get("chain") || 'sepolia';

    const chainConfig = getChainConfig(chain, env.ALCHEMY_API_KEY);
    if (!chainConfig) {
      return new Response(JSON.stringify({ error: `Unsupported chain: ${chain}` }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const user = await getOptionalUser(request, env);
    let account = accountParam || (user ? user.address : null);

    if (!account) {
      return new Response(JSON.stringify({ error: "Missing account" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    let safeAccount;
    try {
      safeAccount = ethers.getAddress(account);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid address" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = user ? `user_${user.address}_tokens_${chain}` : `ip_${ip}_tokens_${chain}`;

    if (!(await checkRateLimit({ key }, env))) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cacheKey = `tokens_${safeAccount}_${chain}`;
    const cached = await getCache(cacheKey, env);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const BSCSCAN_API_KEY = env.BSCSCAN_API_KEY;
    
    let tokens = [];
    
    if (chainConfig.type === 'bscscan') {
      const txUrl = `https://api-testnet.bscscan.com/api?module=account&action=tokentx&address=${safeAccount}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
      const txResponse = await fetch(txUrl);
      const txData = await txResponse.json();
      
      if (txData.status === '1' && txData.result) {
        const tokenMap = new Map();
        txData.result.forEach(tx => {
          if (!tokenMap.has(tx.contractAddress)) {
            tokenMap.set(tx.contractAddress, {
              contract: tx.contractAddress,
              symbol: tx.tokenSymbol,
              decimals: Number.parseInt(tx.tokenDecimal),
              balance: tx.value,
              decimalBalance: BigInt(tx.value).toString()
            });
          }
        });
        tokens = Array.from(tokenMap.values());
      }
    } else {
      tokens = await fetchTokensWithFallback(env, chain, chainConfig, safeAccount);
    }

    const result = { tokens, chain };

    await setCache(cacheKey, result, env, 60000);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("TOKEN ERROR for chain:", chain, err);
    return new Response(JSON.stringify({ 
      error: "Failed to fetch tokens", 
      details: err.message,
      tokens: [] 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
