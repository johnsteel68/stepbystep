/**
 * Share expensive initialization across callers, but never cache a rejection.
 * A failed WASM download must allow the next export to retry.
 */
export function createRetryableInitializer<T>(initialize: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(initialize).catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
