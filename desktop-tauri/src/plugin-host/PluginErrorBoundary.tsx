import {Component,Fragment} from 'react';
import type {ErrorInfo,ReactNode} from 'react';

declare const __NVIDEO_DEVELOPER_TOOLS__:boolean;

type Props={pluginId:string;children:ReactNode;onOpenManager?:()=>void};
type State={message:string|null;revision:number};
/** React view crash containment; headless native jobs are not restarted/stopped. */
export default class PluginErrorBoundary extends Component<Props,State>{
 state:State={message:null,revision:0};
 static getDerivedStateFromError(error:Error):Partial<State>{
   return {message:error.message||'플러그인 렌더링 오류'};
 }
 componentDidCatch(error:Error,info:ErrorInfo){
   console.error('[Plugin crash]',this.props.pluginId,error,info.componentStack);
 }
 private retry=()=>{
   this.setState(old=>({message:null,revision:old.revision+1}));
 };
 render(){
   if(this.state.message!==null)return <section className="panel" role="alert" style={{padding:20}}>
     <h2>플러그인 화면 오류</h2>
     <p>{this.props.pluginId} 화면에 오류가 발생했습니다. 다른 메뉴와 Rust 백그라운드 서비스는 유지됩니다.</p>
     <p className="minor-note" style={{overflowWrap:'anywhere'}}>{this.state.message}</p>
     <div className="input-line">
       <button className="primary-button" type="button" onClick={this.retry}>화면 다시 시도</button>
       {__NVIDEO_DEVELOPER_TOOLS__&&this.props.onOpenManager&&<button className="secondary-button" type="button"
         onClick={this.props.onOpenManager}>플러그인 관리</button>}
     </div>
   </section>;
   return <Fragment key={this.state.revision}>{this.props.children}</Fragment>;
 }
}
