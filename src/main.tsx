import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles/app.css';

const theme = (() => { try { return localStorage.getItem('dsq-theme'); } catch { return null; } })();
document.documentElement.dataset.theme = theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: (n, e: any) => n < 2 && e?.status !== 403 && e?.status !== 404, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={qc}><App /></QueryClientProvider></React.StrictMode>);
