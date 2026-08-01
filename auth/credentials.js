/**
 * Server-side only — not in Mongo / not in Angular.
 *
 * Admin portal (/admin/login): Admin / Goodbadu1789@21
 * Site owner (/login): Devil / Goodbadu1789@21  (same password)
 * Friends: passwords set in Admin (Mongo bcrypt + passwordPlain)
 */
module.exports = {
  /** Shared with Devil — Admin portal only (not a Mongo user) */
  ADMIN: {
    username: 'Admin',
    password: 'Goodbadu1789@21',
  },
  /** Vault unlock — encrypts/decrypts vault_secrets in Mongo */
  VAULT_PASSWORD: 'Krishnan1789@9871',
  /** JWT signing for site users */
  JWT_SECRET: 'palagai-site-jwt-goodbadu-1789',
  JWT_DAYS: 14,
  /** Owner site account — seeded into Mongo on boot */
  OWNER_SEED: {
    username: 'Devil',
    password: 'Goodbadu1789@21',
    role: 'owner',
    modules: ['trade', 'crude', 'auto', 'token', 'test', 'strat', 'pnl', 'vault'],
  },
  /** Friends may be granted these (test is always on for everyone) */
  FRIEND_MODULES: ['trade', 'crude', 'auto', 'token', 'test'],
  OWNER_ONLY_MODULES: ['strat', 'pnl', 'vault'],
  ALL_MODULES: ['trade', 'crude', 'auto', 'token', 'test', 'strat', 'pnl', 'vault'],
};
