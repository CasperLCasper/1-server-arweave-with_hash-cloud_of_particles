// ============================================ //
// getNFTs.js - IZLABOTS
// ============================================ //

import { ethers } from "ethers";
import { getOptionalUser } from "../_lib/auth.js";
import { getCache, setCache } from "../_lib/cache.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

const MAX_PAGES = 5;

const getChainConfig = (chain) => {
  const configs = {
    sepolia: { type: 'alchemy', network: 'eth-sepolia' },
    polygonAmoy: { type: 'alchemy', network: 'polygon-amoy' },
    bscTestnet: { type: 'alchemy', network: 'bnb-testnet' },
    arbitrumSepolia: { type: 'alchemy', network: 'arb-sepolia' },
    optimismSepolia: { type: 'alchemy', network: 'opt-sepolia' },
    baseSepolia: { type: 'alchemy', network: 'base-sepolia' },
    avalancheFuji: { type: 'alchemy', network: 'avax-fuji' }
  };
  return configs[chain] || null;
};

const getMoralisChain = (chain) => {
  const chains = {
    sepolia: 'sepolia',
    polygonAmoy: 'amoy',
    bscTestnet: 'bsc',
    arbitrumSepolia: 'arbitrum sepolia',
    optimismSepolia: 'optimism sepolia',
    baseSepolia: 'base sepolia',
    avalancheFuji: 'avalanche testnet'
  };
  return chains[chain] || 'sepolia';
};

const getAlchemyNFTUrl = ({ apiKey, network, owner, contract, pageKey }) => {
  let url = `https://${network}.g.alchemy.com/nft/v2/${apiKey}/getNFTs?owner=${owner}`;
  if (contract) url += `&contractAddresses[]=${contract}`;
  if (pageKey) url += `&pageKey=${pageKey}`;
  return url;
};

async function fetchMoralisNFTs(API_KEY, chain, owner, contract) {
  const moralisChain = getMoralisChain(chain);
  let url = `https://deep-index.moralis.io/api/v2.2/${owner}/nft?chain=${moralisChain}&format=decimal`;
  
  if (contract) {
    url += `&token_addresses%5B0%5D=${contract}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-API-Key": API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Moralis API pievīla ar statusu: ${response.status}`);
  }

  const data = await response.json();
  
  return (data.result || []).map(nft => ({
    contract: {
      address: nft.token_address,
      symbol: nft.symbol || "NFT"
    },
    id: {
      tokenId: nft.token_id
    }
  }));
}

async function fetchNFTsWithFallback(env, chain, chainConfig, safeAccount, safeContract) {
  try {
    const allNFTs = [];
    let pageKey = null;
    
    for (let i = 0; i < MAX_PAGES; i++) {
      const alchemyUrl = getAlchemyNFTUrl({
        apiKey: env.ALCHEMY_API_KEY,
        network: chainConfig.network,
        owner: safeAccount,
        contract: safeContract,
        pageKey
      });

      const response = await fetch(alchemyUrl);
      
      if (!response.ok) {
        throw new Error(`Alchemy_Error_Status_${response.status}`);
      }
      
      const data = await response.json();
      allNFTs.push(...(data?.ownedNfts || []));
      
      if (!data?.pageKey) break;
      pageKey = data.pageKey;
    }
    
    return allNFTs;

  } catch (alchemyError) {
    console.warn("Alchemy NFT API pārslogots vai pievīla. Slēdzamies pie Moralis...", alchemyError.message);
    
    try {
      const moralisNFTs = await fetchMoralisNFTs(
        env.MORALIS_API_KEY, 
        chain, 
        safeAccount, 
        safeContract
      );
      return moralisNFTs;
    } catch (moralisError) {
      console.error("Kritiskā kļūda: Abi NFT servisi (Alchemy un Moralis) ir pievīluši!");
      throw moralisError; 
    }
  }
}

const getBSCScanNFTs = async (owner, apiKey) => {
  const url = `https://api-testnet.bscscan.com/api?module=account&action=tokennfttx&address=${owner}&sort=desc&apikey=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== '1' || !data.result) return [];
  
  const uniqueNFTs = new Map();
  data.result.forEach(tx => {
    const key = `${tx.contractAddress}_${tx.tokenID}`;
    if (!uniqueNFTs.has(key)) {
      uniqueNFTs.set(key, {
        contract: { address: tx.contractAddress, symbol: tx.tokenSymbol || 'NFT' },
        id: { tokenId: tx.tokenID },
        balance: 1
      });
    }
  });
  
  return Array.from(uniqueNFTs.values());
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getAccount(user, accountParam) {
  const account = accountParam || (user?.address || null);
  if (!account) {
    return { error: "Missing account. Please provide it in query or log in." };
  }
  return { account };
}

function validateEthereumAddress(address) {
  try {
    return { address: ethers.getAddress(address) };
  } catch {
    return { error: "Invalid Ethereum address" };
  }
}

async function checkRateLimitForKey(request, user, chain, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateKey = user ? `user_${user.address}_nfts_${chain}` : `ip_${ip}_nfts_${chain}`;
  
  if (!(await checkRateLimit({ key: rateKey }, env))) {
    return false;
  }
  return true;
}

function formatNFTs(nfts, chain) {
  return nfts.map(nft => ({
    contract: {
      address: nft.contract?.address || "",
      symbol: nft.contract?.symbol || "NFT"
    },
    id: {
      tokenId: nft.id?.tokenId || ""
    },
    balance: 1,
    chain
  }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let chain = 'sepolia';

  try {
    const url = new URL(request.url);
    const accountParam = url.searchParams.get("account");
    const contract = url.searchParams.get("contract");
    chain = url.searchParams.get("chain") || 'sepolia';

    const chainConfig = getChainConfig(chain);
    if (!chainConfig) {
      return jsonResponse({ error: `Unsupported chain: ${chain}` }, 400);
    }

    const user = await getOptionalUser(request, env);
    const { account, error: accountError } = getAccount(user, accountParam);
    if (accountError) return jsonResponse({ error: accountError }, 400);

    const { address: safeAccount, error: addrError } = validateEthereumAddress(account);
    if (addrError) return jsonResponse({ error: addrError }, 400);

    let safeContract = null;
    if (contract) {
      const { address: validatedContract, error: contractError } = validateEthereumAddress(contract);
      if (contractError) return jsonResponse({ error: "Invalid contract address" }, 400);
      safeContract = validatedContract;
    }

    if (!(await checkRateLimitForKey(request, user, chain, env))) {
      return jsonResponse({ error: "Too many requests" }, 429);
    }

    const cacheKey = safeContract
      ? `nfts_${safeAccount}_${safeContract}_${chain}`
      : `nfts_${safeAccount}_${chain}`;

    const cached = await getCache(cacheKey, env);
    if (cached) return jsonResponse(cached);

    let formattedNFTs = [];

    if (chainConfig.type === 'bscscan') {
      const bscNFTs = await getBSCScanNFTs(safeAccount, env.BSCSCAN_API_KEY);
      formattedNFTs = bscNFTs.map(nft => ({ ...nft, chain }));
    } else {
      const rawNFTs = await fetchNFTsWithFallback(env, chain, chainConfig, safeAccount, safeContract);
      formattedNFTs = formatNFTs(rawNFTs, chain);
    }

    const result = { result: { nfts: formattedNFTs }, chain };
    
    await setCache(cacheKey, result, env);
    return jsonResponse(result);

  } catch (err) {
    console.error("NFT ERROR for chain:", chain, err);
    return jsonResponse({
      error: "Failed to fetch NFTs from all available providers",
      result: { nfts: [] }
    }, 500);
  }
}
