import { ethers } from 'ethers';
import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";

const WALLET_NFT_ABI = [
  "function requestMint(address wallet, bytes32 imageHash, bytes32 videoHash, bytes32 contentHash, uint256 nonceParam, bytes calldata signature) external payable",
  "function mintPrice() public view returns (uint256)",
  "function getNonce(address wallet) public view returns (uint256)",
  "function signer() public view returns (address)"
];

const CHAIN_ID = 84532;

async function getProvider(env) {
  if (env.ALCHEMY_RPC_URL) {
    try {
      const p = new ethers.JsonRpcProvider(env.ALCHEMY_RPC_URL);
      await Promise.race([p.getBlockNumber(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
      return p;
    } catch (e) { console.warn('Alchemy RPC failed, trying Moralis...'); }
  }
  if (env.MORALIS_RPC_URL) {
    try {
      const p = new ethers.JsonRpcProvider(env.MORALIS_RPC_URL);
      await Promise.race([p.getBlockNumber(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
      return p;
    } catch (e) { console.warn('Moralis RPC also failed'); }
  }
  return null;
}

function parseHashes(imageHash, videoHash, contentHash) {
  return {
    imageHash,
    videoHash: (videoHash && /^0x[0-9a-fA-F]{64}$/.test(videoHash)) ? videoHash : ethers.ZeroHash,
    contentHash: (contentHash && /^0x[0-9a-fA-F]{64}$/.test(contentHash)) ? contentHash : ethers.ZeroHash
  };
}

async function readContractState(contract, wallet) {
  const [mintPrice, currentNonce, contractSigner] = await Promise.all([
    contract.mintPrice(), contract.getNonce(wallet), contract.signer()
  ]);
  return { mintPrice, currentNonce, contractSigner };
}

async function createSignature(serverWallet, wallet, hashes, nonce, contractAddress) {
  const domain = { name: 'WalletVisualizer', version: '1', chainId: CHAIN_ID, verifyingContract: contractAddress };
  const types = {
    MintRequest: [
      { name: 'wallet', type: 'address' }, { name: 'imageHash', type: 'bytes32' },
      { name: 'videoHash', type: 'bytes32' }, { name: 'contentHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' }
    ]
  };
  return serverWallet.signTypedData(domain, types, { wallet, imageHash: hashes.imageHash, videoHash: hashes.videoHash, contentHash: hashes.contentHash, nonce });
}

function encodeTxData(wallet, hashes, nonce, signature) {
  return new ethers.Interface(WALLET_NFT_ABI).encodeFunctionData('requestMint', [wallet, hashes.imageHash, hashes.videoHash, hashes.contentHash, nonce, signature]);
}

async function estimateGas(provider, wallet, contractAddress, data, mintPrice) {
  try { const e = await provider.estimateGas({ from: wallet, to: contractAddress, data, value: mintPrice }); return (e * 130n) / 100n; }
  catch { return 380000n; }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user?.address) return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

    if (!(await checkRateLimit({ key: `mint:${user.address.toLowerCase()}`, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers: { "Content-Type": "application/json" } }); }

    const { wallet, imageHash, videoHash, contentHash } = body;
    if (!wallet || !ethers.isAddress(wallet) || user.address.toLowerCase() !== wallet.toLowerCase()) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or unauthorized wallet' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!imageHash || !/^0x[0-9a-fA-F]{64}$/.test(imageHash)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or missing image hash' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const hashes = parseHashes(imageHash, videoHash, contentHash);
    const { CONTRACT_ADDRESS, SERVER_PRIVATE_KEY } = env;
    if (!CONTRACT_ADDRESS || !SERVER_PRIVATE_KEY) return new Response(JSON.stringify({ success: false, error: 'Server configuration incomplete' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const provider = await getProvider(env);
    if (!provider) return new Response(JSON.stringify({ success: false, error: 'No RPC configured' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const contract = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, provider);
    let state;
    try { state = await readContractState(contract, wallet); }
    catch (err) { return new Response(JSON.stringify({ success: false, error: 'Cannot read contract state: ' + err.message }), { status: 400, headers: { "Content-Type": "application/json" } }); }

    const serverWallet = new ethers.Wallet(SERVER_PRIVATE_KEY);
    console.log('🔍 REQUEST MINT: price:', ethers.formatEther(state.mintPrice), 'ETH nonce:', state.currentNonce.toString());
    if (serverWallet.address.toLowerCase() !== state.contractSigner.toLowerCase()) console.error('🚨 Signer mismatch!');

    const signature = await createSignature(serverWallet, wallet, hashes, state.currentNonce, CONTRACT_ADDRESS);
    const data = encodeTxData(wallet, hashes, state.currentNonce, signature);
    const gasLimit = await estimateGas(provider, wallet, CONTRACT_ADDRESS, data, state.mintPrice);

    console.log('✅ REQUEST MINT PREPARED');

    return new Response(JSON.stringify({
      success: true,
      transaction: { to: CONTRACT_ADDRESS, data, value: state.mintPrice.toString(), gasLimit: gasLimit.toString() },
      imageHash: hashes.imageHash,
      videoHash: hashes.videoHash !== ethers.ZeroHash ? hashes.videoHash : null,
      contentHash: hashes.contentHash !== ethers.ZeroHash ? hashes.contentHash : null
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('💥 Request mint error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
