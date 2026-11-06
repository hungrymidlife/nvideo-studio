// The published source does not embed the maintainer's Neon endpoint.
// A self-hosted/official build allows only the configured Auth HTTPS origin in WebView2.
const PLACEHOLDER_ORIGIN='https://auth.example.invalid';
const FALLBACK_AUTH_URL=PLACEHOLDER_ORIGIN+'/neondb/auth';

export function authCspOverride(config,authURL){
 const baseline=config?.app?.security?.csp;
 if(typeof baseline!=='string'||!baseline.trim())
  throw new Error('Tauri CSP is missing; refusing to disable WebView security');
 const value=authURL?.trim()||FALLBACK_AUTH_URL;
 let url;
 try{url=new URL(value)}catch{throw new Error('NVIDEO_AUTH_URL must be a valid HTTPS URL')}
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password)
  throw new Error('NVIDEO_AUTH_URL must be a credential-free HTTPS URL');
 const origin=url.origin;
 const policies=baseline.split(';').map(value=>value.trim()).filter(Boolean);
 for(const directive of ['connect-src','frame-src']){
  const index=policies.findIndex(policy=>policy.split(/\\s+/)[0]===directive);
  if(index<0)throw new Error('Missing required Tauri CSP directive: '+directive);
  // Replace only the checked-in placeholder; keep every other CSP directive intact.
  const tokens=policies[index].split(/\\s+/).filter(token=>token!==PLACEHOLDER_ORIGIN);
  if(!tokens.includes(origin))tokens.push(origin);
  policies[index]=tokens.join(' ');
 }
 return {app:{security:{csp:policies.join('; ')}}};
}
