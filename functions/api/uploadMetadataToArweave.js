// functions/api/upload-metadata.js
import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import { setCache } from "../_lib/cache.js";
import { TurboFactory, EthereumSigner } from '@ardrive/turbo-sdk';

const ALLOWED_FIELDS = ['name', 'image', 'description', 'attributes', 'animation_url', 'tokens', 'nfts'];

function cleanMetadata(metadata) {
  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_FIELDS.includes(key)) delete metadata[key];
  }
  return metadata;
}

function validateMetadata(metadata) {
  if (!metadata || !metadata.name || !metadata.image) {
    throw { status: 400, message: 'Metadata must contain name and image' };
  }
  if (typeof metadata.name !== 'string' || metadata.name.length > 100) {
    throw { status: 400, message: 'Invalid name (max 100 characters)' };
  }
  if (typeof metadata.image !== 'string' || metadata.image.length > 500) {
    throw { status: 400, message: 'Invalid image URL' };
  }
  if (!/^(https?|ar|ipfs|local):\/\/.+/.test(metadata.image) && !metadata.image.endsWith('.png')) {
    throw { status: 400, message: 'Image must be a valid URL or image filename' };
  }
}

async function uploadToTurbo(metadata, userAddress, env) {
  const privateKey = env.ARWEAVE_STORAGE_KEY;
  if (!privateKey) throw new Error('ARWEAVE_STORAGE_KEY not configured');

  const signer = new EthereumSigner(privateKey);
  const turbo = TurboFactory.authenticated({
    signer, token: 'base-eth', gatewayUrl: 'https://sepolia.base.org',
    paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
    uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
  });

  const result = await turbo.upload({
    data: JSON.stringify(metadata),
    dataItemOpts: { tags: [
      { name: "Content-Type", value: "application/json" },
      { name: "App-Name", value: "WalletVisualizer-v2.0" },
      { name: "User-Address", value: userAddress.toLowerCase() },
      { name: "Metadata-Type", value: "NFT-Metadata" }
    ]}
  });

  if (!result?.id) throw new Error('No transaction ID returned for metadata from Turbo SDK');
  return result.id;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user?.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    if (!(await checkRateLimit({ key: `upload-metadata:${user.address.toLowerCase()}`, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many metadata uploads. Try again later.' }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON format' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let metadata = body.metadata && !body.name ? body.metadata : body;

    try { validateMetadata(metadata); } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: e.status || 400, headers: { "Content-Type": "application/json" } });
    }

    metadata = cleanMetadata(metadata);
    console.log('🚀 Uploading metadata to Arweave via Turbo SDK...');

    const txId = await uploadToTurbo(metadata, user.address, env);
    console.log(`✅ Metadata successfully uploaded! TX ID: ${txId}`);
    await setCache(`lastUploadId:${user.address.toLowerCase()}`, txId, env, 5 * 60 * 1000);

    return new Response(JSON.stringify({ success: true, id: txId, url: `https://arweave.net/${txId}` }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('💥 Metadata upload error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
