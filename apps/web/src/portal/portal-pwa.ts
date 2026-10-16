const MANIFEST_HREF = '/portal.webmanifest';

/** Liga o portal como aplicativo instalável (PWA), sem afetar o GestorVend principal. */
export function enablePortalPwa(): () => void {
  const previousTitle = document.title;
  document.title = 'GestorVend Licenças';

  let manifest = document.querySelector<HTMLLinkElement>(`link[rel="manifest"][href="${MANIFEST_HREF}"]`);
  let createdManifest = false;
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = MANIFEST_HREF;
    document.head.appendChild(manifest);
    createdManifest = true;
  }

  let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  let createdTheme = false;
  const previousTheme = theme?.content ?? null;
  if (!theme) {
    theme = document.createElement('meta');
    theme.name = 'theme-color';
    document.head.appendChild(theme);
    createdTheme = true;
  }
  theme.content = '#142159';

  let appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  let createdAppleTitle = false;
  if (!appleTitle) {
    appleTitle = document.createElement('meta');
    appleTitle.name = 'apple-mobile-web-app-title';
    document.head.appendChild(appleTitle);
    createdAppleTitle = true;
  }
  appleTitle.content = 'Licenças';

  const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  const previousAppleIcon = appleIcon?.getAttribute('href') ?? null;
  appleIcon?.setAttribute('href', '/portal-icon-192.png');

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/portal-sw.js', { scope: '/portal-admin/' }).catch(() => {
      /* instalação continua possível na próxima visita se o worker falhar agora */
    });
  }

  return () => {
    document.title = previousTitle;
    if (createdManifest) manifest?.remove();
    if (createdTheme) theme?.remove();
    else if (theme && previousTheme != null) theme.content = previousTheme;
    if (createdAppleTitle) appleTitle?.remove();
    if (appleIcon && previousAppleIcon) appleIcon.setAttribute('href', previousAppleIcon);
  };
}
