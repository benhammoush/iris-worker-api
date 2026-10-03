export function supplyFromAtomic(totalSupply, decimals) {
  return totalSupply / Math.pow(10, decimals);
}

export function priceChangePercent(actualPrice, previousPrice) {
  return ((actualPrice - previousPrice) / previousPrice) * 100;
}

export function marketCapString(supply, actualPrice) {
  return (supply * Number(actualPrice)).toFixed();
}

export function buildAsset(token, metadata, priceHistory, stxSupply) {
  const prices = priceHistory.prices;
  const actualPrice = prices[0].avg_price_usd;
  const dayPrice = prices[50].avg_price_usd;
  const weekPrice = prices[750].avg_price_usd;
  const monthPrice = prices[4050].avg_price_usd;
  const isStx = token.symbol === 'STX';
  const decimals = isStx ? 6 : metadata.decimals;
  const supply = isStx ? stxSupply : supplyFromAtomic(metadata.total_supply, decimals);
  const change24h = priceChangePercent(actualPrice, dayPrice);
  const change7d = priceChangePercent(actualPrice, weekPrice);
  const change30d = priceChangePercent(actualPrice, monthPrice);
  const marketCap = marketCapString(supply, actualPrice);
  return {
    symbol: token.symbol,
    name: isStx ? 'Stacks' : (metadata.name || token.symbol),
    imageUrl: isStx ? 'https://cryptologos.cc/logos/stacks-stx-logo.png?v=029' : metadata.image_uri,
    contractId: token.contract,
    decimals,
    price: actualPrice,
    supply,
    totalSupply: isStx ? stxSupply : metadata.total_supply,
    marketCap,
    change24h,
    change7d,
    change30d,
    priceHistory: prices.map((point) => ({
      date: point.date ?? point.timestamp ?? point.sync_at ?? point.time,
      price: point.avg_price_usd
    })),
    // Legacy aliases remain while clients migrate to the normalized fields above.
    actualprice: actualPrice,
    image: isStx ? 'https://cryptologos.cc/logos/stacks-stx-logo.png?v=029' : metadata.image_uri,
    marketcap: marketCap,
    pricedayminusone: dayPrice,
    percentdayminusone: change24h,
    priceweekminusone: weekPrice,
    percentweekminusone: change7d,
    pricemonthminusone: monthPrice,
    percentmonthminusone: change30d,
    contractname: isStx ? 'stx' : metadata.contract_principal.split('.')[1]
  };
}
