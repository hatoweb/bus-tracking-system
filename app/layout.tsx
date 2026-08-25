import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { getBasePath } from '@/lib/base-path'
import { AuthProvider } from '@/components/auth-provider'
import './globals.css'

const icon = (path: string) => `${getBasePath()}${path}`

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'GeoBus · Seguimiento de buses en tiempo real',
  description:
    'Geolocalización de buses en tiempo real con programación operativa, itinerarios, paradas y anuncios por voz para personas con discapacidad visual.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: icon('/favicon-32x32.png'),
        sizes: '32x32',
        type: 'image/png',
      },
    ],
    shortcut: icon('/favicon-32x32.png'),
    apple: icon('/apple-icon.png'),
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2fb' },
    { media: '(prefers-color-scheme: dark)', color: '#12151f' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`bg-background ${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
