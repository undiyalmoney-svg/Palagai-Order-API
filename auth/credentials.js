/**
 * Server-side only credentials (Devil-style constants — not in Mongo).
 * Do not import this into the Angular app.
 */
module.exports = {
  /** Separate Admin portal login */
  ADMIN: {
    username: 'angel',
    password: 'Badgoodu1789@21',
  },
  /** Vault unlock — encrypts/decrypts vault_secrets in Mongo */
  VAULT_PASSWORD: 'Krishnan1789@9871',
  /** JWT signing for site users (friends + owner Devil) */
  JWT_SECRET: 'palagai-site-jwt-goodbadu-1789',
  JWT_DAYS: 14,
  /** Seeded owner site account */
  OWNER_SEED: {
    username: 'Devil',
    password: 'Goodbadu1789@21',
    role: 'owner',
    modules: ['trade', 'crude', 'auto', 'token', 'strat', 'pnl', 'vault'],
  },
  FRIEND_MODULES: ['trade', 'crude', 'auto', 'token'],
  OWNER_ONLY_MODULES: ['strat', 'pnl', 'vault'],
  ALL_MODULES: ['trade', 'crude', 'auto', 'token', 'strat', 'pnl', 'vault'],
};
