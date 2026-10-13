import { securityHeaders } from './security-headers.mjs';

// Match the URL path only. Keep document and Worker CSP mutually exclusive.
const workerPath = 'assets/security\\.worker-[\\w-]+\\.js';
export function vercelConfig(staticBuild = false) {
  const headers = worker => ({ ...securityHeaders(worker), 'Strict-Transport-Security': 'max-age=31536000' });
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: staticBuild ? null : 'vite',
    buildCommand: staticBuild ? '' : 'npm run build',
    installCommand: staticBuild ? '' : 'npm ci',
    outputDirectory: staticBuild ? '.' : 'dist',
    routes: [
      { src: `/${workerPath}$`, headers: headers(true), continue: true },
      { src: `/(?!${workerPath}$).*`, headers: headers(false), continue: true },
      { src: '/.*', methods: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'], status: 405 },
      { handle: 'filesystem' },
      { src: '/.*', status: 404 },
    ],
  };
}
