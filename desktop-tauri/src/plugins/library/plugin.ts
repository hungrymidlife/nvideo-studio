import {defineBuiltinMenuPlugin} from '../../plugin-sdk/manifest.ts';
export const plugin=defineBuiltinMenuPlugin({
  id:'nvideo.library',
  lifecycle:{mount:'retain-after-first-visit',native:'host-owned'},
  menu:{
    route:'library', title:'로컬 책장', caption:'작가 · 작품',
    heading:'로컬 책장', description:'로컬 작품·작가 관리 및 만화·전자책·영상 열람',
    icon:'book-open', order:30
  }
});
