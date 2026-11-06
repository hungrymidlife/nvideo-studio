/**
 * Bookshelf fog appearance, independent from the ON/OFF preference.
 * 50% matches the previous implementation's maximum blur and haze,
 * while 100% returns to the strong initial mist treatment.
 */
export type LibraryFogVisuals={
  blurPx:number;
  washOpacity:number;
  cloudOpacity:number;
};

export function libraryFogVisuals(rawStrength:number):LibraryFogVisuals{
  const strength=Number.isFinite(rawStrength)
    ?Math.max(0,Math.min(100,rawStrength)):35;
  const upper=Math.max(0,(strength-50)/50);
  const blurPx=strength<=50
    ?strength*.17
    :8.5+11.5*upper;
  const washOpacity=strength<=50
    ?strength*.0014
    :.07+.33*upper;
  return {
    blurPx:Number(blurPx.toFixed(2)),
    washOpacity:Number(washOpacity.toFixed(3)),
    cloudOpacity:Number((strength/100).toFixed(3))
  };
}
