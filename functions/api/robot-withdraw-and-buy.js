// functions/api/robot-withdraw-and-buy.js
import { ethers } from 'ethers';
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';

const WALLET_NFT_ABI = [
  "function withdraw(uint256 storageCostWei) external"
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

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { txHash, storageCostWei } = body;

    if (!txHash || !storageCostWei) {
      return new Response(JSON.stringify({ success: false, error: 'Missing txHash or storageCostWei' }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🤖 Robot: started for tx ${txHash}, storageCost: ${ethers.formatEther(storageCostWei)} ETH`);

    const ROBOT_PRIVATE_KEY = env.ROBOT_PRIVATE_KEY;
    const ARWEAVE_STORAGE_KEY = env.ARWEAVE_STORAGE_KEY;
    const CONTRACT_ADDRESS = env.CONTRACT_ADDRESS;

    if (!ROBOT_PRIVATE_KEY) throw new Error('ROBOT_PRIVATE_KEY not configured');
    if (!ARWEAVE_STORAGE_KEY) throw new Error('ARWEAVE_STORAGE_KEY not configured');
    if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not configured');

    const provider = await getProvider(env);
    if (!provider) throw new Error('No RPC configured');

    const robotWallet = new ethers.Wallet(ROBOT_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, WALLET_NFT_ABI, robotWallet);
    
    console.log(`🤖 Withdraw robot: calling withdraw(${storageCostWei})...`);
    const withdrawTx = await contract.withdraw(storageCostWei);
    console.log(`🤖 Withdraw robot: tx sent! Hash: ${withdrawTx.hash}`);
    await withdrawTx.wait();
    console.log('🤖 Withdraw robot: ✅ Funds distributed!');

    const storageWallet = new ethers.Wallet(ARWEAVE_STORAGE_KEY, provider);
    const storageBalance = await provider.getBalance(await storageWallet.getAddress());
    console.log(`🤖 Storage balance: ${ethers.formatEther(storageBalance)} ETH`);

    const storageCostBigInt = BigInt(storageCostWei);
    const gasReserve = ethers.parseEther("0.0001");
    
    if (storageBalance >= storageCostBigInt + gasReserve) {
      console.log(`🤖 Buying credits for ${ethers.formatEther(storageCostWei)} ETH...`);
      
      const signer = new EthereumSigner(ARWEAVE_STORAGE_KEY);
      const turbo = TurboFactory.authenticated({
        signer, token: 'base-eth', gatewayUrl: 'https://sepolia.base.org',
        paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
        uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
      });

      const { winc: before } = await turbo.getBalance();
      try {
        await turbo.topUpWithTokens({ tokenAmount: storageCostWei });
      } catch (topUpError) {
        const txIdMatch = topUpError.message.match(/0x[a-fA-F0-9]{64}/);
        if (txIdMatch) await turbo.submitFundTransaction({ txId: txIdMatch[0] });
        else throw topUpError;
      }
      const { winc: after } = await turbo.getBalance();
      console.log('🤖 ✅ Credits purchased!', { added: (after - before).toString() });
    } else {
      console.log('🤖 Not enough funds for credits.');
    }

    return new Response(JSON.stringify({
      success: true, withdrawTx: withdrawTx.hash, storageBalance: storageBalance.toString(), creditsPurchased: storageCostWei
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('💥 Robot error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
