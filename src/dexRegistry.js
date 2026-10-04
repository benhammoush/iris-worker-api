// These are the common swap entry points observed across supported Stacks DEX
// contracts. Contract-specific decoders can be added here as protocols are verified.
const SWAP_FUNCTIONS = new Set(['swap', 'swap-helper', 'swap-x-for-y', 'swap-y-for-x']);

export function isRegisteredDexSwap(transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  const call = transaction.contract_call;
  return transaction.tx_status === 'success' && call?.contract_id && SWAP_FUNCTIONS.has(call.function_name);
}

export function protocolForSwap(transactionEntry) {
  const contractId = (transactionEntry.tx || transactionEntry).contract_call?.contract_id || '';
  return contractId.includes('.alex') ? 'ALEX' : 'Stacks DEX';
}
