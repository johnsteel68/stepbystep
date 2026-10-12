/**
 * The uploader allows anonymous cross-origin multipart requests. Call it
 * directly: the StepByStep relay currently redirects POSTs to the shop homepage.
 */
export function getDeckUploadEndpoint(): string {
  return 'https://www.john-steel.com/fr/module/johnsteel_uploader/upload';
}

/**
 * Validate the shop response before any navigation. A 200 HTML login/home
 * page is not a successful upload; only the expected HTTPS shop is trusted.
 * The request is injectable so tests never send customer files to the shop.
 */
export async function uploadStepToDeck(file: File, request: typeof fetch = fetch): Promise<string> {
  const body = new FormData();
  body.append('file', file, file.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await request(getDeckUploadEndpoint(), {
      method: 'POST', body, headers: { Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    const text = await response.text();
    let result: { success?: boolean; deck_url?: string; message?: string } | null = null;
    try { result = JSON.parse(text); } catch { /* Diagnose HTML separately below. */ }
    const message = typeof result?.message === 'string' ? result.message : '';
    if (!response.ok) throw new Error(message || `Le service du deck a répondu avec le statut ${response.status}.`);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(describeInvalidDeckResponse({
        status: response.status, contentType: response.headers.get('content-type'),
        url: response.url, redirected: response.redirected, bodyLength: text.length,
      }));
    }
    if (result.success !== true || typeof result.deck_url !== 'string' || !result.deck_url) {
      throw new Error(message || 'Le service du deck n’a pas confirmé la réception du fichier.');
    }
    const rawUrl = /^https?:\/\//i.test(result.deck_url) ? result.deck_url
      : result.deck_url.startsWith('/') ? new URL(result.deck_url, 'https://www.john-steel.com').toString()
      : `https://${result.deck_url}`;
    const destination = new URL(rawUrl);
    if (destination.protocol !== 'https:' || destination.hostname !== 'www.john-steel.com'
      || destination.username || destination.password || (destination.port && destination.port !== '443')) {
      throw new Error('Le service a renvoyé une adresse de deck inattendue.');
    }
    return destination.toString();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Le service du deck met trop longtemps à répondre. Réessayez.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export function describeInvalidDeckResponse(response: {
  status: number;
  contentType: string | null;
  url: string;
  redirected: boolean;
  bodyLength: number;
}): string {
  const contentType = response.contentType?.split(';', 1)[0].trim() || 'type inconnu';
  let finalEndpoint = '';
  try {
    const url = new URL(response.url);
    finalEndpoint = `${url.host}${url.pathname}`;
  } catch {
    // Some mocked or opaque responses do not expose a final URL.
  }
  const finalUrl = finalEndpoint
    ? `; ${response.redirected ? 'redirection finale' : 'URL finale'} : ${finalEndpoint}`
    : '';
  const body = response.bodyLength === 0 ? '; réponse vide' : `; corps ${response.bodyLength} caractères`;
  return `Réponse non JSON du service du deck (HTTP ${response.status}, ${contentType}${finalUrl}${body}).`;
}
