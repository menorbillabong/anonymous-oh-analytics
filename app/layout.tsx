import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ANONIMOUS_OH Analytics V2', description: 'Dashboard profissional de métricas e engajamento para criadores.' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
