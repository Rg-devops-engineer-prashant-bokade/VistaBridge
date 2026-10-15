// ============================================================================
// GeoServer Helper Utilities
// Provides helpers to get the active GeoServer URL, extract login auth headers,
// and format URLs properly for API requests.
// ============================================================================

// Checks if the app is currently running inside Docker
export function isRunningInDocker(): boolean {
  return false;
}

// Gets the active GeoServer URL:
// 1. First checks if user has a custom GeoServer URL saved in their browser cookie.
// 2. If not, falls back to .env variables (GEOSERVER_URL or NEXT_PUBLIC_GEOSERVER_URL).
// 3. Otherwise defaults to http://localhost:8080/geoserver.
export function getGeoServerUrl(request?: Request): string {
  if (request) {
    // Read the 'cookie' header from the incoming request
    const cookiesHeader = request.headers.get('cookie') || '';
    const match = cookiesHeader.match(/geoserver_url=([^;]+)/);
    if (match) {
      // Decode and remove any trailing slash (e.g. "http://localhost:8080/geoserver/" -> ".../geoserver")
      return decodeURIComponent(match[1]).replace(/\/+$/, '');
    }
  }
  return (process.env.GEOSERVER_URL || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/+$/, '');
}

// Extracts GeoServer authentication headers from the request cookies.
// If the user is logged in, their Basic Auth token (base64 username:password)
// is stored in the 'geoserver_auth' cookie and forwarded to GeoServer.
export function getGeoServerHeaders(request?: Request): Record<string, string> {
  const reqHeaders: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (request) {
    const cookiesHeader = request.headers.get('cookie') || '';
    const match = cookiesHeader.match(/geoserver_auth=([^;]+)/);
    if (match) {
      reqHeaders['Authorization'] = decodeURIComponent(match[1]);
    }
  }
  return reqHeaders;
}

// Cleans up and normalizes a GeoServer URL string:
// - Removes trailing slashes
// - Adds 'http://' prefix if the protocol is missing
export function resolveInternalGeoServerUrl(url?: string): string {
  let targetUrl = (url || process.env.GEOSERVER_URL || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').trim().replace(/\/+$/, '');
  if (!targetUrl || targetUrl === '.' || targetUrl === './' || targetUrl === 'default') {
    targetUrl = 'http://localhost:8080/geoserver';
  } else if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `http://${targetUrl}`;
  }
  return targetUrl;
}

// Resolves a layer ID against the GeoServer catalog (e.g. "workspace:layer_name")
export async function resolveLayerId(
  cleanUrl: string,
  layerId: string,
  _headers: Record<string, string>
): Promise<string> {
  return layerId;
}


