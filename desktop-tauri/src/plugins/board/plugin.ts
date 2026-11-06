import {defineBuiltinMenuPlugin} from '../../plugin-sdk/manifest.ts';
/** Core-owned public community: always bundled with Settings in every Studio edition. */
export const plugin=defineBuiltinMenuPlugin({
 id:'nvideo.board',
 menu:{
  route:'board',title:'게시판',caption:'사용자 피드백 · 제안',
  heading:'커뮤니티 게시판',description:'NVideo Studio에 대한 의견과 개선 제안을 공유해 주세요.',
  icon:'message-square',order:65
 }
});
