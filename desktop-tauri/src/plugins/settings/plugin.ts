import {defineBuiltinMenuPlugin} from '../../plugin-sdk/manifest.ts';
export const plugin=defineBuiltinMenuPlugin({
  id:'nvideo.settings',
  menu:{
    route:'settings', title:'환경 설정', caption:'일반 · 기능별 설정',
    heading:'환경 설정', description:'NVideo Studio 및 포함된 기능의 표시·뷰어 설정을 관리합니다.',
    icon:'cog', order:70
  }
});
