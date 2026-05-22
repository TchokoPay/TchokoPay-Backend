type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.tchokopay.com',
  'https://tchokopay.com',
  'https://api.tchokopay.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

function parseOrigins(value?: string) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function uniqueOrigins(origins: string[]) {
  return Array.from(new Set(origins));
}

export function getHttpCorsOrigins() {
  return uniqueOrigins([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...parseOrigins(process.env.CORS_ORIGINS),
  ]);
}

export function getWebsocketCorsOrigins() {
  return uniqueOrigins([
    ...getHttpCorsOrigins(),
    ...parseOrigins(process.env.WEBSOCKET_CORS_ORIGIN),
  ]);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

export function createCorsOriginDelegate(
  allowedOrigins: string[],
  label = 'CORS',
) {
  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }

    callback(new Error(`${label} blocked for origin: ${origin}`), false);
  };
}
