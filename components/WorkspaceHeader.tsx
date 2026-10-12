
export default function WorkspaceHeader({ proMode, onModeChange, disabled = false }: { proMode: boolean; onModeChange: (pro: boolean) => void; disabled?: boolean }) {
  return <header className="app-brandbar">
    <div className="brand" aria-label="STEPbySTEP">
      <div className="brand-mark"><img src="/logo_SBS.png" alt="" /></div>
      <div><div className="brand-wordmark">STEP<span>by</span>STEP</div><div className="brand-caption">Tôlerie paramétrique</div></div>
    </div>
    <div className="mode-switch" role="group" aria-label="Mode de configuration">
      <button type="button" aria-pressed={!proMode} disabled={disabled} title={disabled ? 'Validez ou annulez l’édition avant de changer de mode' : undefined} onClick={() => onModeChange(false)}>Guidé</button>
      <button type="button" aria-pressed={proMode} disabled={disabled} title={disabled ? 'Validez ou annulez l’édition avant de changer de mode' : undefined} onClick={() => onModeChange(true)}>Pro</button>
    </div>
  </header>;
}
