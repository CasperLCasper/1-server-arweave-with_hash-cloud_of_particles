// functions/api/cancel-mint.js — PIEVIENOTS RETRY
import { ethers } from 'ethers';
import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { clearPendingTrack } from "./cleanup-pending.js";
import { getRobotSigner } from "../_lib/robot.js";

const WALLET_NFT_ABI = [
  "function cancelMint(address wallet) external",
  "function getPendingMint(address wallet) external view returns (tuple(bytes32 imageHash, bytes32 videoHash, bytes32 contentHash, uint256 nonce, uint256 deposit, bool exists))"
];

const MAX_RETRIES = 5;

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

function isNonceError(error) {
  return error.message?.includes('nonce') || error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED';
}

async function tryCancelWithRetry(contractWithSigner, wallet, robotSigner) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🤖 Cancel robot: calling cancelMint (attempt ${attempt}/${MAX_RETRIES})...`);
      const cancelTx = await contractWithSigner.cancelMint(wallet);
      console.log(`🤖 Cancel tx sent! Hash: ${cancelTx.hash}`);
      clearPendingTrack(wallet);
      return cancelTx;
    } catch (cancelError) {
      if (isNonceError(cancelError) && attempt < MAX_RETRIES) {
        console.warn(`⚠️ Nonce conflict, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        robotSigner.reset();
      } else { throw cancelError; }
    }
  }
  throw new Error('Cancel failed after ' + MAX_RETRIES + ' attempts');
}

async function validateAndGetPending(contract, wallet) {
  let pendingMint;
  try { pendingMint = await contract.getPendingMint(wallet); }
  catch (err) { throw { status: 400, message: 'Cannot read pending mint: ' + err.message }; }
  if (!pendingMint || !pendingMint.exists) throw { status: 400, message: 'No pending mint found for this wallet' };
  return pendingMint;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user?.address) return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

    if (!(await checkRateLimit({ key: `cancel:${user.address.toLowerCase()}`, limit: 3, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers: { "Content-Type": "application/json" } }); }

    const { wallet } = body;
    if (!wallet || !ethers.isAddress(wallet)) return new Response(JSON.stringify({ success: false, error: 'Invalid wallet address' }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (user.address.toLowerCase() !== wallet.toLowerCase()) return new Response(JSON.stringify({ success: false, error: 'Unauthorized wallet' }), { status: 403, headers: { "Content-Type": "application/json" } });

    const { CONTRACT_ADDRESS, ROBOT_PRIVATE_KEY } = env;
    if (!CONTRACT_ADDRESS || !ROBOT_PRIVATE_KEY) return new Response(JSON.stringify({ success: false, error: 'Server configuration incomplete' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const provider = await getProvider(env);
    if (!provider) return new Response(JSON.stringify({ success: false, error: 'No RPC configured' }), { status: 500, headers: { "Content-Type": "application/json" } });

    const contract = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, provider);
    let pendingMint;
    try { pendingMint = await validateAndGetPending(contract, wallet); }
    catch (err) { return new Response(JSON.stringify({ success: false, error: err.message }), { status: err.status || 400, headers: { "Content-Type": "application/json" } }); }

    console.log('🔍 CANCEL MINT: deposit:', ethers.formatEther(pendingMint.deposit), 'ETH');

    const robotSigner = getRobotSigner(env, provider);
    const contractWithSigner = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, robotSigner);
    const cancelTx = await tryCancelWithRetry(contractWithSigner, wallet, robotSigner);

    return new Response(JSON.stringify({
      success: true, message: 'Transaction submitted successfully',
      txHash: cancelTx.hash, wallet,
      refundAmount: pendingMint.deposit.toString(),
      refundEth: ethers.formatEther(pendingMint.deposit)
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('💥 Cancel mint error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message || 'Server error' }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
