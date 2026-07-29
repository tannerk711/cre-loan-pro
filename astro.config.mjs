import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  // checkOrigin misfires behind Vercel's proxy and 403s the form's own
  // multipart submits. Safe to disable: /api/onboard is unauthenticated and
  // cookie-free, so cross-site POSTs gain nothing; the honeypot handles bots.
  security: { checkOrigin: false },
  adapter: vercel(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
