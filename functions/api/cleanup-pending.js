// ============================================================
// CLEANUP ROBOT — Skenē līgumu, atceļ pending mintus > 30 min
// Alchemy (primārais) → Moralis RPC (fallback)
// ============================================================
import { ethers } from 'ethers';
import { getRobotSigner } from "../_lib/robot.js";

const WALLET_NFT_ABI = [
  "function getAllPendingAddresses() view returns (address[])",
  "function getPendingMint(address) view returns (tuple(bytes32 imageHash, bytes32 videoHash, bytes32 contentHash, uint256 nonce, uint256 deposit, uint64 timestamp, uint64 arrayIndex, bool exists))",
  "function cancelMint(address) external"
];

async function getProvider(env) {
  if (env.ALCHEMY_RPC_URL) {
    try {
      const p = new ethers.JsonRpcProvider(env.ALCHEMY_RPC_URL);
      await p.getBlockNumber();
      return p;
    } catch (e) { console.warn('Alchemy RPC failed, trying Moralis...'); }
  }
  if (env.MORALIS_RPC_URL) {
    try {
      const p = new ethers.JsonRpcProvider(env.MORALIS_RPC_URL);
      await p.getBlockNumber();
      return p;
    } catch (e) { console.warn('Moralis RPC also failed'); }
  }
  return null;
}

export function trackPendingMint(walletAddr) {}
export function clearPendingTrack(walletAddr) {}

export async function executePendingCleanup(env) {
  const { CONTRACT_ADDRESS, ROBOT_PRIVATE_KEY } = env;
  const MAX_MIN = Number.parseInt(env.MAX_PENDING_MIN || '30');

  if (!CONTRACT_ADDRESS || !ROBOT_PRIVATE_KEY) {
    console.error("❌ Cleanup kļūda: Trūkst nepieciešamo vides mainīgo (env).");
    return { checked: 0, cancelled: 0, errors: 0 };
  }

  const provider = await getProvider(env);
  if (!provider) {
    console.log("🧹 Cleanup: No RPC configured, skipping...");
    return { checked: 0, cancelled: 0, errors: 0 };
  }

  const robotSigner = getRobotSigner(env, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, robotSigner);

  let allAddresses;
  try {
    allAddresses = await contract.getAllPendingAddresses();
  } catch (e) {
    console.error("❌ Neizdevās ielasīt pending adreses:", e.message);
    return { checked: 0, cancelled: 0, errors: 1 };
  }

  console.log(`🧹 Cleanup: checking ${allAddresses.length} pending mints...`);

  const results = { checked: allAddresses.length, cancelled: 0, errors: 0 };
  const nowSec = Math.floor(Date.now() / 1000);

  for (const addr of allAddresses) {
    try {
      const p = await contract.getPendingMint(addr);
      if (!p || !p.exists) continue;

      const elapsedSec = nowSec - Number(p.timestamp);
      const elapsedMin = (elapsedSec / 60).toFixed(1);

      if (elapsedSec > MAX_MIN * 60) {
        console.log(`🧹 Atceļam: ${addr} (${elapsedMin} min)...`);
        const tx = await contract.cancelMint(addr);
        console.log(`🧹 Tx: ${tx.hash}`);
        await tx.wait();
        results.cancelled++;
        console.log(`🧹 ✅ Refunded ${ethers.formatEther(p.deposit)} ETH`);
      } else {
        console.log(`  ⏳ ${addr.substring(0, 10)}... (${elapsedMin} min / ${MAX_MIN} min)`);
      }
    } catch (e) {
      console.error(`❌ Kļūda: ${addr}:`, e.message);
      results.errors++;
    }
  }

  console.log(`🧹 Cleanup done: ${results.checked} checked, ${results.cancelled} cancelled, ${results.errors} errors`);
  return results;
}
