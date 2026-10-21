import { BLEND_MODES } from '../types';
import type { BlendMode } from '../types';

export interface PsdLayerData {
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  left: number;
  top: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PsdDocumentData {
  width: number;
  height: number;
  layers: PsdLayerData[];
  compositeRgba?: Uint8ClampedArray;
}

const MAX_PIXELS = 32_000_000;
const MAX_PROJECT_PIXELS = 128_000_000;
const MAX_LAYER_OFFSET = 16384;

const BLEND_TO_PSD: Record<BlendMode, string> = {
  'normal': 'norm',
  'multiply': 'mul ',
  'screen': 'scrn',
  'overlay': 'over',
  'darken': 'dark',
  'lighten': 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
  'hard-light': 'hLit',
  'soft-light': 'sLit',
  'difference': 'diff',
  'exclusion': 'smud',
};

const PSD_TO_BLEND: Record<string, BlendMode> = {
  'norm': 'normal',
  'pass': 'normal',
  'mul ': 'multiply',
  'scrn': 'screen',
  'over': 'overlay',
  'dark': 'darken',
  'lite': 'lighten',
  'div ': 'color-dodge',
  'idiv': 'color-burn',
  'hLit': 'hard-light',
  'sLit': 'soft-light',
  'diff': 'difference',
  'smud': 'exclusion',
};

export function validBlendMode(value: unknown): value is BlendMode {
  return value === undefined || (typeof value === 'string' && (BLEND_MODES as readonly string[]).includes(value));
}

export function canvasBlendOperation(mode?: BlendMode): GlobalCompositeOperation {
  return !mode || mode === 'normal' ? 'source-over' : mode;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i) & 0xff;
}

function readAscii(source: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(source[offset + i]);
  return out;
}

export function decodeRleChannel(bytes: Uint8Array, start: number, rowCount: number, colCount: number): Uint8Array {
  const out = new Uint8Array(rowCount * colCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = start + rowCount * 2;
  if (pos > bytes.byteLength) throw new Error('PSDの圧縮データが破損しています');
  for (let row = 0; row < rowCount; row++) {
    const rowByteLen = view.getUint16(start + row * 2);
    const rowEnd = pos + rowByteLen;
    if (rowEnd > bytes.byteLength) throw new Error('PSDの圧縮データが破損しています');
    let dst = row * colCount;
    const dstEnd = dst + colCount;
    while (pos < rowEnd && dst < dstEnd) {
      const header = bytes[pos++];
      const n = header < 128 ? header : header - 256;
      if (n >= 0) {
        const count = n + 1;
        if (pos + count > rowEnd || dst + count > dstEnd) throw new Error('PSDの展開サイズが一致しません');
        out.set(bytes.subarray(pos, pos + count), dst);
        pos += count;
        dst += count;
      } else if (n !== -128) {
        const count = 1 - n;
        if (pos >= rowEnd || dst + count > dstEnd) throw new Error('PSDの展開サイズが一致しません');
        const val = bytes[pos++];
        out.fill(val, dst, dst + count);
        dst += count;
      }
    }
    pos = rowEnd;
  }
  return out;
}

export function encodePsdBinary(doc: PsdDocumentData): Uint8Array {
  const { width, height, layers } = doc;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
    throw new Error('画像は各辺16,384px・3,200万画素以内にしてください');
  }
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 40 || width * height * layers.length > MAX_PROJECT_PIXELS) {
    throw new Error('プロジェクトの形式またはサイズが不正です');
  }

  const encoder = new TextEncoder();
  const layerMeta = layers.map(layer => {
    const nameText = (layer.name || 'Layer').slice(0, 150);
    const utf8 = encoder.encode(nameText).slice(0, 255);
    const pascalPad = (4 - ((1 + utf8.length) % 4)) % 4;
    const pascalLen = 1 + utf8.length + pascalPad;
    const luniRawLen = 4 + nameText.length * 2;
    const luniDataLen = (luniRawLen + 3) & ~3;
    const luniTotalLen = 12 + luniDataLen;
    const extraLen = 4 + 4 + pascalLen + luniTotalLen;
    const recordLen = 16 + 2 + 4 * 6 + 4 + 4 + 4 + 4 + extraLen;
    const pixelCount = layer.width * layer.height;
    if (layer.rgba.length !== pixelCount * 4) throw new Error('レイヤー画素データの長さが不正です');
    const channelDataLen = 2 + pixelCount;
    return { layer, nameText, utf8, pascalLen, luniDataLen, extraLen, recordLen, pixelCount, channelDataLen };
  });

  const recordsSize = layerMeta.reduce((sum, m) => sum + m.recordLen, 0);
  const channelsSize = layerMeta.reduce((sum, m) => sum + m.channelDataLen * 4, 0);
  const rawLayerInfoLen = 2 + recordsSize + channelsSize;
  const layerInfoPad = rawLayerInfoLen % 2;
  const layerInfoLen = rawLayerInfoLen + layerInfoPad;
  const sectionLen = 4 + layerInfoLen + 4; // layerInfoLen field (4) + layerInfo + globalLayerMaskInfo (4)
  const docPixels = width * height;
  const imageDataSize = 2 + docPixels * 4;
  const totalSize = 26 + 4 + 4 + 4 + sectionLen + imageDataSize;

  const buffer = new ArrayBuffer(totalSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let pos = 0;

  // 1. File Header (26 bytes)
  writeAscii(bytes, pos, '8BPS'); pos += 4;
  view.setUint16(pos, 1); pos += 2; // version 1
  pos += 6; // reserved
  view.setUint16(pos, 4); pos += 2; // 4 channels (RGBA)
  view.setUint32(pos, height); pos += 4;
  view.setUint32(pos, width); pos += 4;
  view.setUint16(pos, 8); pos += 2; // 8 bits per channel
  view.setUint16(pos, 3); pos += 2; // RGB color mode

  // 2. Color Mode Data (4 bytes)
  view.setUint32(pos, 0); pos += 4;

  // 3. Image Resources (4 bytes)
  view.setUint32(pos, 0); pos += 4;

  // 4. Layer and Mask Information
  view.setUint32(pos, sectionLen); pos += 4;
  view.setUint32(pos, layerInfoLen); pos += 4;
  view.setInt16(pos, layers.length); pos += 2;

  for (const m of layerMeta) {
    const { layer, nameText, utf8, pascalLen, luniDataLen, extraLen, channelDataLen } = m;
    const top = Math.round(layer.top);
    const left = Math.round(layer.left);
    view.setInt32(pos, top); pos += 4;
    view.setInt32(pos, left); pos += 4;
    view.setInt32(pos, top + layer.height); pos += 4;
    view.setInt32(pos, left + layer.width); pos += 4;
    view.setUint16(pos, 4); pos += 2; // 4 channels
    for (const chId of [0, 1, 2, -1]) {
      view.setInt16(pos, chId); pos += 2;
      view.setUint32(pos, channelDataLen); pos += 4;
    }
    writeAscii(bytes, pos, '8BIM'); pos += 4;
    writeAscii(bytes, pos, BLEND_TO_PSD[layer.blendMode] ?? 'norm'); pos += 4;
    bytes[pos++] = Math.max(0, Math.min(255, Math.round(layer.opacity * 255)));
    bytes[pos++] = 0; // clipping
    bytes[pos++] = layer.visible ? 0 : 2; // bit 1 = invisible
    bytes[pos++] = 0; // filler
    view.setUint32(pos, extraLen); pos += 4;
    view.setUint32(pos, 0); pos += 4; // mask data length
    view.setUint32(pos, 0); pos += 4; // blending ranges length

    // Pascal string
    bytes[pos] = utf8.length;
    bytes.set(utf8, pos + 1);
    pos += pascalLen;

    // Additional Layer Info: Unicode layer name ('luni')
    writeAscii(bytes, pos, '8BIM'); pos += 4;
    writeAscii(bytes, pos, 'luni'); pos += 4;
    view.setUint32(pos, luniDataLen); pos += 4;
    view.setUint32(pos, nameText.length);
    for (let i = 0; i < nameText.length; i++) {
      view.setUint16(pos + 4 + i * 2, nameText.charCodeAt(i));
    }
    pos += luniDataLen;
  }

  // Channel Image Data for each layer
  for (const m of layerMeta) {
    const { layer, pixelCount } = m;
    const rgba = layer.rgba;
    for (const chOffset of [0, 1, 2, 3]) {
      view.setUint16(pos, 0); pos += 2; // compression = 0 (Raw)
      for (let i = 0; i < pixelCount; i++) {
        bytes[pos + i] = rgba[i * 4 + chOffset];
      }
      pos += pixelCount;
    }
  }

  pos += layerInfoPad;
  view.setUint32(pos, 0); pos += 4; // Global Layer Mask Info length = 0

  // 5. Image Data Section (Composite RGBA)
  const composite = doc.compositeRgba && doc.compositeRgba.length === docPixels * 4
    ? doc.compositeRgba
    : new Uint8ClampedArray(docPixels * 4);
  view.setUint16(pos, 0); pos += 2; // compression = 0 (Raw)
  for (const chOffset of [0, 1, 2, 3]) {
    for (let i = 0; i < docPixels; i++) {
      bytes[pos + i] = composite[i * 4 + chOffset];
    }
    pos += docPixels;
  }

  return bytes;
}

export function decodePsdBinary(input: ArrayBuffer | Uint8Array): PsdDocumentData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > 180_000_000) throw new Error('PSDファイルが大きすぎます');
  if (bytes.byteLength < 30) throw new Error('PSDファイルの形式が不正です');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (readAscii(bytes, 0, 4) !== '8BPS') throw new Error('PSDファイルの形式が不正です');
  const version = view.getUint16(4);
  if (version !== 1) throw new Error('標準PSD（バージョン1）を選んでください');
  const docChannels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  const depth = view.getUint16(22);
  const colorMode = view.getUint16(24);
  if (depth !== 8 || colorMode !== 3 || docChannels < 3 || docChannels > 56) {
    throw new Error('RGB・8bitのPSDファイルを選んでください');
  }
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
    throw new Error('画像は各辺16,384px・3,200万画素以内にしてください');
  }

  let pos = 26;
  const requireBytes = (count: number) => {
    if (count < 0 || pos + count > bytes.byteLength) throw new Error('PSDファイルが途中で切れています');
  };

  requireBytes(4);
  const colorModeLen = view.getUint32(pos); pos += 4;
  requireBytes(colorModeLen); pos += colorModeLen;

  requireBytes(4);
  const resourcesLen = view.getUint32(pos); pos += 4;
  requireBytes(resourcesLen); pos += resourcesLen;

  requireBytes(4);
  const layerMaskSectionLen = view.getUint32(pos); pos += 4;
  requireBytes(layerMaskSectionLen);
  const sectionEnd = pos + layerMaskSectionLen;

  const layers: PsdLayerData[] = [];
  if (layerMaskSectionLen >= 6) {
    const layerInfoLen = view.getUint32(pos); pos += 4;
    if (layerInfoLen > 0) {
      requireBytes(2);
      const rawCount = view.getInt16(pos); pos += 2;
      const recordCount = Math.abs(rawCount);
      if (recordCount > 120) throw new Error('PSDのレイヤー数は40件以内にしてください');

      type RawRecord = {
        name: string;
        visible: boolean;
        opacity: number;
        blendMode: BlendMode;
        top: number;
        left: number;
        bottom: number;
        right: number;
        channels: { id: number; length: number }[];
        isGroupDivider: boolean;
        mask?: { top: number; left: number; bottom: number; right: number; defaultColor: number; flags: number };
      };
      const records: RawRecord[] = [];
      const decoder = new TextDecoder('utf-8', { fatal: false });

      for (let i = 0; i < recordCount; i++) {
        requireBytes(18);
        const top = view.getInt32(pos); pos += 4;
        const left = view.getInt32(pos); pos += 4;
        const bottom = view.getInt32(pos); pos += 4;
        const right = view.getInt32(pos); pos += 4;
        const chCount = view.getUint16(pos); pos += 2;
        if (chCount < 1 || chCount > 56) throw new Error('PSDレイヤーのチャンネル数が不正です');
        requireBytes(chCount * 6 + 12);
        const channels: { id: number; length: number }[] = [];
        for (let c = 0; c < chCount; c++) {
          const id = view.getInt16(pos); pos += 2;
          const length = view.getUint32(pos); pos += 4;
          channels.push({ id, length });
        }
        const sig = readAscii(bytes, pos, 4); pos += 4;
        if (sig !== '8BIM') throw new Error('PSDレイヤーの形式が不正です');
        const blendKey = readAscii(bytes, pos, 4); pos += 4;
        const blendMode: BlendMode = PSD_TO_BLEND[blendKey] ?? 'normal';
        const opacityByte = bytes[pos++];
        pos++; // clipping
        const flags = bytes[pos++];
        pos++; // filler
        const extraLen = view.getUint32(pos); pos += 4;
        requireBytes(extraLen);
        const extraEnd = pos + extraLen;

        if (extraLen < 8) throw new Error('PSDレイヤーの拡張データが不正です');
        const maskLen = view.getUint32(pos); pos += 4;
        if (pos + maskLen > extraEnd) throw new Error('PSDレイヤーのマスクデータが不正です');
        let mask: RawRecord['mask'];
        if (maskLen >= 20) {
          let mTop = view.getInt32(pos);
          let mLeft = view.getInt32(pos + 4);
          let mBottom = view.getInt32(pos + 8);
          let mRight = view.getInt32(pos + 12);
          const defaultColor = bytes[pos + 16];
          const mFlags = bytes[pos + 17];
          if (mFlags & 1) {
            mTop += top; mBottom += top;
            mLeft += left; mRight += left;
          }
          mask = { top: mTop, left: mLeft, bottom: mBottom, right: mRight, defaultColor, flags: mFlags };
        }
        pos += maskLen;

        const rangesLen = view.getUint32(pos); pos += 4;
        if (pos + rangesLen > extraEnd) throw new Error('PSDレイヤーのブレンド範囲データが不正です');
        pos += rangesLen;

        if (pos >= extraEnd) throw new Error('PSDレイヤー名が読み取れません');
        const nameLen = bytes[pos];
        const pascalStep = (1 + nameLen + 3) & ~3;
        if (pos + 1 + nameLen > extraEnd) throw new Error('PSDレイヤー名が破損しています');
        let name = decoder.decode(bytes.subarray(pos + 1, pos + 1 + nameLen)).trim() || `レイヤー ${i + 1}`;
        pos = Math.min(extraEnd, pos + pascalStep);

        let isGroupDivider = false;
        while (pos + 12 <= extraEnd) {
          const addSig = readAscii(bytes, pos, 4);
          if (addSig !== '8BIM' && addSig !== '8B64') break;
          const addKey = readAscii(bytes, pos + 4, 4);
          const addLen = view.getUint32(pos + 8);
          pos += 12;
          if (pos + addLen > extraEnd) break;
          if (addKey === 'luni' && addLen >= 4) {
            const charCount = view.getUint32(pos);
            if (charCount > 0 && charCount <= 250 && pos + 4 + charCount * 2 <= extraEnd) {
              let uni = '';
              for (let u = 0; u < charCount; u++) {
                const code = view.getUint16(pos + 4 + u * 2);
                if (code !== 0) uni += String.fromCharCode(code);
              }
              if (uni.trim()) name = uni.trim();
            }
          } else if ((addKey === 'lsct' || addKey === 'lspf') && addKey === 'lsct' && addLen >= 4) {
            const dividerType = view.getUint32(pos);
            if (dividerType === 1 || dividerType === 2 || dividerType === 3) isGroupDivider = true;
          }
          const padded = (addLen + 1) & ~1;
          pos += padded;
          if (pos + 4 <= extraEnd && readAscii(bytes, pos, 4) !== '8BIM' && readAscii(bytes, pos, 4) !== '8B64' && pos + 2 <= extraEnd && (readAscii(bytes, pos + 2, 4) === '8BIM' || readAscii(bytes, pos + 2, 4) === '8B64')) {
            pos += 2;
          }
        }
        pos = extraEnd;

        records.push({
          name: name.slice(0, 150),
          visible: (flags & 2) === 0,
          opacity: Math.round((opacityByte / 255) * 100) / 100,
          blendMode,
          top,
          left,
          bottom,
          right,
          channels,
          isGroupDivider,
          mask,
        });
      }

      let totalPixels = 0;
      for (const rec of records) {
        const lw = rec.right - rec.left;
        const lh = rec.bottom - rec.top;
        if (lw < 0 || lh < 0 || lw > 16384 || lh > 16384 || lw * lh > MAX_PIXELS) {
          throw new Error('画像は各辺16,384px・3,200万画素以内にしてください');
        }
        if (Math.abs(rec.left) > MAX_LAYER_OFFSET || Math.abs(rec.top) > MAX_LAYER_OFFSET) {
          throw new Error('レイヤーの位置が範囲外です');
        }
        const pixelCount = lw * lh;
        if (!rec.isGroupDivider) {
          totalPixels += Math.max(pixelCount, width * height);
          if (totalPixels > MAX_PROJECT_PIXELS) {
            throw new Error('レイヤー画像の合計は1億2800万画素以内にしてください');
          }
        }

        const planes = new Map<number, Uint8Array>();
        const mw = rec.mask ? Math.max(0, rec.mask.right - rec.mask.left) : 0;
        const mh = rec.mask ? Math.max(0, rec.mask.bottom - rec.mask.top) : 0;
        if (mw > 16384 || mh > 16384 || mw * mh > MAX_PIXELS) {
          throw new Error('画像は各辺16,384px・3,200万画素以内にしてください');
        }
        for (const ch of rec.channels) {
          requireBytes(ch.length);
          const chEnd = pos + ch.length;
          const isColorOrAlpha = ch.id === 0 || ch.id === 1 || ch.id === 2 || ch.id === -1;
          const isUserMask = (ch.id === -2 || ch.id === -3) && rec.mask && (rec.mask.flags & 2) === 0;
          const cw = isUserMask ? mw : lw;
          const chHeight = isUserMask ? mh : lh;
          const chPixels = cw * chHeight;
          if (ch.length >= 2 && chPixels > 0 && (isColorOrAlpha || isUserMask)) {
            const compression = view.getUint16(pos);
            if (compression === 0) {
              if (ch.length < 2 + chPixels) throw new Error('PSDチャンネルデータが不足しています');
              planes.set(ch.id, bytes.subarray(pos + 2, pos + 2 + chPixels));
            } else if (compression === 1) {
              planes.set(ch.id, decodeRleChannel(bytes, pos + 2, chHeight, cw));
            } else {
              throw new Error('未対応のPSD圧縮方式（ZIP等）です。標準PSDで保存してください');
            }
          }
          pos = chEnd;
        }

        if (rec.isGroupDivider && pixelCount === 0) continue;
        const rgba = new Uint8ClampedArray(pixelCount * 4);
        const rPlane = planes.get(0);
        const gPlane = planes.get(1);
        const bPlane = planes.get(2);
        const aPlane = planes.get(-1);
        const mPlane = planes.get(-3) ?? planes.get(-2);
        const activeMask = rec.mask && (rec.mask.flags & 2) === 0 && mPlane ? rec.mask : undefined;
        for (let p = 0; p < pixelCount; p++) {
          rgba[p * 4] = rPlane ? rPlane[p] : 0;
          rgba[p * 4 + 1] = gPlane ? gPlane[p] : 0;
          rgba[p * 4 + 2] = bPlane ? bPlane[p] : 0;
          let alpha = aPlane ? aPlane[p] : 255;
          if (activeMask && mPlane) {
            const lx = rec.left + (p % lw);
            const ly = rec.top + Math.floor(p / lw);
            let mv = activeMask.defaultColor;
            if (lx >= activeMask.left && lx < activeMask.right && ly >= activeMask.top && ly < activeMask.bottom) {
              mv = mPlane[(ly - activeMask.top) * mw + (lx - activeMask.left)];
            }
            if (activeMask.flags & 4) mv = 255 - mv;
            alpha = Math.round((alpha * mv) / 255);
          }
          rgba[p * 4 + 3] = alpha;
        }

        layers.push({
          name: rec.name,
          visible: rec.visible,
          opacity: rec.opacity,
          blendMode: rec.blendMode,
          left: rec.left,
          top: rec.top,
          width: lw,
          height: lh,
          rgba,
        });
      }
      if (layers.length > 40) throw new Error('PSDのレイヤー数は40件以内にしてください');
    }
  }

  pos = sectionEnd;

  // Fallback to merged image data if the PSD has 0 layers (flattened PSD)
  if (layers.length === 0 && pos + 2 <= bytes.byteLength) {
    const compression = view.getUint16(pos); pos += 2;
    const pixelCount = width * height;
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    if (compression === 0) {
      requireBytes(pixelCount * Math.min(docChannels, 3));
      for (let c = 0; c < Math.min(docChannels, 4); c++) {
        for (let p = 0; p < pixelCount; p++) rgba[p * 4 + c] = bytes[pos + p];
        pos += pixelCount;
      }
      if (docChannels < 4) {
        for (let p = 0; p < pixelCount; p++) rgba[p * 4 + 3] = 255;
      }
    } else if (compression === 1) {
      const planeCount = Math.min(docChannels, 4);
      const totalRows = height * docChannels;
      requireBytes(totalRows * 2);
      let dataPos = pos + totalRows * 2;
      for (let c = 0; c < docChannels; c++) {
        let chByteLen = 0;
        for (let r = 0; r < height; r++) chByteLen += view.getUint16(pos + (c * height + r) * 2);
        if (dataPos + chByteLen > bytes.byteLength) {
          throw new Error('PSDの圧縮データが破損しています');
        }
        if (c < planeCount) {
          const headerAndData = new Uint8Array(height * 2 + chByteLen);
          headerAndData.set(bytes.subarray(pos + c * height * 2, pos + (c + 1) * height * 2), 0);
          headerAndData.set(bytes.subarray(dataPos, dataPos + chByteLen), height * 2);
          const plane = decodeRleChannel(headerAndData, 0, height, width);
          for (let p = 0; p < pixelCount; p++) rgba[p * 4 + c] = plane[p];
        }
        dataPos += chByteLen;
      }
      if (docChannels < 4) {
        for (let p = 0; p < pixelCount; p++) rgba[p * 4 + 3] = 255;
      }
    } else {
      throw new Error('未対応のPSD圧縮方式です');
    }
    layers.push({
      name: '背景',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      left: 0,
      top: 0,
      width,
      height,
      rgba,
    });
  }

  if (layers.length === 0) throw new Error('PSDファイルにレイヤーが見つかりませんでした');
  return { width, height, layers };
}
