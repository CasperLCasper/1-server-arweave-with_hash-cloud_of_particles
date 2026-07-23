// functions/api/finalize-mint.js
import { ethers } from 'ethers';
import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import { clearPendingTrack } from "./cleanup-pending.js";
import { getRobotSigner } from "../_lib/robot.js";

const WALLET_NFT_ABI = [
  "function finalizeMint(address wallet, string calldata metadataUri, uint256 storageCostWei, bytes32 finalContentHash) external",
  "function getPendingMint(address wallet) external view returns (tuple(bytes32 imageHash, bytes32 videoHash, bytes32 contentHash, uint256 nonce, uint256 deposit, bool exists))",
  "function cancelMint(address wallet) external",
  "function mintPrice() public view returns (uint256)"
];

let alchemyDisabledUntil = 0;
const MAX_FAILS = 6;
let alchemyFailCount = 0;

async function getProvider(env) {
  const originalError = console.error;
  console.error = () => {};

  try {
    if (Date.now() >= alchemyDisabledUntil && env.ALCHEMY_RPC_URL) {
      try {
        const p = new ethers.JsonRpcProvider(env.ALCHEMY_RPC_URL, null, { staticNetwork: true });
        await Promise.race([p.getBlockNumber(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
        alchemyFailCount = 0;
        return p;
      } catch (e) {
        alchemyFailCount++;
        console.warn(`Alchemy RPC failed (${alchemyFailCount}/${MAX_FAILS})`);
        if (alchemyFailCount >= MAX_FAILS) {
          alchemyDisabledUntil = Date.now() + 60 * 60 * 1000;
          console.warn('Alchemy RPC disabled for 1 hour');
        }
      }
    }

    if (env.MORALIS_RPC_URL) {
      try {
        const p = new ethers.JsonRpcProvider(env.MORALIS_RPC_URL, null, { staticNetwork: true });
        await Promise.race([p.getBlockNumber(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
        return p;
      } catch (e) { console.warn('Moralis RPC also failed'); }
    }
  } finally {
    console.error = originalError;
  }

  return null;
}

function parseMetadataUri(uri) {
  const trimmed = uri.trim();
  if (trimmed.startsWith('{')) return trimmed;
  if (trimmed.startsWith('Qm') || trimmed.startsWith('baf')) return `https://arweave.net/${trimmed}`;
  if (trimmed.startsWith('ipfs://')) return `https://arweave.net/${trimmed.substring(7)}`;
  if (trimmed.startsWith('ar://')) return `https://arweave.net/${trimmed.substring(5)}`;
  return trimmed;
}

async function executeRobotFinalize(robotSigner, contractAddress, { wallet, fullMetadataUri, storageCostWei, finalContentHash }) {
  const contractWithSigner = new ethers.Contract(contractAddress, WALLET_NFT_ABI, robotSigner);
  console.log('🤖 Finalize robot: calling finalizeMint...');
  const finalizeTx = await contractWithSigner.finalizeMint(wallet, fullMetadataUri, storageCostWei || 0, finalContentHash);
  console.log(`🤖 Finalize tx sent! Hash: ${finalizeTx.hash}`);
  await finalizeTx.wait();
  console.log('🤖 ✅ Mint finalized! NFT created.');
}

async function purchaseStorageCredits(provider, storageKey, costWei) {
  if (!storageKey || !costWei) return;
  try {
    const storageWallet = new ethers.Wallet(storageKey, provider);
    const storageBalance = await provider.getBalance(await storageWallet.getAddress());
    if (storageBalance < BigInt(costWei) + ethers.parseEther("0.0001")) return;
    const signer = new EthereumSigner(storageKey);
    const turbo = TurboFactory.authenticated({
      signer, token: 'base-eth', gatewayUrl: 'https://sepolia.base.org',
      paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
      uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
    });
    const { winc: before } = await turbo.getBalance();
    await turbo.topUpWithTokens({ tokenAmount: costWei });
    const { winc: after } = await turbo.getBalance();
    console.log('🤖 ✅ Credits purchased!', { added: (after - before).toString() });
  } catch (e) { console.warn('⚠️ Credit purchase failed:', e.message); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user?.address) return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

    if (!(await checkRateLimit({ key: `finalize:${user.address.toLowerCase()}`, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers: { "Content-Type": "application/json" } }); }

    const { wallet, metadataUri, storageCostWei, contentHash } = body;
    if (!wallet || !metadataUri || !ethers.isAddress(wallet)) return new Response(JSON.stringify({ success: false, error: 'Invalid input' }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (user.address.toLowerCase() !== wallet.toLowerCase()) return new Response(JSON.stringify({ success: false, error: 'Unauthorized wallet' }), { status: 403, headers: { "Content-Type": "application/json" } });

    const finalContentHash = (contentHash && /^0x[0-9a-fA-F]{64}$/.test(contentHash)) ? contentHash : ethers.ZeroHash;
    const fullMetadataUri = parseMetadataUri(metadataUri);
    const { CONTRACT_ADDRESS, ROBOT_PRIVATE_KEY, ARWEAVE_STORAGE_KEY } = env;
    if (!CONTRACT_ADDRESS || !ROBOT_PRIVATE_KEY) return new Response(JSON.stringify({ success: false, error: 'Server configuration incomplete' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const provider = await getProvider(env);
    if (!provider) return new Response(JSON.stringify({ success: false, error: 'No RPC configured' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const contract = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, provider);
    let pendingMint;
    try { pendingMint = await contract.getPendingMint(wallet); } catch (err) {
      return new Response(JSON.stringify({ success: false, error: 'Cannot read pending mint: ' + err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!pendingMint?.exists) return new Response(JSON.stringify({ success: false, error: 'No pending mint found for this wallet' }), { status: 400, headers: { "Content-Type": "application/json" } });

    console.log('🔍 FINALIZE MINT:', { wallet, deposit: ethers.formatEther(pendingMint.deposit) });

    try {
      const robotSigner = getRobotSigner(env, provider);
      await executeRobotFinalize(robotSigner, CONTRACT_ADDRESS, { wallet, fullMetadataUri, storageCostWei, finalContentHash });
      clearPendingTrack(wallet);
    } catch (finalizeError) {
      return new Response(JSON.stringify({ success: false, error: 'Finalize failed: ' + finalizeError.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    await purchaseStorageCredits(provider, ARWEAVE_STORAGE_KEY, storageCostWei);
    return new Response(JSON.stringify({ success: true, wallet, metadataUri: fullMetadataUri, storageCostWei: storageCostWei || "0", contentHash: finalContentHash }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error('💥 Finalize mint error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Server error: ' + error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
