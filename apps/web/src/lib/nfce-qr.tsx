import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const QR_PX = 168;

export function formatNfceAccessKey(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/(.{4})/g, '$1 ').trim();
}

export async function buildNfceQrDataUrl(url: string, sizePx = QR_PX): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: sizePx,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch {
    return null;
  }
}

export function useNfceQrDataUrl(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const value = url?.trim() ?? '';
    if (!value) {
      setSrc(null);
      return;
    }
    let alive = true;
    void buildNfceQrDataUrl(value).then((data) => {
      if (alive) setSrc(data);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}

export function NfceQrImage({ src, sizePx = QR_PX }: { src: string; sizePx?: number }) {
  return (
    <img className="nfce-qr" src={src} alt="QR Code da NFC-e" width={sizePx} height={sizePx} />
  );
}
