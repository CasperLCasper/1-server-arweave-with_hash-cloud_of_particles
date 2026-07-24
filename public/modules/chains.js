// ============================================ //
// CHAIN CONFIGURATIONS
// ============================================ //

function deepFreeze(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) {
    return obj;
  }
  
  seen.add(obj);
  Object.freeze(obj);
  
  Object.values(obj).forEach(value => {
    deepFreeze(value, seen);
  });
  
  return obj;
}

const baseSepoliaConfig = {
  name: 'Base Sepolia',
  chainId: 84532,
  chainIdHex: '0x14a34',
  rpc: [
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com'
  ],
  nativeCurrency: 'ETH',
  blockExplorer: 'https://sepolia.basescan.org',
  alchemyNetwork: 'base-sepolia'
};

export const VIZ_CHAINS = {
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    rpc: [
      'https://sepolia.drpc.org',
      'https://ethereum-sepolia-rpc.publicnode.com'
    ],
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia.etherscan.io',
    alchemyNetwork: 'eth-sepolia'
  },
  polygonAmoy: {
    name: 'Polygon Amoy Testnet',
    chainId: 80002,
    chainIdHex: '0x13882',
    rpc: [
      'https://polygon-amoy.drpc.org',
      'https://rpc-amoy.polygon.technology',
      'https://polygon-amoy-bor-rpc.publicnode.com'
    ],
    nativeCurrency: 'POL',
    blockExplorer: 'https://amoy.polygonscan.com',
    alchemyNetwork: 'polygon-amoy'
  },
  bscTestnet: {
    name: 'BNB Chain Testnet',
    chainId: 97,
    chainIdHex: '0x61',
    rpc: [
      'https://data-seed-prebsc-1-s1.binance.org:8545',
      'https://bsc-testnet-rpc.publicnode.com'
    ],
    nativeCurrency: 'tBNB',
    blockExplorer: 'https://testnet.bscscan.com'
  },
  arbitrumSepolia: {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    chainIdHex: '0x66eee',
    rpc: [
      'https://sepolia-rollup.arbitrum.io/rpc',
      'https://arbitrum-sepolia-rpc.publicnode.com'
    ],
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia.arbiscan.io',
    alchemyNetwork: 'arb-sepolia'
  },
  optimismSepolia: {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    chainIdHex: '0xaa37dc',
    rpc: [
      'https://sepolia.optimism.io',
      'https://optimism-sepolia-rpc.publicnode.com'
    ],
    nativeCurrency: 'ETH',
    blockExplorer: 'https://sepolia-optimism.etherscan.io',
    alchemyNetwork: 'opt-sepolia'
  },
  baseSepolia: baseSepoliaConfig,
  avalancheFuji: {
    name: 'Avalanche Fuji',
    chainId: 43113,
    chainIdHex: '0xa869',
    rpc: [
      'https://api.avax-test.network/ext/bc/C/rpc',
      'https://avalanche-fuji-rpc.publicnode.com'
    ],
    nativeCurrency: 'AVAX',
    blockExplorer: 'https://testnet.snowtrace.io',
    alchemyNetwork: 'avalanche-fuji'
  }
};

export const MINT_CHAIN = VIZ_CHAINS.baseSepolia;

deepFreeze(VIZ_CHAINS);
deepFreeze(MINT_CHAIN);

export function getRpcUrl(chainKey) {
  const chain = VIZ_CHAINS[chainKey];
  if (!chain) return null;
  return Array.isArray(chain.rpc) ? chain.rpc[0] : chain.rpc;
}

export function getAllRpcUrls(chainKey) {
  const chain = VIZ_CHAINS[chainKey];
  if (!chain) return [];
  return Array.isArray(chain.rpc) ? [...chain.rpc] : [chain.rpc];
}

export function getChainByHexId(hexId) {
  for (const [key, chain] of Object.entries(VIZ_CHAINS)) {
    if (chain.chainIdHex === hexId) {
      return {
        key,
        ...chain,
        rpc: [...chain.rpc]
      };
    }
  }
  return null;
}

export function getChainById(chainId) {
  for (const [key, chain] of Object.entries(VIZ_CHAINS)) {
    if (chain.chainId === chainId) {
      return {
        key,
        ...chain,
        rpc: [...chain.rpc]
      };
    }
  }
  return null;
}
