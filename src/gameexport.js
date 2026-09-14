/* =====================================================================
   Dotforge — gameexport.js
   유니티(Unity) 전용 내보내기: 스프라이트 시트 PNG + .meta(YAML) 생성.
   .meta는 SpriteMode=Multiple로 각 프레임을 칸별 스프라이트로 자동 슬라이스하고,
   픽셀아트용으로 filterMode=Point, 압축 없음, alphaIsTransparency로 설정한다.

   Unity 2020~2022 LTS 기준 TextureImporter 포맷. 버전이 많이 다르면 슬라이스가
   어긋날 수 있으므로, 그럴 땐 Sprite Editor > Slice > Grid By Cell Size(칸 크기 제공)로 폴백.

   노출: DF.GameExport (순수 함수 — 시트 캔버스는 호출측에서 만들어 넘김).
   ===================================================================== */
window.DF = window.DF || {};
(function (DF) {
'use strict';

function randHex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function randInt() { return Math.floor(Math.random() * 2000000000) + 1; }

// 프레임 인덱스 → 시트 칸 사각형(Unity 좌표: 원점 좌하단)
function frameRects(o) {
  const { frameCount, cols, cellW, cellH, sheetH, baseName, pivotX, pivotY, alignment } = o;
  const rects = [];
  for (let i = 0; i < frameCount; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = c * cellW;
    const y = sheetH - (r + 1) * cellH;   // top→bottom 배치를 bottom-left 원점으로 변환
    rects.push({
      name: baseName + '_' + i, x, y, width: cellW, height: cellH,
      spriteID: randHex(32), internalID: randInt(), pivotX, pivotY, alignment,
    });
  }
  return rects;
}

// 유니티 .meta(YAML) 문자열 생성
function buildUnityMeta(opts) {
  const cols = Math.max(1, opts.cols || opts.frameCount);
  const cellW = opts.cellW, cellH = opts.cellH;
  const rows = Math.ceil(opts.frameCount / cols);
  const sheetH = opts.sheetH || rows * cellH;
  const ppu = opts.ppu || 100;
  const pivotX = (opts.pivotX != null) ? opts.pivotX : 0.5;
  const pivotY = (opts.pivotY != null) ? opts.pivotY : 0.5;
  const alignment = (opts.alignment != null) ? opts.alignment : 9;   // 9 = Custom pivot
  const guid = opts.guid || randHex(32);
  const baseName = (opts.baseName || 'sprite').replace(/[^0-9A-Za-z_\-]/g, '_');

  const rects = frameRects({ frameCount: opts.frameCount, cols, cellW, cellH, sheetH, baseName, pivotX, pivotY, alignment });

  const spriteBlocks = rects.map(s =>
`    - serializedVersion: 2
      name: ${s.name}
      rect:
        serializedVersion: 2
        x: ${s.x}
        y: ${s.y}
        width: ${s.width}
        height: ${s.height}
      alignment: ${s.alignment}
      pivot: {x: ${s.pivotX}, y: ${s.pivotY}}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline: []
      physicsShape: []
      tessellationDetail: 0
      bones: []
      spriteID: ${s.spriteID}
      internalID: ${s.internalID}
      vertices: []
      indices:
      edges: []
      weights: []`).join('\n');

  const idNameTable = rects.map(s =>
`  - first:
      213: ${s.internalID}
    second: ${s.name}`).join('\n');

  const nameFileIdTable = rects.map(s => `      ${s.name}: ${s.internalID}`).join('\n');

  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable:
${idNameTable}
  externalObjects: {}
  serializedVersion: 11
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: ${alignment}
  spritePivot: {x: ${pivotX}, y: ${pivotY}}
  spritePixelsToUnits: ${ppu}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 8
  textureShape: 1
  singleChannelComponent: 0
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  applyGammaDecoding: 0
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites:
${spriteBlocks}
    outline: []
    physicsShape: []
    bones: []
    spriteID:
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    nameFileIdTable:
${nameFileIdTable}
  spritePackingTag:
  pSDRemoveMatte: 0
  pSDShowRemoveMatteOption: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

DF.GameExport = { buildUnityMeta, frameRects, randHex };

})(window.DF);
