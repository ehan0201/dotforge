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

  // 다이내믹 조명용 보조 텍스처(노멀맵 등)를 스프라이트에 연결.
  // Sprite-Lit-Default 셰이더가 _NormalMap을 자동으로 읽어 맵 조명에 반응한다.
  // opts.secondary: [{name:'_NormalMap', guid:'...'}]
  const secondary = (opts.secondary || []).filter(s => s && s.guid);
  const secondaryYaml = secondary.length
    ? secondary.map(s => `    - name: ${s.name}\n      texture: {fileID: 2800000, guid: ${s.guid}, type: 3}`).join('\n')
    : '';

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
    secondaryTextures:${secondary.length ? '\n' + secondaryYaml : ' []'}
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

// 노멀맵/에미션 등 "보조 텍스처" 전용 .meta (스프라이트 슬라이스 없이 단일 텍스처).
// 노멀맵은 색이 아니라 방향 데이터라 sRGB를 꺼야(linear) 유니티가 올바르게 해석한다.
// 픽셀아트 유지를 위해 filterMode=Point, 압축 없음.
function buildTextureMeta(opts) {
  const guid = opts.guid || randHex(32);
  const sRGB = opts.sRGB ? 1 : 0;
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 11
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: ${sRGB}
    linearTexture: ${sRGB ? 0 : 1}
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
  spriteMode: 0
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 0
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
  spritePackingTag:
  pSDRemoveMatte: 0
  pSDShowRemoveMatteOption: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

// 유니티 세팅 안내(한국어). 다이내믹 조명 내보내기와 함께 저장해 준다.
function buildSetupGuide(o) {
  o = o || {};
  const base = o.baseName || 'sprite';
  return `Dotforge → Unity 하이비트(다이내믹 조명) 세팅 안내
======================================================

내보낸 파일:
- ${base}_albedo.png (+ .meta)   : 색(스프라이트 시트, 슬라이스됨)
- ${base}_normal.png (+ .meta)   : 노멀맵(맵 조명 방향에 반응)  ← 자동 연결됨
- ${base}_emission.png (+ .meta) : 발광(네온) 부위 ${o.hasEmission ? '' : '(발광 레이어 없으면 비어있음)'}

■ 1. 프로젝트를 URP(Universal RP) + 2D로 설정
   - Package Manager에서 "Universal RP" 설치
   - Project Settings > Graphics 에 URP Asset 지정
   - URP Asset의 Renderer를 "2D Renderer"로 설정
     (없으면 Create > Rendering > URP > 2D Renderer 로 생성 후 지정)

■ 2. 위 3개 png + .meta 를 Assets 폴더에 "함께" 넣기
   - 세 파일을 같은 폴더에 넣으면 albedo 스프라이트가 normal을
     자동으로 물고 옵니다(.meta의 secondaryTextures로 연결됨).
   - 씬에 albedo 스프라이트를 배치하면 머티리얼이 자동으로
     Sprite-Lit-Default 여야 합니다. 아니면 SpriteRenderer의
     Material을 "Sprite-Lit-Default"로 바꾸세요.

■ 3. 조명 추가 (여기서 "빛 감지"가 실제로 작동)
   - Hierarchy > 2D Object > Light 2D > (Freeform/Point/Global) 추가
   - Global Light 2D 하나(전체 밝기) + Point/Spot Light 2D 몇 개(램프 느낌)
   - 라이트를 캐릭터 옆으로 옮기면 노멀맵을 따라 명암이 실시간으로 변합니다.

■ 4. 네온 발광(Bloom) — ${base}_emission.png 사용
   URP 2D에는 발광 전용 슬롯이 없어, 발광은 "밝게 그린 뒤 Bloom"으로 냅니다.
   a) 캐릭터의 자식으로 SpriteRenderer를 하나 더 만들고 스프라이트를
      ${base}_emission 로 지정 (같은 위치/정렬, Sorting을 살짝 앞으로).
   b) 그 자식의 Material을 "Sprite-Unlit-Default"로 (조명 영향 X, 항상 밝게).
   c) Volume(전역) 추가 > Override > Post-processing > Bloom 켜기
      Threshold 낮추고 Intensity 올리면 발광 부위가 번져 네온이 됩니다.
   d) HDR: URP Asset에서 HDR 체크(블룸 품질↑).

팁) 노멀맵이 반대로 눌린 것처럼 보이면 Dotforge 노멀맵 패널의
    "Y 뒤집기"를 토글해 다시 내보내세요(엔진/버전별 관례 차이).
`;
}

DF.GameExport = { buildUnityMeta, buildTextureMeta, buildSetupGuide, frameRects, randHex };

})(window.DF);
