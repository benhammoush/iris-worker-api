export const DEMO_WALLETS = [
  {
    address: 'SP3MXB0HQH72ZGBTD6QWNRK9WNK1ZMMAXF6ANB2E8',
    label: 'Demo A',
    description: 'Public demo wallet with STX activity.'
  },
  {
    address: 'SP34SVHFFP532M35DHWTQJKJJR2DRGS7T5XEXQ0M0',
    label: 'Demo B',
    description: 'Public demo wallet with diversified assets.'
  },
  {
    address: 'SPG9HQ3A54KNP4V2HPJ20VBSFEE7W09ZBFJF2RNH',
    label: 'Demo C',
    description: 'Public demo wallet with recent STX activity.'
  }
];

export function getConfig(env) {
  return {
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
    wallets: DEMO_WALLETS
  };
}
