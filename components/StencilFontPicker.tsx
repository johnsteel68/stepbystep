import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SELECTABLE_STENCIL_FONTS, STENCIL_FONTS, stencilCells, textMinimumHeight, type StencilFont } from '../stencilText';
import TextCutout from './TextCutout';

// Cache only the sample geometry: opening the menu must not rebuild the 3D part.
const samples = new Map<string, ReturnType<typeof stencilCells>>();
function FontPreview({ font, text }: { font: StencilFont; text: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  // Do not decode all font outlines synchronously when opening the dropdown.
  if (!visible) return <span ref={element} style={{ display: 'inline-block', width: 120, height: 38 }} aria-hidden="true" />;
  const height = textMinimumHeight(2, font);
  const sample = text.trim().slice(0, 8) || 'METAL';
  const key = `${font}:${sample}`;
  let cuts = samples.get(key);
  if (!cuts) {
    try { cuts = stencilCells({ text: sample, font, height, x: 0, y: 0, rotation: 0 }, 2); }
    catch { cuts = stencilCells({ text: 'AB', font, height, x: 0, y: 0, rotation: 0 }, 2); }
    if (samples.size >= 128) samples.delete(samples.keys().next().value!);
    samples.set(key, cuts);
  }
  const left = Math.min(...cuts.map(c => c.dist - (c.length ?? c.diam ?? 0) / 2));
  const right = Math.max(...cuts.map(c => c.dist + (c.length ?? c.diam ?? 0) / 2));
  return <svg aria-hidden="true" viewBox={`${left - height * .1} ${-height * .65} ${right - left + height * .2} ${height * 1.3}`} width="120" height="38" fill="currentColor">
    {cuts.map((cut, index) => <TextCutout key={index} cut={cut} />)}
  </svg>;
}

export default function StencilFontPicker({ value, onChange, text = '' }: { value: StencilFont; text?: string; onChange: (font: StencilFont) => void }) {
  const selected = STENCIL_FONTS.find(font => font.id === value)!;
  // Old shared projects retain their font, without advertising stretched variants.
  const allFonts = useMemo(() => SELECTABLE_STENCIL_FONTS.some(font => font.id === value)
    ? SELECTABLE_STENCIL_FONTS : [selected, ...SELECTABLE_STENCIL_FONTS], [value, selected]);
  const [query, setQuery] = useState('');
  const fonts = allFonts.filter(font => `${font.label} ${font.description}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 360 });
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const show = () => { setQuery(''); setActive(Math.max(0, allFonts.findIndex(font => font.id === value))); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16);
      const below = (window.visualViewport?.height ?? window.innerHeight) - rect.bottom - 12;
      const above = rect.top - 12;
      const down = below >= Math.min(300, above);
      const maxHeight = Math.max(80, Math.min(360, down ? below : above));
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: down ? rect.bottom + 4 : Math.max(8, rect.top - maxHeight - 4), width, maxHeight });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    place(); list.current?.focus();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  const choose = (index: number) => { if (fonts[index]) { onChange(fonts[index].id); close(true); } };
  return <>
    <button ref={trigger} type="button" className="stencil-picker-trigger" aria-label="Police du texte" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby="stencil-font-description"
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}><span>{selected.label}</span><FontPreview font={value} text={text} /><span aria-hidden="true">▾</span></button>
    {open && createPortal(<div ref={list} id={id} role="dialog" aria-label="Choisir une police stencil" tabIndex={-1}
      className="stencil-picker-menu" style={position}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(); }}
      onKeyDown={event => {
        if ((event.target as HTMLElement).tagName === 'INPUT' && !['ArrowDown', 'Escape'].includes(event.key)) return;
        if (event.key === 'Tab') { close(); return; }
        if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); return; }
        const next = event.key === 'ArrowDown' ? Math.min(fonts.length - 1, active + 1)
          : event.key === 'ArrowUp' ? Math.max(0, active - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? fonts.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActive(next); }
      }}>
      <div role="presentation" className="p-2">
        <input type="search" aria-label="Rechercher une police stencil" placeholder={`Rechercher parmi ${allFonts.length} polices…`} value={query}
          className="w-full rounded border border-hardware-border bg-hardware-bg p-2" onChange={event => { setQuery(event.target.value); setActive(0); }} />
      </div>
      {fonts.length === 0 && <p role="status" className="p-2">Aucune police correspondante.</p>}
      <div role="listbox" aria-label="Polices stencil" tabIndex={0} aria-activedescendant={fonts.length ? `${id}-${active}` : undefined}>
      {fonts.map((font, index) => <div key={font.id} id={`${id}-${index}`} role="option" aria-selected={font.id === value}
        className={`stencil-picker-option${active === index ? ' is-focused' : ''}`} onPointerMove={event => { if (event.pointerType === 'mouse') setActive(index); }} onClick={() => choose(index)}>
        <span className="stencil-picker-name">{font.label}{font.id === value && <span aria-hidden="true"> ✓</span>}</span>
        <FontPreview font={font.id} text={text} />
      </div>)}
      </div>
    </div>, document.body)}
  </>;
}
