import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; scope: 'application' | 'viewer' };
type State = { failed: boolean; attempt: number };

/**
 * Keep the editor mounted when the GPU, a texture, or the lazy viewer fails.
 * A retry remounts only this subtree; the part configuration lives above it.
 * A failed JavaScript chunk still needs a full reload (browser module cache).
 */
export default class RenderBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`STEPbySTEP ${this.props.scope}`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }
    const viewer = this.props.scope === 'viewer';
    return (
      <section className="render-recovery" role="alert" aria-live="assertive">
        <h2>{viewer ? 'La vue 3D a été interrompue' : 'Le configurateur a été interrompu'}</h2>
        <p>{viewer ? 'Vos réglages sont conservés. Vous pouvez relancer la vue ou continuer à modifier la pièce.' : 'Réessayez pour rouvrir le configurateur.'}</p>
        <div>
          <button type="button" onClick={() => this.setState(previous => ({ failed: false, attempt: previous.attempt + 1 }))}>Réessayer</button>
          <button type="button" onClick={() => window.location.reload()}>Recharger la page</button>
        </div>
        <small>Le rechargement réinitialise les changements non partagés. Copiez le lien du projet avant de recharger, si possible.</small>
      </section>
    );
  }
}
