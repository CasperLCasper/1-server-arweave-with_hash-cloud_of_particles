import { ethers } from "ethers";
import { getOptionalUser } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { getCache, setCache } from "../_lib/cache.js";

// Chain konfigurācija pielāgota, lai API_KEY tiktu nodots dinamiski
const getChainConfig = (chain, apiKey) => {
  const configs = {
    sepolia: {
      type: 'alchemy',
      url: `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    mumbai: {
      type: 'alchemy',
      url: `https://polygon-amoy.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    },
    bscTestnet: {
      type: 'bscscan',
      url: `https://api-testnet.bscscan.com/api`,
      method: 'bscscan'
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
      url: `https://avalanche-fuji.g.alchemy.com/v2/${apiKey}`,
      method: 'alchemy_getTokenBalances'
    }
  };
  return configs[chain] || configs.sepolia;
};

// Palīgfunkcija Moralis tīklu ID salāgošanai
const getMoralisChain = (chain) => {
  const chains = {
    sepolia: 'sepolia',
    mumbai: 'amoy',
    arbitrumSepolia: 'arbitrum sepolia',
    optimismSepolia: 'optimism sepolia',
    baseSepolia: 'base sepolia',
    avalancheFuji: 'fuji'
  };
  return chains[chain] || 'sepolia';
};

// Moralis alternatīva ERC-20 tokenu iegūšanai
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
  
  // Pārveidojam Moralis atbildi, lai tā precīzi sakristu ar Alchemy datu struktūru
  return (data || []).map(t => ({
    contract: t.token_address,
    balance: t.balance,
    decimalBalance: BigInt(t.balance).toString()
  }));
}

// Droša hibrīda funkcija, kas sargā pret Alchemy 429 kļūdām
async function fetchTokensWithFallback(env, chain, chainConfig, safeAccount) {
  try {
    // 1. Mēģinām Alchemy
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
      // 2. Ja Alchemy pieviļ, izpildām pieprasījumu caur Moralis
      return await fetchMoralisTokens(env.MORALIS_API_KEY, chain, safeAccount);
    } catch (moralisError) {
      console.error("Kritiskā kļūda: Abi Token servisi (Alchemy un Moralis) ir pievīluši!");
      throw moralisError; // Metam kļūdu tālāk, lai nekešotu tukšus datus
    }
  }
}

// Izmantojam onRequestGet tikai GET pieprasījumiem
export async function onRequestGet(context) {
  let chain = 'sepolia';

  try {
    const { request, env } = context;

    const url = new URL(request.url);
    const accountParam = url.searchParams.get("account");
    chain = url.searchParams.get("chain") || 'sepolia';

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

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = user ? `user_${user.address}_tokens_${chain}` : `ip_${ip}_tokens_${chain}`;

    if (!(await checkRateLimit({ key }, env))) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Cache pārbaude
    const cacheKey = `tokens_${safeAccount}_${chain}`;
    const cached = await getCache(cacheKey, env);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const API_KEY = env.ALCHEMY_API_KEY;
    const BSCSCAN_API_KEY = env.BSCSCAN_API_KEY;
    
    const chainConfig = getChainConfig(chain, API_KEY);
    
    let tokens = [];
    
    if (chainConfig.type === 'bscscan') {
      // BSCScan tokenu vēstures skenēšana (darbojas kā drošs un stabils saraksta avots testnetā)
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
              balance: tx.value, // Šeit tiek paņemta pēdējā pārvietotā vērtība kā sākumpunkts
              decimalBalance: BigInt(tx.value).toString()
            });
          }
        });
        tokens = Array.from(tokenMap.values());
      }
    } else {
      // Izmantojam jauno drošo hibrīda funkciju EVM tīkliem
      tokens = await fetchTokensWithFallback(env, chain, chainConfig, safeAccount);
    }

    const result = { tokens, chain };

    // Saglabājam kešā tikai tad, ja veiksmīgi dabūjām datus
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
