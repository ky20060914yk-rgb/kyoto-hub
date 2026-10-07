import type { Metadata } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

const noto = Noto_Sans_JP({ variable: '--font-noto', weight: ['400', '500', '700'], subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: '京大InfoHub — 京大生のための授業レビュー・過去問', template: '%s | 京大InfoHub' },
  description: '京大生だけの授業レビュー、楽単ランキング、過去問・資料、教科書の売買。履修と試験の判断を、先輩の情報で。',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ja" className={`${noto.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
