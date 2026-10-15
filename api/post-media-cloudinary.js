// Server-side Cloudinary SDK factory. Never import from browser pages.
export async function loadCloudinarySdk(config, importSdk = () => import('cloudinary')) {
  const { cloudName, apiKey, apiSecret } = config || {};
  if (!/^[a-zA-Z0-9_-]+$/.test(cloudName || '') || !apiKey || !apiSecret) {
    throw new Error('Cloudinary server configuration unavailable');
  }
  const sdk = await importSdk();
  if (typeof sdk?.v2?.config !== 'function' ||
      typeof sdk?.v2?.utils?.private_download_url !== 'function') {
    throw new Error('Cloudinary SDK does not support private downloads');
  }
  sdk.v2.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return sdk.v2.utils;
}
