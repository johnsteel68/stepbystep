import { ArrowRight, Loader2 } from 'lucide-react';

/** Une seule action principale : préparer et transmettre la pièce au deck.
 * Commander ici ouvre le parcours John Steel, sans paiement automatique. */
export default function OrderButton({ busy, feasible, onOrder }: {
  busy: boolean;
  feasible: boolean;
  onOrder: () => void;
}) {
  return <button type="button" onClick={onOrder} disabled={busy || !feasible} aria-busy={busy}
    title={!feasible ? 'Corrigez les points de fabricabilité avant de commander.' : undefined}
    className={`w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-200 text-sm ${
      busy ? 'cursor-wait border border-pink-300/40 bg-pink-500/20 text-pink-100'
        : !feasible ? 'cursor-not-allowed border border-zinc-700 bg-zinc-800 text-zinc-500'
        : 'bg-pink-600 hover:bg-pink-500 text-white border border-pink-300'
    }`}>
    {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
    <span>{busy ? 'Préparation de votre pièce…' : 'Commander ma pièce'}</span>
  </button>;
}
