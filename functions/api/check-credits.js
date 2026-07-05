import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import { ethers } from 'ethers';

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
    
    // Konfigurējam Turbo ar pareiziem URL priekš Testnet
    const turbo = TurboFactory.authenticated({
      signer,
      token: 'base-eth',
      // SALABOTS: gatewayUrl ir Arweave vārteja, nevis Base RPC!
      gatewayUrl: 'https://arweave.net', 
      paymentServiceConfig: { url: 'https://payment.ardrive.dev' },
      uploadServiceConfig: { url: 'https://upload.ardrive.dev' }
    });

    // Iegūstam bilanci drošā veidā
    const balance = await turbo.getBalance();
    // Ja balance atgriež winston vai winc, nodrošināmies pret abu variantu eksistenci
    const creditsRaw = balance.winston || balance.winc || "0";
    const creditsBigInt = BigInt(creditsRaw);
    
    // Pieslēdzamies Base Sepolia RPC, lai pārbaudītu paša ETH bilanci gāzei
    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();
    const ethBalance = await provider.getBalance(address);

    // Aprēķinām aptuvenās izmaksas 1MB augšupielādei
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
