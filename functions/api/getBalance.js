import { ethers } from "ethers";

const getAlchemyNetwork = (chain) => {
  const networks = {
    sepolia: 'eth-sepolia',
    polygonAmoy: 'polygon-amoy',
    bscTestnet: 'bsc-testnet',
    arbitrumSepolia: 'arb-sepolia',
    optimismSepolia: 'opt-sepolia',
    baseSepolia: 'base-sepolia',
    avalancheFuji: 'avalanche-fuji'
  };
  return networks[chain] || 'eth-sepolia';
};

const getMoralisChain = (chain) => {
  const chains = {
    sepolia: 'sepolia',
    polygonAmoy: 'amoy',
    bscTestnet: 'bsc',
    arbitrumSepolia: 'arbitrum sepolia',
    optimismSepolia: 'optimism sepolia',
    baseSepolia: 'base sepolia',
    avalancheFuji: 'fuji'
  };
  return chains[chain] || null;
};

async function fetchBalanceAlchemy(account, network, apiKey) {
  const res = await fetch(`https://${network}.g.alchemy.com/v2/${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [account, "latest"], id: 1 })
  });
  if (!res.ok) throw new Error('Alchemy failed');
  const data = await res.json();
  if (!data.result) throw new Error('No result');
  return ethers.formatEther(data.result);
}

async function fetchBalanceMoralis(account, chain) {
  const moralisChain = getMoralisChain(chain);
  if (!moralisChain) throw new Error(`Unsupported chain: ${chain}`);
  const res = await fetch(`https://deep-index.moralis.io/api/v2.2/${account}/balance?chain=${moralisChain}`, {
    headers: { 'accept': 'application/json', 'X-API-Key': process.env.MORALIS_API_KEY }
  });
  if (!res.ok) throw new Error('Moralis failed');
  const data = await res.json();
  return ethers.formatEther(data.balance || '0');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const account = url.searchParams.get("account");
  const chain = url.searchParams.get("chain") || 'sepolia';

  if (!account) {
    return new Response(JSON.stringify({ error: "Missing account" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    let balance;
    const alchemyNetwork = getAlchemyNetwork(chain);
    try {
      balance = await fetchBalanceAlchemy(account, alchemyNetwork, env.ALCHEMY_API_KEY);
    } catch {
      try {
        balance = await fetchBalanceMoralis(account, chain);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Failed to fetch balance" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    
    return new Response(JSON.stringify({ balance, chain }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
