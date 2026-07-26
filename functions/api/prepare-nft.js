// functions/api/prepare-nft.js
import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';
import { ethers } from 'ethers';
import crypto from 'crypto';
import axios from 'axios';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024;

function validateFile(file, type) {
  if (!file || !(file instanceof File)) return `No ${type} file provided`;
  const mimeType = file.type || (type === 'image' ? 'image/png' : 'video/webm');
  if (!ALLOWED_TYPES.includes(mimeType)) return `${type} type not allowed: ${mimeType}`;
  if (file.size > MAX_SIZE) return `${type} too large. Max 50MB`;
  return null;
}

function parseVideoFile(videoFile) {
  if (!videoFile || !(videoFile instanceof File)) return { type: null, name: null, size: 0, valid: true };
  const type = videoFile.type || 'video/webm';
  const name = videoFile.name || 'video.webm';
  const size = videoFile.size;
  return { type, name, size, valid: ALLOWED_TYPES.includes(type) && size <= MAX_SIZE };
}

function computeHash(buffer) {
  return '0x' + crypto.createHash('sha256').update(buffer).digest('hex');
}

async function initTurbo(env) {
  const signer = new EthereumSigner(env.ARWEAVE_STORAGE_KEY);
  return TurboFactory.authenticated({
    signer, token: 'base-eth', gatewayUrl: 'https://sepolia.base.org',
    paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
    uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
  });
}

async function uploadImage(turbo, buffer, type, userAddress, hash) {
  const result = await turbo.upload({
    data: buffer,
    dataItemOpts: { tags: [
      { name: "Content-Type", value: type }, { name: "App-Name", value: "WalletVisualizer-v2.0" },
      { name: "User-Address", value: userAddress.toLowerCase() }, { name: "File-Hash", value: hash }, { name: "NFT-Asset-Type", value: "image" }
    ]}
  });
  return { id: result?.id || null, size: buffer.length };
}

async function uploadVideo(turbo, buffer, type, userAddress, hash) {
  const result = await turbo.upload({
    data: buffer,
    dataItemOpts: { tags: [
      { name: "Content-Type", value: type }, { name: "App-Name", value: "WalletVisualizer-v2.0" },
      { name: "User-Address", value: userAddress.toLowerCase() }, { name: "File-Hash", value: hash }, { name: "NFT-Asset-Type", value: "video" }
    ]}
  });
  return { id: result?.id || null, size: buffer.length };
}

async function calculateStorageCost(turbo, totalBytes) {
  if (totalBytes <= 0) return { costWei: "0", costEth: "0" };
  try {
    const { tokenPrice } = await turbo.getTokenPriceForBytes({ byteCount: totalBytes });
    const costEth = tokenPrice.toString();
    return { costWei: ethers.parseEther(costEth).toString(), costEth };
  } catch (e) {
    console.warn('⚠️ Could not calculate storage price:', e.message);
    return { costWei: "0", costEth: "0" };
  }
}

async function autoFinalize(request, userAddress, imageId, storageCostWei) {
  try {
    const url = new URL(request.url);
    const finalizeUrl = `${url.protocol}//${url.host}/api/finalize-mint`;
    
    const res = await axios.post(finalizeUrl, {
      wallet: userAddress,
      metadataUri: `https://arweave.net/${imageId}`,
      storageCostWei: storageCostWei,
      contentHash: ethers.ZeroHash
    }, {
      headers: { Authorization: request.headers.get('Authorization') || '' }
    });
    
    if (res.data?.success) {
      console.log('✅ Auto-finalize successful!');
      return { success: true, data: res.data };
    } else {
      console.warn('⚠️ Auto-finalize returned:', res.data);
      return { success: false, error: res.data?.error || 'Unknown error' };
    }
  } catch (e) {
    console.warn('⚠️ Auto-finalize failed, will be picked up by cleanup robot:', e.message);
    return { success: false, error: e.message };
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user?.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const rateKey = `prepare-nft:${user.address.toLowerCase()}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    let formData;
    try { formData = await request.formData(); } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid form data" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const imageFile = formData.get('image');
    const videoFile = formData.get('video');

    const imgErr = validateFile(imageFile, 'Image');
    if (imgErr) {
      return new Response(JSON.stringify({ error: imgErr }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const vid = parseVideoFile(videoFile);
    if (videoFile && !vid.valid) {
      return new Response(JSON.stringify({ error: `Video type not allowed or too large` }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    console.log(`🚀 Processing NFT files for user ${user.address}...`);

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imageHash = computeHash(imageBuffer);
    console.log('🔐 Image Hash:', imageHash);

    let videoBuffer = null, videoHash = null;
    if (videoFile) {
      videoBuffer = Buffer.from(await videoFile.arrayBuffer());
      videoHash = computeHash(videoBuffer);
      console.log('🔐 Video Hash:', videoHash);
    }

    let imageId = null, videoId = null, arweaveError = null;
    let totalBytesUploaded = 0;
    let storageCostWei = "0", storageCostEth = "0";
    let finalizeResult = null;

    if (env.ARWEAVE_STORAGE_KEY) {
      try {
        const turbo = await initTurbo(env);

        try {
          console.log('📤 Uploading image to Arweave via Turbo...');
          const imgResult = await uploadImage(turbo, imageBuffer, imageFile.type || 'image/png', user.address, imageHash);
          imageId = imgResult.id;
          if (imageId) {
            totalBytesUploaded += imgResult.size;
            console.log('✅ Image uploaded to Arweave:', imageId);
          } else {
            arweaveError = 'No TX ID returned for image';
            console.warn('⚠️ Turbo SDK did not return TX ID for image');
          }
        } catch (imageError) {
          arweaveError = imageError.message;
          console.warn('⚠️ Arweave image upload error:', imageError.message);
        }

        if (videoBuffer) {
          try {
            console.log('📤 Uploading video to Arweave via Turbo...');
            const vidResult = await uploadVideo(turbo, videoBuffer, vid.type || 'video/webm', user.address, videoHash);
            videoId = vidResult.id;
            if (videoId) {
              totalBytesUploaded += vidResult.size;
              console.log('✅ Video uploaded to Arweave:', videoId);
            } else {
              console.warn('⚠️ Turbo SDK did not return TX ID for video');
            }
          } catch (videoError) {
            console.warn('⚠️ Arweave video upload error:', videoError.message);
          }
        }

        const costs = await calculateStorageCost(turbo, totalBytesUploaded);
        storageCostWei = costs.costWei;
        storageCostEth = costs.costEth;
        if (totalBytesUploaded > 0) {
          console.log(`💰 Storage cost: ${storageCostEth} ETH (${storageCostWei} wei) for ${totalBytesUploaded} bytes`);
        }

      } catch (initError) {
        arweaveError = initError.message;
        console.warn('⚠️ Turbo initialization error:', initError.message);
      }
    } else {
      arweaveError = 'No ARWEAVE_STORAGE_KEY configured';
      console.warn('⚠️ ARWEAVE_STORAGE_KEY not configured - files saved locally only');
    }

    const arweaveSuccess = !!(imageId || videoId);

    // VIENĪGAIS finalize-mint izsaukums - tikai no šejienes
    if (arweaveSuccess && imageId) {
      finalizeResult = await autoFinalize(request, user.address, imageId, storageCostWei);
    } else {
      console.log('⚠️ Arweave upload failed. Refund will be processed by cleanup robot.');
    }

    const responseData = {
      success: true,
      image: { hash: imageHash, id: imageId || null, fileName: imageFile.name || 'snapshot.png', mimeType: imageFile.type || 'image/png', size: imageFile.size },
      video: videoBuffer ? { hash: videoHash, id: videoId || null, fileName: vid.name || 'video.webm', mimeType: vid.type || 'video/webm', size: vid.size || 0 } : null,
      arweave: { success: arweaveSuccess, error: arweaveError },
      storage: { bytesUploaded: totalBytesUploaded, costWei: storageCostWei, costEth: storageCostEth },
      finalize: finalizeResult || { success: false, error: 'Not attempted' }
    };

    console.log(`✅ NFT preparation complete! Image hash: ${imageHash}`);

    return new Response(JSON.stringify(responseData), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('💥 prepare-nft error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
