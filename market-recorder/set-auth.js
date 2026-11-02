'use strict';

// Fallback when the site has not saved a session today:
//   printf '%s\n%s\n' "$KITE_API_KEY" "$KITE_ACCESS_TOKEN" | node market-recorder/set-auth.js
const { saveAuthFile } = require('./auth');

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  const [apiKey, accessToken] = buf.split('\n').map((s) => s.trim());
  if (!apiKey || !accessToken) {
    console.error('expected api key and access token on stdin, one per line');
    process.exit(1);
  }
  saveAuthFile(apiKey, accessToken);
  console.log('auth saved');
});
