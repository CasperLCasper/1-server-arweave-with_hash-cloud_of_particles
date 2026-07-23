// functions/api/topup-credits.js
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

    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org', null, { staticNetwork: true });
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();

    const ethBalance = await provider.getBalance(address);
    console.log('💰 ETH bilance:', ethers.formatEther(ethBalance), 'ETH');

    const topUpAmountEth = 0.01;
    const topUpAmountWei = ethers.parseEther(String(topUpAmountEth));

    if (ethBalance < topUpAmountWei) {
      return new Response(JSON.stringify({ 
        error: `Nepietiekami ETH. Vajag vismaz ${topUpAmountEth} ETH.`,
        address: address,
        balance: ethers.formatEther(ethBalance)
      }), {
        status: 400, headers: { "Content-Type": "application/json" }
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

    const { winc: balanceBefore } = await turbo.getBalance();
    console.log('📊 Kredīti pirms:', balanceBefore.toString(), 'Winston Credits');

    await turbo.topUpWithTokens({ tokenAmount: topUpAmountEth });
    const { winc: balanceAfter } = await turbo.getBalance();
    console.log('📊 Kredīti pēc:', balanceAfter.toString(), 'Winston Credits');

    return new Response(JSON.stringify({
      success: true,
      address: address,
      ethBalance: ethers.formatEther(ethBalance),
      topUpAmount: topUpAmountEth + ' ETH',
      creditsBefore: balanceBefore.toString(),
      creditsAfter: balanceAfter.toString(),
      added: (balanceAfter - balanceBefore).toString()
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Topup error:', error);
    console.error('💥 Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return new Response(JSON.stringify({ 
      error: error.message,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
