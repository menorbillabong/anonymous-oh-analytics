import type { Metadata } from 'next';
import './globals.css';
import './orange-interactions.css';
import AutoRefreshController from './auto-refresh-controller';
export const metadata: Metadata = { title: 'ANONIMOUS_OH Analytics V2', description: 'Dashboard profissional de métricas e engajamento para criadores.' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}<AutoRefreshController/></body></html>}
