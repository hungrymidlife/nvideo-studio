import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isFolderEntry,isVideoEntry,showInVideoDock,
 readerDockSamePath,readerDockSourceFolder} from './readerDockCompact.ts';

test('indexed folder cards are navigated inside the libmpv dock',()=>{
 for(const kind of ['folder','directory','dir']){
  assert.equal(isFolderEntry(kind,'C:\\library\\author'),true);
  assert.equal(showInVideoDock(kind,'C:\\library\\author'),true);
 }
 assert.equal(isFolderEntry(undefined,'C:\\library\\author\\'),true);
 assert.equal(isFolderEntry('video','C:\\library\\movie.mp4'),false);
});
test('compact nested browsing displays only video files and subfolders',()=>{
 assert.equal(showInVideoDock('video','C:\\movie\\clip.mp4'),true);
 assert.equal(showInVideoDock('file','C:\\movie\\clip.MKV'),true);
 assert.equal(isVideoEntry(undefined,'C:\\movie\\clip.webm'),true);
 assert.equal(showInVideoDock('archive','C:\\movie\\comic.cbz'),false);
 assert.equal(showInVideoDock('pdf','C:\\movie\\doc.pdf'),false);
 assert.equal(showInVideoDock('image','C:\\movie\\cover.jpg'),false);
 assert.equal(showInVideoDock('text','C:\\movie\\notes.txt'),false);
});

test('playing file parent folder remains the navigation scope after remount',()=>{
 assert.equal(readerDockSourceFolder('C:\\Library\\A\\a\\B.mkv'),'C:\\Library\\A\\a');
 assert.equal(readerDockSourceFolder('/Library/A/a/B.mp4'),'/Library/A/a');
 assert.equal(readerDockSourceFolder('D:\\Video\\episode.mp4'),'D:\\Video');
});
test('Windows paths match despite case differences or extended length syntax',()=>{
 assert.equal(readerDockSamePath('C:\\Library\\A\\a\\B.MKV','c:/library/a/A/../a/B.mkv'),false);
 assert.equal(readerDockSamePath('C:\\Library\\A\\a\\B.MKV','c:/library/a/a/b.mkv'),true);
 assert.equal(readerDockSamePath('\\\\?\\C:\\Library\\A\\B.mkv','c:/library/a/b.MKV'),true);
 assert.equal(readerDockSamePath('C:\\Library\\B.mkv','C:\\Library\\C.mkv'),false);
});
