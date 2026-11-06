import {useMemo} from 'react';
import {readerPresentation} from '../model/readerPresentationModel';
import type {ReaderPresentationInput} from '../model/readerPresentationModel';
/**
 * Derived presentation state is recalculated when a page finishes decoding.
 * Reader commands, key handling and mutation confirmation remain core-owned.
 */
export function useReaderPresentationViewModel(input:ReaderPresentationInput & {readyVersion:number}){
 return useMemo(()=>readerPresentation(input),[
  input.total,input.index,input.displayIndex,input.displayDouble,input.webtoon,
  input.rtl,input.webtoonCount,input.webtoonStart,input.viewport.width,input.viewport.height,
  input.dimensions,input.noMargin,input.fit,input.fixedWidth,input.viewZoom,
  input.readyVersion
 ]);
}
