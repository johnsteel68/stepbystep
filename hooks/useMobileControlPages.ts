import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { mobileControlPages } from '../components/mobileControlPages';

export const MOBILE_MEDIA_QUERY = '(max-width: 860px)';
export type MobileDockMode = 'compact' | 'expanded' | 'viewer';

const FIELD_SELECTORS = [
  '.dimension-field', '.finish-option', '.blank-shape-option',
  '.placement-panel > *', '.dimension-fields > *',
  '.workflow-step > *', '.hole-list > *',
].join(', ');
const ROW_PADDING_PX = 8;
const DUPLICATE_ROW_TOLERANCE_PX = 6;

/** Pagination mesurée sur les champs réels, sans démonter leurs brouillons.
 * La navigation native au clavier ramène aussi le champ sur la bonne page. */
export function useMobileControlPages(
  scrollRef: RefObject<HTMLDivElement | null>,
  stepKey: string,
  mode: MobileDockMode,
) {
  const [pages, setPages] = useState([0]);
  const [page, setPage] = useState(0);
  const currentPage = useRef(0);
  const pageBoundaries = useRef([0]);

  useEffect(() => {
    currentPage.current = 0;
    setPage(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [stepKey, scrollRef]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    let animationFrame = 0;

    const measurePages = () => {
      if (!media.matches || mode === 'viewer' || element.clientHeight < 1) return;
      const panel = element;
      const bounds = panel.getBoundingClientRect();
      const viewportHeight = panel.clientHeight;

      // Aligner les pages sur les champs évite de couper un contrôle en deux.
      const rows = [...panel.querySelectorAll<HTMLElement>(FIELD_SELECTORS)]
        .filter(node => node.getClientRects().length && node.getBoundingClientRect().height < viewportHeight)
        .map(node => Math.max(0, Math.round(
          node.getBoundingClientRect().top - bounds.top + panel.scrollTop - ROW_PADDING_PX,
        )))
        .sort((a, b) => a - b)
        .filter((value, index, all) => !index || value - all[index - 1] > DUPLICATE_ROW_TOLERANCE_PX);

      const nextPages = mobileControlPages(rows, panel.scrollHeight, viewportHeight);
      pageBoundaries.current = nextPages;
      setPages(previous => previous.join(',') === nextPages.join(',') ? previous : nextPages);
      currentPage.current = Math.min(currentPage.current, nextPages.length - 1);
      setPage(currentPage.current);
      panel.scrollTo({ top: nextPages[currentPage.current], behavior: 'instant' });
    };

    // Regrouper les notifications de mutation/resize dans une seule frame.
    const scheduleMeasurement = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measurePages);
    };
    const resizeObserver = new ResizeObserver(scheduleMeasurement);
    resizeObserver.observe(element);
    if (element.firstElementChild) resizeObserver.observe(element.firstElementChild);

    const mutationObserver = new MutationObserver(scheduleMeasurement);
    mutationObserver.observe(element, { childList: true, subtree: true });

    const revealFocusedField = (event: FocusEvent) => {
      if (!media.matches || !(event.target instanceof HTMLElement)) return;
      const top = event.target.getBoundingClientRect().top
        - element.getBoundingClientRect().top + element.scrollTop;
      let focusedPage = 0;
      pageBoundaries.current.forEach((boundary, index) => {
        if (boundary <= top) focusedPage = index;
      });
      currentPage.current = focusedPage;
      setPage(focusedPage);
      element.scrollTo({ top: pageBoundaries.current[focusedPage], behavior: 'instant' });
    };

    element.addEventListener('focusin', revealFocusedField);
    media.addEventListener('change', scheduleMeasurement);
    window.visualViewport?.addEventListener('resize', scheduleMeasurement);
    scheduleMeasurement();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener('focusin', revealFocusedField);
      media.removeEventListener('change', scheduleMeasurement);
      window.visualViewport?.removeEventListener('resize', scheduleMeasurement);
    };
  }, [scrollRef, stepKey, mode]);

  const navigate = (index: number) => {
    const nextPage = Math.max(0, Math.min(index, pages.length - 1));
    currentPage.current = nextPage;
    setPage(nextPage);
    scrollRef.current?.scrollTo({ top: pages[nextPage], behavior: 'instant' });
  };

  return { pages, page, navigate };
}
