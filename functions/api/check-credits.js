// functions/api/check-credits.js
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import { ethers } from 'ethers';

const RPC_URL = 'https://sepolia.base.org';

async function testRPC(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: controller.signal
    });
    return res.ok;
  } catch { return false; }
  finally { clearTimeout(timeoutId); }
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const privateKey = env.ARWEAVE_STORAGE_KEY;
    if (!privateKey) {
      return new Response(JSON.stringify({ error: 'ARWEAVE_STORAGE_KEY not configured' }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const signer = new EthereumSigner(privateKey);
    
    const turbo = TurboFactory.authenticated({
      signer,
      token: 'base-eth',
      gatewayUrl: 'https://sepolia.base.org',
      paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
      uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
    });

    const balance = await turbo.getBalance();
    const creditsRaw = balance.winston || balance.winc || "0";
    const creditsBigInt = BigInt(creditsRaw);
    
    if (!(await testRPC(RPC_URL))) {
      return new Response(JSON.stringify({ error: 'RPC unavailable' }), {
        status: 503, headers: { "Content-Type": "application/json" }
      });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL, null, { staticNetwork: true });
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();
    const ethBalance = await provider.getBalance(address);

    let estimatedMB = 0;
    try {
      const [costFor1MB] = await turbo.getUploadCosts({ bytes: [1024 * 1024] });
      const costRaw = costFor1MB.winston || costFor1MB.winc;
      if (costRaw && BigInt(costRaw) > 0n) {
        estimatedMB = Number(creditsBigInt / BigInt(costRaw));
      }
    } catch (costError) {
      console.warn("Neizdevās aprēķināt 1MB izmaksas:", costError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      address: address,
      ethBalance: ethers.formatEther(ethBalance),
      credits: creditsBigInt.toString(),
      estimatedMB: Math.floor(estimatedMB)
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("💥 Kļūda check-credits maršrutā:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
