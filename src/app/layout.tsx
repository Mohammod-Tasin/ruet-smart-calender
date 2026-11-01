import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RUET Holiday Calendar',
  description: 'Which departments and series are off, month by month.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there is no flash. Default: light. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100"
      >
        {children}
      </body>
    </html>
  );
}
