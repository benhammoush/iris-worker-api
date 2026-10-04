// Contract and function pairs are deliberately explicit. A matching function name
// on an unknown contract is not enough evidence to classify a transaction as a swap.
const DEX_ROUTES = [{
  protocol: 'ALEX DLMM',
  contractId: 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-2',
  functions: new Set(['swap-y-for-x-simple-range-multi'])
}];

function routeFor(transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  const call = transaction.contract_call;
  return DEX_ROUTES.find((route) => route.contractId === call?.contract_id && route.functions.has(call?.function_name));
}

export function isRegisteredDexSwap(transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  return transaction.tx_status === 'success' && Boolean(routeFor(transactionEntry));
}

export function protocolForSwap(transactionEntry) {
  return routeFor(transactionEntry)?.protocol || null;
}

export function registeredDexRoutes() {
  return DEX_ROUTES;
}
