import type {ReactNode} from 'react';
export function SettingsPanel({title,children}:{title:string;children:ReactNode}){
 return <section className="panel settings-detail-panel"><div className="panel-head"><h2>{title}</h2></div>
  <div className="settings-detail-fields">{children}</div></section>;
}
export function SettingsField({label,children,hint}:{label:string;children:ReactNode;hint?:string}){
 return <div className="settings-detail-field"><label className="field-label">{label}</label>
   {children}{hint&&<p className="minor-note">{hint}</p>}</div>;
}
