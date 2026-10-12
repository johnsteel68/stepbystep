import * as THREE from 'three';
import { getNeutralTexturePixel, reportTextureFailure } from './textureHealth.ts';

/**
 * One missing image must not remove the entire part. The real geometry remains
 * visible using a neutral map, with a persistent warning outside the canvas.
 * This only recovers asset download failures, not geometry/programming errors.
 */
export class ResilientTextureLoader extends THREE.Loader<THREE.Texture> {
  load(url: string, onLoad?: (texture: THREE.Texture) => void, onProgress?: (event: ProgressEvent) => void, _onError?: (error: unknown) => void): THREE.Texture {
    const loader = new THREE.TextureLoader(this.manager);
    loader.setPath(this.path);
    loader.setCrossOrigin(this.crossOrigin);
    loader.setWithCredentials(this.withCredentials);
    return loader.load(url, onLoad, onProgress, () => {
      reportTextureFailure(url);
      const fallback = new THREE.DataTexture(new Uint8Array(getNeutralTexturePixel(url)), 1, 1);
      fallback.needsUpdate = true;
      onLoad?.(fallback);
    });
  }
}
