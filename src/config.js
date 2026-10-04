function configuredWallets(value) {
  if (!value) return [];
  let wallets;
  try { wallets = JSON.parse(value); } catch { throw new Error('TRACKED_WALLETS must be a JSON array.'); }
  if (!Array.isArray(wallets) || !wallets.every((wallet) => wallet && typeof wallet.address === 'string')) throw new Error('TRACKED_WALLETS must contain wallet address objects.');
  return wallets.map((wallet) => ({ address: wallet.address, label: wallet.label || wallet.address, description: wallet.description || '' }));
}

export function getConfig(env) {
  return {
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
    wallets: configuredWallets(env.TRACKED_WALLETS),
    heliusApiKey: env.HELIUS_API_KEY || '',
    jupiterApiKey: env.JUPITER_API_KEY || ''
  };
}
