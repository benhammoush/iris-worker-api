export function getConfig(env) {
  return {
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
    heliusApiKey: env.HELIUS_API_KEY || '',
    jupiterApiKey: env.JUPITER_API_KEY || '',
    birdeyeApiKey: env.BIRDEYE_API_KEY || ''
  };
}
