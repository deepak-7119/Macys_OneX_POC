import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  registerApplication,
  start,
  navigateToUrl,
  addErrorHandler,
  type LifeCycles,
} from 'single-spa';
import type { AppManifest, AppProps, Bootstrap, ProfileId } from '../../contracts/index.ts';
import { api } from '../../spool/src/client.ts';
import { bindNavigationEvents } from '../../spool/src/navigation.ts';
import {
  presentationUrl,
  readPresentationMode,
  setPresentationMode,
  usePresentationMode,
} from '../../spool/src/presentation.ts';
import { Badge, Button, Feedback } from '../../thread/src/index.tsx';
import { PresentationSwitch } from './PresentationSwitch.tsx';
import { PlatformMap } from '../../management/ManagementDashboard.tsx';
import './styles/styles.css';
import './styles/pos.css';

function AppIcon({ icon }: { icon: AppManifest['icon'] }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {icon === 'receipt' ? (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </>
      ) : (
        <>
          <path d="M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Z" />
          <path d="M12 5v15M6 8h3M15 8h3M6 11h3M15 11h3" />
        </>
      )}
    </svg>
  );
}
function link(
  event: React.MouseEvent<HTMLAnchorElement>,
  path: string,
  navigationMode: Bootstrap['runtime']['navigationMode'],
) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  if (navigationMode === 'gateway') return;
  event.preventDefault();
  navigateToUrl(presentationUrl(path, readPresentationMode(location.href)));
}
let registered = false;
function Platform({ bootstrap }: { bootstrap: Bootstrap }) {
  const mode = usePresentationMode();
  const previousMode = useRef(mode);
  const [path, setPath] = useState(location.pathname);
  const [runtimeError, setRuntimeError] = useState('');
  const [changing, setChanging] = useState(false);
  const [showPlatformMap, setShowPlatformMap] = useState(false);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    const host = mode === 'pos' ? '.pos-host-header' : '.topbar';
    document
      .querySelector<HTMLButtonElement>(`${host} .presentation-switch [aria-pressed="true"]`)
      ?.focus({ preventScroll: true });
  }, [mode]);
  useEffect(() => {
    const unbindNavigation = bindNavigationEvents(
      window,
      () => location.pathname,
      setPath,
      () => setRuntimeError(''),
    );
    if (
      !registered &&
      (bootstrap.runtime.navigationMode === 'embedded' || location.pathname !== '/')
    ) {
      registered = true;
      addErrorHandler((error) => {
        console.error(error);
        setRuntimeError('This application could not be loaded. Refresh to retry.');
      });
      for (const manifest of bootstrap.apps) {
        registerApplication<AppProps>({
          name: manifest.id,
          app: () => import(/* @vite-ignore */ manifest.entry) as Promise<LifeCycles<AppProps>>,
          activeWhen: (location) =>
            location.pathname === manifest.path ||
            location.pathname.startsWith(`${manifest.path}/`),
          customProps: { manifest, session: bootstrap.session },
        });
      }
      start({ urlRerouteOnly: true });
    }
    return unbindNavigation;
  }, [bootstrap]);
  const current = bootstrap.apps.find(
    (app) => path === app.path || path.startsWith(`${app.path}/`),
  );
  const home = path === '/';
  async function changeProfile(profile: ProfileId) {
    setChanging(true);
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ profile }) });
      location.assign(presentationUrl('/', mode));
    } catch {
      setRuntimeError('The local profile could not be changed.');
      setChanging(false);
    }
  }
  return (
    <div className={`platform${mode === 'pos' ? ' platform--pos' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace navigation" hidden={mode === 'pos'}>
        <a
          href={presentationUrl('/', mode)}
          onClick={(event) => link(event, '/', bootstrap.runtime.navigationMode)}
          className="brand"
          aria-label="OneExperience home"
        >
          <img
            className="brand-logo"
            src="/brand/macys-logo.svg"
            width="141"
            height="40"
            alt="Macy’s"
          />
          <span className="brand-subtitle">ONE EXPERIENCE</span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <a
          className={`nav-link ${home ? 'is-active' : ''}`}
          href={presentationUrl('/', mode)}
          onClick={(event) => link(event, '/', bootstrap.runtime.navigationMode)}
          aria-current={home ? 'page' : undefined}
        >
          <span aria-hidden="true">⌂</span> Application hub
        </a>
        <p className="nav-label nav-label-apps">YOUR APPLICATIONS</p>
        <nav aria-label="Applications">
          {bootstrap.apps.map((app) => (
            <a
              className={`nav-link ${current?.id === app.id ? 'is-active' : ''}`}
              href={presentationUrl(app.path, mode)}
              key={app.id}
              onClick={(event) => link(event, app.path, bootstrap.runtime.navigationMode)}
              aria-current={current?.id === app.id ? 'page' : undefined}
            >
              <AppIcon icon={app.icon} />
              <span>{app.name}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="platform-label">
            <span className="status-dot" /> Overlock platform
          </div>
          <p>
            Thread UI · Spool root config
            <br />
            Static MFEs · Bobbin fallback
          </p>
          <span className="version-label">LOCAL PROOF OF CONCEPT / 01</span>
        </div>
      </aside>
      <div className="workspace">
        {mode === 'pos' && (
          <>
            <header className="pos-host-header">
              <a
                href={presentationUrl('/', mode)}
                onClick={(event) => link(event, '/', bootstrap.runtime.navigationMode)}
                aria-label="POS application hub"
              >
                <img src="/brand/macys-logo.svg" width="141" height="40" alt="Macy’s" />
              </a>
              <div className="pos-host-heading">
                <span>ASSOCIATE WORKSPACE</span>
                <strong>{current?.name ?? 'Application hub'}</strong>
              </div>
              <div className="pos-host-context">
                <span>
                  Division {bootstrap.session.division} · Store {bootstrap.session.store}
                </span>
                <Badge tone="warning">POS simulation</Badge>
              </div>
              <PresentationSwitch mode={mode} onChange={setPresentationMode} />
            </header>
            <div className="pos-host-status" role="note">
              Browser-based register preview · Same application and APIs · No physical POS or
              printer connected
            </div>
          </>
        )}
        <header className="topbar" hidden={mode === 'pos'}>
          <div className="breadcrumbs">
            OneExperience <span aria-hidden="true">/</span>{' '}
            <strong>{current?.name ?? 'Application hub'}</strong>
          </div>
          <div className="topbar-right">
            <PresentationSwitch mode={mode} onChange={setPresentationMode} />
            <Badge tone="warning">Synthetic data</Badge>
            <span className="avatar" aria-hidden="true">
              JD
            </span>
            <div className="profile">
              <span>{bootstrap.session.displayName}</span>
              <small>
                Division {bootstrap.session.division} · Store {bootstrap.session.store}
              </small>
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {home && (
            <>
              <section className="hub-hero">
                <span className="eyebrow">A MORE CONNECTED WORKDAY</span>
                <h1>
                  Your tools.
                  <br />
                  <span>One experience.</span>
                </h1>
                <p>
                  Everything you need to serve, discover and stay informed.
                  <br className="desktop-break" /> Choose an application to get started.
                </p>
                <div className="hero-caption">
                  <span className="status-dot" /> {bootstrap.apps.length} applications available to
                  your local profile
                </div>
                <div className="hero-decoration" aria-hidden="true">
                  <svg className="hero-star" viewBox="0 0 100 100" fill="currentColor">
                    <path d="m50 0 11.8 36.3H100L69.1 58.8 80.9 95.1 50 72.7 19.1 95.1 30.9 58.8 0 36.3h38.2Z" />
                  </svg>
                </div>
              </section>
              <section className="application-section" aria-labelledby="apps-heading">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">BUILT FOR YOUR DAY</span>
                    <h2 id="apps-heading">Your applications</h2>
                  </div>
                  <div className="section-heading__actions">
                    <Badge>{bootstrap.apps.length} available</Badge>
                    <Button
                      variant="secondary"
                      aria-expanded={showPlatformMap}
                      aria-controls="implementation-map"
                      onClick={() => setShowPlatformMap((visible) => !visible)}
                    >
                      {showPlatformMap ? 'Hide how it works' : 'See how it works'}
                    </Button>
                  </div>
                </div>
                <div className="app-grid">
                  {bootstrap.apps.map((app) => (
                    <article className={`app-card app-card--${app.icon}`} key={app.id}>
                      <div className="app-card-top">
                        <div className="app-icon">
                          <AppIcon icon={app.icon} />
                        </div>
                        <Badge tone="success">Available</Badge>
                      </div>
                      <span className="eyebrow">{app.eyebrow}</span>
                      <h3>{app.name}</h3>
                      <p>{app.description}</p>
                      <div className="app-card-footer">
                        <span>
                          {app.launchMode === 'standalone'
                            ? 'Direct launch supported'
                            : 'Session-enabled application'}
                        </span>
                        <a
                          className="app-open"
                          href={presentationUrl(app.path, mode)}
                          onClick={(event) =>
                            link(event, app.path, bootstrap.runtime.navigationMode)
                          }
                          aria-label={`Open ${app.name}`}
                        >
                          Open app <span aria-hidden="true">↗</span>
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              {showPlatformMap && (
                <PlatformMap apps={bootstrap.apps} onClose={() => setShowPlatformMap(false)} />
              )}
              <section className="architecture-note">
                <span className="architecture-mark" aria-hidden="true">
                  ✳
                </span>
                <div>
                  <h3>One Hub. Independently built micro-frontends.</h3>
                  <p>
                    Spool registers each route, the Hub loads its static MFE bundle on demand, and
                    Thread supplies the shared UI. Bobbin currently provides the fallback session
                    and API boundary while Macy’s evaluates the enterprise edge.
                  </p>
                </div>
                <Badge tone="accent">Overlock POC</Badge>
              </section>
            </>
          )}
          {!home && !current && (
            <Feedback
              kind="error"
              title="Application unavailable"
              message="This application is not available to the selected local profile. Return to the hub or choose the associate profile below."
            />
          )}
          {runtimeError && (
            <Feedback
              kind="error"
              title="Runtime issue"
              message={runtimeError}
              onRetry={() => location.reload()}
            />
          )}
          <div id="application-root" hidden={home || !current} />
        </main>
        <footer className="workspace-footer">
          <span>
            {mode === 'pos'
              ? 'POS presentation only. Synthetic context and content. Device actions are not connected.'
              : 'Local demonstration only. No real colleague, customer or payment data.'}
          </span>
          <label>
            Demo profile{' '}
            <select
              aria-label="Demo profile"
              disabled={changing}
              value={
                bootstrap.session.capabilities.includes('transactions:read')
                  ? 'associate'
                  : 'restricted'
              }
              onChange={(event) => void changeProfile(event.target.value as ProfileId)}
            >
              {bootstrap.profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
        </footer>
      </div>
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <div className="boot-screen">
    <Feedback
      kind="loading"
      title="Preparing your workspace"
      message="Loading local configuration…"
    />
  </div>,
);
api<Bootstrap>('/api/bootstrap')
  .then((bootstrap) => root.render(<Platform bootstrap={bootstrap} />))
  .catch(() =>
    root.render(
      <div className="boot-screen">
        <Feedback
          kind="error"
          title="Workspace unavailable"
          message="The OneX Hub runtime could not provide the local configuration."
          onRetry={() => location.reload()}
        />
      </div>,
    ),
  );
