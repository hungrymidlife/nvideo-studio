import {invoke} from '@tauri-apps/api/core';
import {googleAuth} from './googleAuth';

export type AccountIdentity=Readonly<{
 signedIn:boolean;email:string|null;name:string|null;userId:string|null;
 plan:'guest'|'free'|'supporter';server:'neon-managed-auth';provider?:'native'|'google';
 pendingVerification?:boolean;message?:string;
}>;
export const emptyIdentity:AccountIdentity={
 signedIn:false,email:null,name:null,userId:null,plan:'guest',server:'neon-managed-auth'
};

export const accountService={
 async status():Promise<AccountIdentity>{
  const native=await invoke<AccountIdentity>('account_status');
  if(native.signedIn)return {...native,provider:'native'};
  // If Google OAuth navigated back to the Tauri app, restore its Neon session.
  try{return await googleAuth.currentUser()||native;}
  catch{return native;}
 },
 googleLogin:(signal?:AbortSignal):Promise<AccountIdentity|null>=>googleAuth.signIn(signal),
 async logout(provider?:'native'|'google'):Promise<AccountIdentity>{
  // A Google session must be signed out through the Neon SDK, not only Rust.
  if(provider==='google')await googleAuth.signOut();
  return invoke<AccountIdentity>('account_sign_out');
 }
};
