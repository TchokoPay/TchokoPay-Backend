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
  return uniqueOrigins(parseOrigins(process.env.CORS_ORIGINS));
}

export function getWebsocketCorsOrigins() {
  return uniqueOrigins(
    parseOrigins(process.env.WEBSOCKET_CORS_ORIGIN).length > 0
      ? parseOrigins(process.env.WEBSOCKET_CORS_ORIGIN)
      : getHttpCorsOrigins(),
  );
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}
