/**
 * Server-side only credentials — not in Mongo / not in Angular.
 *
 * Admin portal: Admin / Pavalamalli
 * Site owner: Devil / Goodbadu1789@21
 */
module.exports = {
  /** Separate Admin portal login */
  ADMIN: {
    username: 'Admin',
    password: 'Pavalamalli',
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
  /** Old admin names/passwords still accepted until friends re-login */
  LEGACY_ADMIN_USERNAMES: ['angel'],
  LEGACY_PASSWORDS: ['Badgoodu1789@21', 'Goodbadu1789@21'],
  FRIEND_MODULES: ['trade', 'crude', 'auto', 'token'],
  OWNER_ONLY_MODULES: ['strat', 'pnl', 'vault'],
  ALL_MODULES: ['trade', 'crude', 'auto', 'token', 'strat', 'pnl', 'vault'],
};
