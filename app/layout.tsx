import type { Metadata, Viewport } from 'next';
import './globals.css';
import './orange-interactions.css';
import {MatrixProvider} from './matrix-background';
import {PwaProvider} from './pwa';
export const metadata: Metadata = { title: 'ANONIMOUS_OH Analytics V2', description: 'Dashboard profissional de métricas e engajamento para criadores.', applicationName:'OH Analytics', appleWebApp:{capable:true,title:'OH Analytics',statusBarStyle:'default'}, icons:{icon:'/pwa/icon-192.png',apple:'/pwa/apple-touch-icon.png'} };
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#111111'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body><PwaProvider><MatrixProvider>{children}</MatrixProvider></PwaProvider></body></html>}
