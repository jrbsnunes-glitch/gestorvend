/** Ícones SVG inline do menu lateral — sem dependência externa. */

import type { ReactNode } from 'react';

export type NavIconName =
  | 'home'
  | 'sales'
  | 'customers'
  | 'products'
  | 'suppliers'
  | 'stock'
  | 'requisitions'
  | 'serviceOrders'
  | 'cash'
  | 'cards'
  | 'fiscal'
  | 'finance'
  | 'balance'
  | 'registers'
  | 'company'
  | 'users'
  | 'logs'
  | 'restaurant'
  | 'menu'
  | 'close'
  | 'collapse'
  | 'expand'
  | 'logout'
  | 'search'
  | 'chevron-down'
  | 'user'
  | 'settings'
  | 'plus'
  | 'eye'
  | 'eye-off'
  | 'building'
  | 'lock';

const SIZE = 20;

function Svg({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <svg
      className="nav-icon"
      width={SIZE}
      height={SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function NavIcon({ name, title }: { name: NavIconName; title?: string }) {
  switch (name) {
    case 'home':
      return (
        <Svg title={title}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </Svg>
      );
    case 'sales':
      return (
        <Svg title={title}>
          <circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="18" cy="20" r="1.5" fill="currentColor" stroke="none" />
          <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.5L21 8H7" />
        </Svg>
      );
    case 'customers':
      return (
        <Svg title={title}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 19c.8-3.2 3.2-5 6.5-5s5.7 1.8 6.5 5" />
          <circle cx="17.5" cy="9" r="2.5" />
          <path d="M16 14.2c2.1.3 3.8 1.5 4.5 3.8" />
        </Svg>
      );
    case 'products':
      return (
        <Svg title={title}>
          <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
          <path d="M12 12 4 7.5" />
          <path d="M12 12v9" />
          <path d="M12 12 20 7.5" />
        </Svg>
      );
    case 'suppliers':
      return (
        <Svg title={title}>
          <path d="M3 21h18" />
          <path d="M5 21V9l7-5 7 5v12" />
          <path d="M9 21v-6h6v6" />
        </Svg>
      );
    case 'stock':
      return (
        <Svg title={title}>
          <path d="M4 8h16v12H4z" />
          <path d="M8 8V6a4 4 0 0 1 8 0v2" />
          <path d="M4 13h16" />
        </Svg>
      );
    case 'requisitions':
      return (
        <Svg title={title}>
          <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
          <path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
          <path d="M8.5 12h7M8.5 16h4" />
        </Svg>
      );
    case 'serviceOrders':
      return (
        <Svg title={title}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </Svg>
      );
    case 'cash':
      return (
        <Svg title={title}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M7 12h.01M17 12h.01" />
        </Svg>
      );
    case 'cards':
      return (
        <Svg title={title}>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M2.5 10h19" />
          <path d="M7 15h4" />
        </Svg>
      );
    case 'fiscal':
      return (
        <Svg title={title}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </Svg>
      );
    case 'finance':
      return (
        <Svg title={title}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 16V10" />
          <path d="M12 16V7" />
          <path d="M16 16v-4" />
        </Svg>
      );
    case 'balance':
      return (
        <Svg title={title}>
          <path d="M12 3v18" />
          <path d="M5 8h14" />
          <path d="M7 8 4 14h6L7 8Z" />
          <path d="M17 8l-3 6h6l-3-6Z" />
        </Svg>
      );
    case 'registers':
      return (
        <Svg title={title}>
          <path d="M9 4h6v4H9z" />
          <path d="M5 8h14v12H5z" />
          <path d="M9 13h6M9 17h4" />
        </Svg>
      );
    case 'company':
      return (
        <Svg title={title}>
          <path d="M4 21V7l8-4 8 4v14" />
          <path d="M9 21v-6h6v6" />
          <path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
        </Svg>
      );
    case 'users':
      return (
        <Svg title={title}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5" />
        </Svg>
      );
    case 'logs':
      return (
        <Svg title={title}>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </Svg>
      );
    case 'restaurant':
      return (
        <Svg title={title}>
          <path d="M4 20h16" />
          <path d="M7 20V10a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v10" />
          <path d="M15 20V4h1a3 3 0 0 1 3 3v3h-4" />
        </Svg>
      );
    case 'menu':
      return (
        <Svg title={title}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </Svg>
      );
    case 'close':
      return (
        <Svg title={title}>
          <path d="M6 6l12 12M18 6 6 18" />
        </Svg>
      );
    case 'collapse':
      return (
        <Svg title={title}>
          <path d="M15 6 9 12l6 6" />
        </Svg>
      );
    case 'expand':
      return (
        <Svg title={title}>
          <path d="M9 6l6 6-6 6" />
        </Svg>
      );
    case 'logout':
      return (
        <Svg title={title}>
          <path d="M10 17v2a2 2 0 0 0 2 2h7V3h-7a2 2 0 0 0-2 2v2" />
          <path d="M4 12h11" />
          <path d="M12 8l4 4-4 4" />
        </Svg>
      );
    case 'search':
      return (
        <Svg title={title}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </Svg>
      );
    case 'chevron-down':
      return (
        <Svg title={title}>
          <path d="M6 9l6 6 6-6" />
        </Svg>
      );
    case 'user':
      return (
        <Svg title={title}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c1-3.5 3.8-5.5 7.5-5.5s6.5 2 7.5 5.5" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg title={title}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
        </Svg>
      );
    case 'plus':
      return (
        <Svg title={title}>
          <path d="M12 5v14M5 12h14" />
        </Svg>
      );
    case 'eye':
      return (
        <Svg title={title}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </Svg>
      );
    case 'eye-off':
      return (
        <Svg title={title}>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
          <path d="M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-3.1 3.9" />
          <path d="M6.1 6.1A17.5 17.5 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.2-.9" />
        </Svg>
      );
    case 'building':
      return (
        <Svg title={title}>
          <path d="M4 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14" />
          <path d="M2 20h20" />
          <path d="M9 8h2M9 12h2M9 16h2M14 8h2M14 12h2M14 16h2" />
        </Svg>
      );
    case 'lock':
      return (
        <Svg title={title}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </Svg>
      );
    default:
      return null;
  }
}
