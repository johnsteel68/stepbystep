import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { MOBILE_MEDIA_QUERY, type MobileDockMode } from './useMobileControlPages';

/** La hauteur visible exclut le clavier virtuel et les barres du navigateur.
 * Le mode guidé mobile n'affiche qu'une étape, contrairement au panneau Pro. */
export function useMobileWorkspace(setProMode: Dispatch<SetStateAction<boolean>>) {
  const [mobileDock, setMobileDock] = useState<MobileDockMode>('compact');
  const appRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const resize = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      appRoot.current?.style.setProperty('--workspace-height', `${height}px`);
      if (media.matches) setProMode(false);
    };

    resize();
    media.addEventListener('change', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      media.removeEventListener('change', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [setProMode]);

  return { appRoot, mobileDock, setMobileDock };
}
