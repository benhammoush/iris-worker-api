export function getConfig(env) {
  return {
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
    heliusApiKey: env.HELIUS_API_KEY || '',
    jupiterApiKey: env.JUPITER_API_KEY || '',
    coingeckoApiKey: env.COINGECKO_DEMO_API_KEY || ''
  };
}
