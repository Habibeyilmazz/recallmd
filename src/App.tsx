import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { inDeck } from './lib/stats';
import { useStore } from './store';
import { Home } from './views/Home';
import { Review } from './views/Review';
import { Settings } from './views/Settings';
import { Stats } from './views/Stats';

const onHashChange = (notify: () => void) => {
  addEventListener('hashchange', notify);
  return () => removeEventListener('hashchange', notify);
};

/** Hash routes: "#/", "#/review?deck=…", "#/stats", "#/settings". They work from any base path and offline. */
function useRoute() {
  const hash = useSyncExternalStore(onHashChange, () => location.hash);
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { hash, path, params: new URLSearchParams(query) };
}

/** The current time, refreshed when you come back to the tab so that "today" rolls over. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

/** A crash in one screen should not leave a blank page: say what happened and offer a way out. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert">
        <h1>This screen ran into a problem</h1>
        <p>Your cards and review history are stored safely and were not changed by this.</p>
        <div className="actions">
          <button className="button primary" onClick={() => location.reload()}>
            Reload recallmd
          </button>
          <a className="button" href="#/settings" onClick={() => this.setState({ failed: false })}>
            Open Settings to export your data
          </a>
        </div>
      </section>
    );
  }
}

const NAV = [
  ['', 'Decks'],
  ['stats', 'Stats'],
  ['settings', 'Settings'],
] as const;

export function App() {
  const { store, error, clearError } = useStore();
  const route = useRoute();

  let page;
  if (!store) {
    page = <p className="muted">{error ? 'recallmd could not open its storage in this browser.' : 'Loading…'}</p>;
  } else if (route.path === 'review') {
    const deck = route.params.get('deck');
    const tag = route.params.get('tag');
    const cards = store.data.cards.filter((c) => (deck ? inDeck(c, deck) : tag ? c.tags.includes(tag) : true));
    // Keyed by route so a different deck starts a fresh session.
    page = <Review key={route.hash} store={store} cards={cards} title={deck ?? (tag ? `#${tag}` : 'All decks')} />;
  } else if (route.path === 'stats') {
    page = <Stats data={store.data} />;
  } else if (route.path === 'settings') {
    page = <Settings store={store} />;
  } else {
    page = <Home store={store} />;
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <img src="./icon.svg" alt="" width="26" height="26" />
          recallmd
        </a>
        <nav aria-label="Main">
          {NAV.map(([path, label]) => (
            <a key={path} href={`#/${path}`} aria-current={(route.path === 'review' ? '' : route.path) === path ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      {error && (
        <p className="error" role="alert">
          Something could not be saved: {error} <button onClick={clearError}>Dismiss</button>
        </p>
      )}
      <main className="page">
        {/* Keyed by route: leaving the broken screen clears the error. */}
        <Boundary key={route.path}>{page}</Boundary>
      </main>
    </>
  );
}
