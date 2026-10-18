import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import Shell from '@/components/Shell'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif' })

export const metadata: Metadata = {
  title: 'Nat OS',
  description: 'Personal AI OS',
  appleWebApp: { capable: true, title: 'Nat OS', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  themeColor: '#050707',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
