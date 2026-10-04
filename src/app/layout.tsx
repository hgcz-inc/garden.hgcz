import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'GardenCare · Vườn của tôi', description: 'Ghi nhận chăm cây theo buổi và lập lịch tưới hằng tuần.', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, statusBarStyle: 'default', title: 'GardenCare' }, icons: { icon: '/icon.svg', apple: '/icon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#224e3c' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="vi"><body>{children}</body></html>; }
