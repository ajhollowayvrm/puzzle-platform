// Backend API base. The deployed Function URL is public (not a secret), so it's a
// safe default; a local dev build can override with VITE_API_URL.
const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
export const API_URL = (fromEnv ?? 'https://v5wc4prfmenh5vcrkb3tla5wv40wxjmn.lambda-url.us-west-2.on.aws').replace(
  /\/$/,
  '',
);
