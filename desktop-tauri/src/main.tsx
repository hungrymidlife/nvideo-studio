import { Component, StrictMode, useEffect, type ErrorInfo, type ReactNode } from 'react';
import {invoke} from '@tauri-apps/api/core';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

// Persist minimal boot milestones and uncaught failures to the Rust-side
// %TEMP%/nvideo-studio-ui.log. A WebView2 renderer crash can leave only
// the window background; the React error boundary cannot paint in that case.
function reportUi(kind:string,detail:string):void{
  void invoke('desktop_ui_diagnostic',{kind,detail}).catch(()=>{});
}
reportUi('module_loaded',location.protocol+'//'+location.host);
window.addEventListener('error',event=>{
  reportUi('js_error',String(event.message||'unknown')+
    ' '+String(event.filename||'')+':'+String(event.lineno||0));
});
window.addEventListener('unhandledrejection',event=>{
  const error=event.reason;
  reportUi('unhandled_rejection',error instanceof Error?
    (error.stack||error.message):String(error));
});
function StartupReporter(){
  useEffect(()=>{reportUi('react_mounted','main React tree committed');},[]);
  return null;
}

// Keep an actionable error on screen if a React component fails during startup.
class StartupErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[NVideo Studio] React render failed', error, info);
    reportUi('react_render_failed',String(error)+' '+(info.componentStack||''));
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <main style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center', padding: 32,
          color: '#e8f1ff', background: '#0b1422', textAlign: 'center',
        }}>
          <h1>NVideo Studio 화면을 표시할 수 없습니다</h1>
          <p style={{ maxWidth: 760, lineHeight: 1.7 }}>
            React 화면에서 오류가 발생했습니다. 아래 오류 내용을 확인해 주세요.
          </p>
          <pre style={{
            maxWidth: 'min(900px, 95vw)', whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere', background: '#1a2a3d',
            color: '#f9c2c2', padding: 20, borderRadius: 12,
          }}>{this.state.error}</pre>
          <button style={{
            marginTop: 18, background: '#2189d4', color: 'white',
            border: 0, borderRadius: 8, padding: '11px 22px',
            cursor: 'pointer',
          }} onClick={() => window.location.reload()}>다시 불러오기</button>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root){
  reportUi('root_missing','Missing #root element in index.html');
  throw new Error('Missing #root element in index.html');
}
createRoot(root).render(
  <StrictMode>
    <StartupErrorBoundary>
      <StartupReporter />
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
);
