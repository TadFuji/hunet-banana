import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Aperture, ArrowDown, ArrowUp, Brush, Check, ChevronDown, CircleHelp, Download,
  Eraser, Eye, EyeOff, FileImage, FilePlus2, FolderOpen, ImagePlus, KeyRound,
  Layers3, LockKeyhole, Maximize2, MousePointer2, Plus, RectangleHorizontal,
  Redo2, RotateCcw, Save, Search, Settings2, Sparkles, SquarePen, Trash2,
  Type, Undo2, WandSparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { geminiClient } from './api/client';
import {
  applyMask, canvasToMedia, downloadBlob, exportProject, fileToMedia, importProject,
  loadImage, MAX_PROJECT_PIXELS, renderProject, restoreProject, saveProject, uid, validateProjectImages,
} from './lib/editor';
import { DEFAULT_SETTINGS, MODEL, RATIOS } from './types';
import type { BatchJob, ConversationTurn, GenerateResult, GenerationSettings, Layer, MediaInput, Project } from './types';

type Tool = 'move' | 'brush' | 'erase' | 'rectangle' | 'sketch' | 'text';
type Mode = 'create' | 'edit' | 'mask' | 'sketch';
type Snapshot = { project: Project; mask: string; sketch: string };
type Candidate = {
  image: string; original: string; mask: string; mode: Mode; revision: number; width: number; height: number;
  workWidth: number; workHeight: number; workX: number; workY: number;
  prompt: string; result: GenerateResult;
};

const SIZE_PRICE: Record<GenerationSettings['size'], string> = {
  '1K': '$0.0336', '2K': '$0.0504', '4K': '約 $0.1134',
};
const MAX_REFERENCES = 14;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function makeDemo(): Project {
  const width = 1280; const height = 800;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#2a3028'); bg.addColorStop(0.49, '#171f1b'); bg.addColorStop(1, '#34352a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(640, 396, 70, 640, 396, 550);
  glow.addColorStop(0, 'rgba(244,199,106,.26)'); glow.addColorStop(1, 'rgba(244,199,106,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.translate(650, 400); ctx.rotate(-0.19);
  ctx.shadowColor = 'rgba(0,0,0,.48)'; ctx.shadowBlur = 72; ctx.shadowOffsetY = 34;
  ctx.fillStyle = '#d9caad'; ctx.beginPath(); ctx.roundRect(-205, -255, 410, 510, 34); ctx.fill();
  ctx.shadowColor = 'transparent';
  const vessel = ctx.createLinearGradient(-205, 0, 205, 0);
  vessel.addColorStop(0, '#b7a789'); vessel.addColorStop(.43, '#eee4cd'); vessel.addColorStop(1, '#a38f6f');
  ctx.fillStyle = vessel; ctx.beginPath(); ctx.roundRect(-188, -238, 376, 476, 24); ctx.fill();
  ctx.fillStyle = '#272b24'; ctx.fillRect(-161, -49, 322, 148);
  ctx.fillStyle = '#d9debd'; ctx.font = '600 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FORM / 01', 0, -12);
  ctx.font = '400 13px sans-serif'; ctx.fillText('A STUDY IN STILLNESS', 0, 24);
  ctx.strokeStyle = 'rgba(38,42,34,.45)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -155, 104, 45, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(243,239,221,.58)'; ctx.font = '500 15px sans-serif';
  ctx.fillText('CREATIVE STUDY', 64, 740);
  ctx.textAlign = 'right'; ctx.fillText('01 / 03', 1216, 740);
  return { version: 1, name: 'Untitled studio', width, height,
    layers: [{ id: uid(), name: 'サンプル画像', dataUrl: canvas.toDataURL('image/png'), visible: true, opacity: 1 }] };
}

function cloneProject(p: Project): Project {
  return { ...p, layers: p.layers.map(layer => ({ ...layer })) };
}

const imageFromData = loadImage;

function canvasData(canvas: HTMLCanvasElement | null): string {
  return canvas?.toDataURL('image/png') ?? '';
}

function containsDrawing(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return false;
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

function nearestRatio(width: number, height: number): { ratio: string; width: number; height: number; x: number; y: number } {
  const source = width / height;
  const ratio = [...RATIOS].sort((a, b) => {
    const measure = (item: string) => { const [w, h] = item.split(':').map(Number); return Math.abs(Math.log((w / h) / source)); };
    return measure(a) - measure(b);
  })[0];
  const [rw, rh] = ratio.split(':').map(Number);
  const value = rw / rh;
  const workWidth = Math.max(width, Math.ceil(height * value));
  const workHeight = Math.max(height, Math.ceil(width / value));
  return { ratio, width: workWidth, height: workHeight,
    x: Math.floor((workWidth - width) / 2), y: Math.floor((workHeight - height) / 2) };
}

function toolName(tool: Tool): string {
  return ({ move: '移動', brush: '選択ブラシ', erase: '選択を消す', rectangle: '矩形選択', sketch: 'スケッチ', text: '文字' })[tool];
}

export default function App() {
  const [project, setProject] = useState<Project>(makeDemo);
  const [mask, setMask] = useState('');
  const [sketch, setSketch] = useState('');
  const [tool, setTool] = useState<Tool>('move');
  const [mode, setMode] = useState<Mode>('mask');
  const [brushSize, setBrushSize] = useState(42);
  const [zoom, setZoom] = useState(70);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('背景を柔らかな自然光のスタジオに変え、被写体の位置と形は保ってください。');
  const [settings, setSettings] = useState<GenerationSettings>({ ...DEFAULT_SETTINGS });
  const [references, setReferences] = useState<MediaInput[]>([]);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyConnected, setKeyConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('ローカル編集の準備ができました');
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [batchText, setBatchText] = useState('');
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [batchId, setBatchId] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'ai' | 'layers' | 'history'>('ai');
  const [historyTick, setHistoryTick] = useState(0);
  const [saved, setSaved] = useState(false);
  const [collapsed, setCollapsed] = useState({ refs: false, layers: false, advanced: false });
  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const sketchRef = useRef<HTMLCanvasElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layerFileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const moveRef = useRef<{ id: string; startX: number; startY: number; dx: number; dy: number; revision: number; project: Project; mask: string; sketch: string; image?: HTMLImageElement; below?: HTMLCanvasElement; above?: HTMLCanvasElement } | null>(null);
  const historyRef = useRef<{ items: Snapshot[]; index: number }>({ items: [], index: -1 });
  const revisionRef = useRef(0);
  const batchRequestRef = useRef(0);
  const batchTargetRef = useRef<string | null>(null);
  const batchCreatingRef = useRef(false);
  const conversationRef = useRef<ConversationTurn[]>([]);
  const projectRef = useRef(project);
  const overlaysRef = useRef({ mask: '', sketch: '' });
  projectRef.current = project;
  const drawRef = useRef<{ x: number; y: number; startX: number; startY: number; revision: number; project: Project; prior?: ImageData } | null>(null);

  const captureDocument = () => ({ revision: revisionRef.current, project: cloneProject(projectRef.current),
    mask: overlaysRef.current.mask, sketch: overlaysRef.current.sketch });
  const documentUnchanged = (revision: number) => {
    if (revisionRef.current === revision && !drawRef.current && !moveRef.current) return true;
    setError('処理中に文書が編集されたため、結果を適用しませんでした。現在の文書で操作をやり直してください');
    return false;
  };

  const commit = useCallback((next: Project, nextMask = overlaysRef.current.mask, nextSketch = overlaysRef.current.sketch) => {
    if (next.width < 1 || next.height < 1 || next.width > 16384 || next.height > 16384 || next.width * next.height > 32_000_000 || next.layers.length > 40) {
      setError('文書は各辺16,384px・最大3200万画素・40レイヤーまでです'); return false;
    }
    if (next.width * next.height * next.layers.length > MAX_PROJECT_PIXELS) {
      setError('レイヤー全体は1億2800万画素までです'); return false;
    }
    next = { ...next, name: next.name.slice(0, 150), layers: next.layers.map(layer => ({ ...layer, name: layer.name.slice(0, 150) })) };
    const previous = projectRef.current;
    const pixelsChanged = previous.width !== next.width || previous.height !== next.height || previous.layers.length !== next.layers.length ||
      previous.layers.some((layer, index) => {
        const other = next.layers[index];
        return layer.id !== other.id || layer.dataUrl !== other.dataUrl || layer.visible !== other.visible || layer.opacity !== other.opacity;
      });
    const snapshot = { project: cloneProject(next), mask: nextMask, sketch: nextSketch };
    const h = historyRef.current;
    h.items = [...h.items.slice(0, h.index + 1), snapshot].slice(-24);
    h.index = h.items.length - 1;
    revisionRef.current += 1;
    projectRef.current = next;
    overlaysRef.current = { mask: nextMask, sketch: nextSketch };
    if (pixelsChanged) conversationRef.current = [];
    setProject(next); setMask(nextMask); setSketch(nextSketch); setSaved(false); setHistoryTick(v => v + 1);
    return true;
  }, []);

  useEffect(() => {
    historyRef.current = { items: [{ project: cloneProject(project), mask: '', sketch: '' }], index: 0 };
    setHistoryTick(v => v + 1);
    let alive = true;
    restoreProject().then(async restored => {
      if (!restored || !alive || revisionRef.current !== 0) return;
      await validateProjectImages(restored);
      if (alive && revisionRef.current === 0 && !drawRef.current && !moveRef.current) {
        projectRef.current = restored; revisionRef.current += 1;
        setProject(restored);
        historyRef.current = { items: [{ project: cloneProject(restored), mask: '', sketch: '' }], index: 0 };
        setHistoryTick(v => v + 1); setSaved(true); setStatus('前回のプロジェクトを復元しました');
      }
    }).catch(() => { if (alive && revisionRef.current === 0) setError('前回のプロジェクトを復元できませんでした。画像データとブラウザの保存領域を確認してください'); });
    return () => { alive = false; };
    // initialize once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem('nbstudio.batch') || 'null') as { name?: string; state?: string } | null;
      if (typeof value?.name === 'string' && /^batches\/[A-Za-z0-9_-]{1,200}$/.test(value.name)) {
        batchTargetRef.current = value.name;
        setBatchJob({ name: value.name, state: (typeof value.state === 'string' ? value.state : 'PENDING') as BatchJob['state'], images: [], errors: 0 });
        setBatchId(value.name);
      }
    } catch { /* private browsing may block storage */ }
  }, []);

  useEffect(() => {
    if (!batchJob) return;
    try { localStorage.setItem('nbstudio.batch', JSON.stringify({ name: batchJob.name, state: batchJob.state })); }
    catch { /* batch ID can be copied manually */ }
  }, [batchJob]);

  useEffect(() => {
    const cleared = () => setKeyConnected(false);
    window.addEventListener('gemini-key-cleared', cleared);
    return () => window.removeEventListener('gemini-key-cleared', cleared);
  }, []);

  useEffect(() => {
    let alive = true;
    renderProject(project).then(canvas => {
      if (!alive || !displayRef.current) return;
      const dest = displayRef.current; dest.width = project.width; dest.height = project.height;
      dest.getContext('2d')!.drawImage(canvas, 0, 0);
    }).catch(() => setError('画像を描画できませんでした'));
    return () => { alive = false; };
  }, [project]);

  useEffect(() => {
    let alive = true;
    const redraw = (target: HTMLCanvasElement | null, source: string) => {
      if (!target) return;
      if (!source || target.width !== project.width || target.height !== project.height) {
        target.width = project.width; target.height = project.height;
      }
      if (!source) return;
      // Decode before replacing the current drawing so it never disappears between frames.
      imageFromData(source).then(image => {
        if (!alive || drawRef.current) return;
        target.width = project.width; target.height = project.height;
        target.getContext('2d')!.drawImage(image, 0, 0);
      }).catch(() => { if (alive) setError('選択範囲を描画できませんでした'); });
    };
    redraw(maskRef.current, mask); redraw(sketchRef.current, sketch);
    return () => { alive = false; };
  }, [project.width, project.height, mask, sketch]);

  const updateProject = (change: (p: Project) => Project) => commit(change(projectRef.current));
  const updateLayer = (id: string, change: (layer: Layer) => Layer) =>
    updateProject(p => ({ ...p, layers: p.layers.map(layer => layer.id === id ? change(layer) : layer) }));
  const restoreHistory = (index: number) => {
    const h = historyRef.current;
    if (index < 0 || index >= h.items.length) return;
    h.index = index; const item = h.items[index];
    const next = cloneProject(item.project); projectRef.current = next;
    overlaysRef.current = { mask: item.mask, sketch: item.sketch };
    setProject(next); setMask(item.mask); setSketch(item.sketch); conversationRef.current = [];
    revisionRef.current += 1; setHistoryTick(v => v + 1); setSaved(false);
    setStatus('編集履歴を復元しました');
  };
  const historyStep = (direction: -1 | 1) => restoreHistory(historyRef.current.index + direction);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const t = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); spaceRef.current = true; return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); historyStep(event.shiftKey ? 1 : -1);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        const revision = revisionRef.current;
        saveProject(cloneProject(projectRef.current)).then(() => {
          const current = revisionRef.current === revision;
          setSaved(current); setStatus(current ? 'このブラウザに保存しました' : '保存開始時の文書を保存しました。新しい編集は未保存です');
        })
          .catch(() => setError('ブラウザへの保存に失敗しました'));
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) { event.preventDefault(); setZoom(z => Math.min(160, z + 10)); }
      if ((event.metaKey || event.ctrlKey) && event.key === '-') { event.preventDefault(); setZoom(z => Math.max(20, z - 10)); }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'v') setTool('move');
      if (key === 'b') { setTool('brush'); setMode('mask'); }
      if (key === 'e') { setTool('erase'); setMode('mask'); }
      if (key === 'm') { setTool('rectangle'); setMode('mask'); }
      if (key === 't') setTool('text');
      if (event.key === '[') setBrushSize(n => Math.max(4, n - 8));
      if (event.key === ']') setBrushSize(n => Math.min(180, n + 8));
      if (event.key === 'Escape') { setCandidate(null); setKeyOpen(false); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spaceRef.current = false; };
    const clearSpace = () => { spaceRef.current = false; panRef.current = null; };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clearSpace);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', clearSpace); };
    // historyStep accesses refs and current state setters only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(project.width, (event.clientX - bounds.left) * project.width / bounds.width)),
      y: Math.max(0, Math.min(project.height, (event.clientY - bounds.top) * project.height / bounds.height)) };
  };
  const previewMove = (movement: NonNullable<typeof moveRef.current>) => {
    if (!movement.image || !movement.below || !movement.above || !displayRef.current) return;
    const canvas = displayRef.current; const ctx = canvas.getContext('2d')!;
    if (revisionRef.current !== movement.revision) return;
    const layer = movement.project.layers.find(item => item.id === movement.id);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(movement.below, 0, 0);
    ctx.globalAlpha = layer?.opacity ?? 1;
    ctx.drawImage(movement.image, movement.dx, movement.dy, movement.project.width, movement.project.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(movement.above, 0, 0);
  };
  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceRef.current || !viewportRef.current) return;
    const viewport = viewportRef.current;
    panRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current || !viewportRef.current) return;
    viewportRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
    viewportRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
  };
  const beginDraw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (spaceRef.current) return;
    if (tool === 'move') {
      const snapshot = captureDocument();
      const layer = snapshot.project.layers.find(item => item.id === selectedLayer && item.visible) ?? [...snapshot.project.layers].reverse().find(item => item.visible);
      if (!layer) return;
      const index = snapshot.project.layers.findIndex(item => item.id === layer.id);
      const p = point(event);
      const movement = { ...snapshot, id: layer.id, startX: p.x, startY: p.y, dx: 0, dy: 0 } as NonNullable<typeof moveRef.current>;
      moveRef.current = movement; setSelectedLayer(layer.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      Promise.all([
        imageFromData(layer.dataUrl),
        renderProject({ ...snapshot.project, layers: snapshot.project.layers.slice(0, index) }),
        renderProject({ ...snapshot.project, layers: snapshot.project.layers.slice(index + 1) }),
      ]).then(([image, below, above]) => {
        if (moveRef.current !== movement || revisionRef.current !== movement.revision) return;
        movement.image = image; movement.below = below; movement.above = above; previewMove(movement);
      }).catch(() => { if (moveRef.current === movement) setError('レイヤーの移動を準備できませんでした'); });
      return;
    }
    const p = point(event);
    if (tool === 'text') { void addTextAt(p.x, p.y); return; }
    const target = tool === 'sketch' ? sketchRef.current : maskRef.current;
    if (!target) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = target.getContext('2d')!;
    drawRef.current = { ...p, startX: p.x, startY: p.y, revision: revisionRef.current, project: cloneProject(projectRef.current),
      prior: tool === 'rectangle' ? ctx.getImageData(0, 0, target.width, target.height) : undefined };
    if (tool === 'rectangle') return;
    ctx.save(); ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = tool === 'sketch' ? '#eeaa56' : '#ed665e';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .1, p.y + .1); ctx.stroke(); ctx.restore();
  };
  const moveDraw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (moveRef.current) {
      const p = point(event); const movement = moveRef.current;
      movement.dx = Math.round(p.x - movement.startX); movement.dy = Math.round(p.y - movement.startY);
      previewMove(movement); return;
    }
    const previous = drawRef.current;
    if (!previous) return;
    if (revisionRef.current !== previous.revision) return;
    const p = point(event);
    const target = tool === 'sketch' ? sketchRef.current : maskRef.current;
    if (!target) return;
    const ctx = target.getContext('2d')!;
    if (tool === 'rectangle') {
      if (previous.prior) ctx.putImageData(previous.prior, 0, 0);
      ctx.save(); ctx.fillStyle = '#ed665e';
      ctx.fillRect(Math.min(previous.startX, p.x), Math.min(previous.startY, p.y),
        Math.abs(p.x - previous.startX), Math.abs(p.y - previous.startY)); ctx.restore();
    } else {
      ctx.save(); ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = tool === 'sketch' ? '#eeaa56' : '#ed665e';
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore();
    }
    drawRef.current = { ...previous, x: p.x, y: p.y };
  };
  const endDraw = () => {
    if (moveRef.current) {
      const movement = moveRef.current; moveRef.current = null;
      if (!movement.dx && !movement.dy) return;
      if (!documentUnchanged(movement.revision)) return;
      imageFromData(movement.project.layers.find(item => item.id === movement.id)!.dataUrl).then(async image => {
        if (!documentUnchanged(movement.revision)) return;
        const canvas = document.createElement('canvas'); canvas.width = movement.project.width; canvas.height = movement.project.height;
        canvas.getContext('2d')!.drawImage(image, movement.dx, movement.dy, movement.project.width, movement.project.height);
        const next = { ...movement.project, layers: movement.project.layers.map(item => item.id === movement.id ? { ...item, dataUrl: canvas.toDataURL('image/png') } : item) };
        await validateProjectImages(next);
        if (documentUnchanged(movement.revision) && commit(next, movement.mask, movement.sketch)) setStatus('レイヤーを移動しました');
      }).catch(() => setError('レイヤーを移動できませんでした'));
      return;
    }
    if (!drawRef.current) return;
    const drawing = drawRef.current; drawRef.current = null;
    if (documentUnchanged(drawing.revision)) commit(drawing.project, canvasData(maskRef.current), canvasData(sketchRef.current));
  };

  const addTextAt = async (x: number, y: number) => {
    const snapshot = captureDocument();
    const value = window.prompt('追加する文字を入力してください');
    if (!value?.trim()) return;
    const canvas = document.createElement('canvas'); canvas.width = snapshot.project.width; canvas.height = snapshot.project.height;
    const ctx = canvas.getContext('2d')!;
    const fontSize = Math.max(32, Math.round(snapshot.project.width / 24));
    ctx.font = `600 ${fontSize}px sans-serif`; ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(3, fontSize / 12); ctx.strokeStyle = 'rgba(20,22,19,.8)';
    ctx.strokeText(value, x, y); ctx.fillStyle = '#f7f2df'; ctx.fillText(value, x, y);
    const layer = { id: uid(), name: `文字 · ${value.slice(0, 12)}`, dataUrl: canvas.toDataURL('image/png'), visible: true, opacity: 1 };
    try {
      const next = { ...snapshot.project, layers: [...snapshot.project.layers, layer] };
      await validateProjectImages(next);
      if (documentUnchanged(snapshot.revision) && commit(next, snapshot.mask, snapshot.sketch)) { setSelectedLayer(layer.id); setStatus('文字レイヤーを追加しました'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '文字レイヤーを追加できませんでした'); }
  };

  const openImage = async (file?: File) => {
    if (!file) return;
    const snapshot = captureDocument();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('PNG・JPEG・WebP画像を選んでください'); return; }
    try {
      const media = await fileToMedia(file);
      const dataUrl = `data:${media.mimeType};base64,${media.data}`;
      const image = await imageFromData(dataUrl);
      const layer = { id: uid(), name: file.name, dataUrl, visible: true, opacity: 1 };
      const next: Project = { version: 1, name: file.name.replace(/\.[^.]+$/, ''),
        width: image.naturalWidth, height: image.naturalHeight, layers: [layer] };
      if (!documentUnchanged(snapshot.revision) || !commit(next, '', '')) return;
      setSelectedLayer(layer.id); setCandidate(null); setError(''); setStatus('画像を開きました');
      conversationRef.current = [];
      setZoom(Math.min(100, Math.max(25, Math.round(760 / image.naturalWidth * 100))));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '画像を開けませんでした'); }
  };
  const addImageLayer = async (file?: File) => {
    if (!file) return;
    const snapshot = captureDocument();
    try {
      const media = await fileToMedia(file);
      if (!media.mimeType.startsWith('image/')) throw new Error('PNG・JPEG・WebP画像を選んでください');
      const image = await imageFromData(`data:${media.mimeType};base64,${media.data}`);
      const canvas = document.createElement('canvas'); canvas.width = snapshot.project.width; canvas.height = snapshot.project.height;
      const scale = Math.min(1, snapshot.project.width / image.naturalWidth, snapshot.project.height / image.naturalHeight);
      const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
      canvas.getContext('2d')!.drawImage(image, (snapshot.project.width - width) / 2, (snapshot.project.height - height) / 2, width, height);
      const layer: Layer = { id: uid(), name: file.name, dataUrl: canvas.toDataURL('image/png'), visible: true, opacity: 1 };
      const next = { ...snapshot.project, layers: [...snapshot.project.layers, layer] };
      await validateProjectImages(next);
      if (!documentUnchanged(snapshot.revision) || !commit(next, snapshot.mask, snapshot.sketch)) return;
      setSelectedLayer(layer.id); setStatus('画像レイヤーを追加しました');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '画像レイヤーを追加できませんでした'); }
  };
  const newDocument = () => {
    const raw = window.prompt('新規文書の横幅 × 縦幅（px）', '1280 × 800');
    if (!raw) return;
    const match = raw.match(/^(\d+)\s*[×xX]\s*(\d+)$/);
    if (!match) { setError('「1280 × 800」の形式で入力してください'); return; }
    const width = Number(match[1]); const height = Number(match[2]);
    if (width < 64 || height < 64 || width * height > 32_000_000 || width > 8192 || height > 8192) {
      setError('64〜8192pxの範囲、合計3200万画素以下で指定してください'); return;
    }
    const blank = document.createElement('canvas'); blank.width = width; blank.height = height;
    commit({ version: 1, name: '名称未設定', width, height,
      layers: [{ id: uid(), name: '透明な背景', dataUrl: blank.toDataURL('image/png'), visible: true, opacity: 1 }] }, '', '');
    setSelectedLayer(null); setCandidate(null); conversationRef.current = []; setStatus('新規文書を作成しました');
  };
  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = [...files];
    const totalBytes = selected.reduce((sum, f) => sum + f.size, 0) + references.reduce((sum, item) => sum + Math.ceil(item.data.length * .75), 0);
    if (totalBytes > MAX_UPLOAD_BYTES) { setError('添付ファイルは合計20MB未満にしてください'); return; }
    if (selected.length + references.length > MAX_REFERENCES) { setError(`参照素材は最大${MAX_REFERENCES}件です`); return; }
    const valid = selected.filter(file => ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'].includes(file.type));
    if (valid.length !== selected.length) { setError('画像・PDF・動画を選んでください'); return; }
    try {
      const items = await Promise.all(valid.map(fileToMedia));
      setReferences(previous => [...previous, ...items]);
      setStatus(`${items.length}件の参照ファイルを追加しました`); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '添付ファイルを読み込めませんでした'); }
  };

  const connectKey = async () => {
    let key = keyRef.current?.value.trim() ?? '';
    if (keyRef.current) keyRef.current.value = '';
    if (!key) { setError('Gemini APIキーを入力してください'); return; }
    try {
      const task = geminiClient.setKey(key);
      key = '';
      await task;
      setKeyConnected(true); setKeyOpen(false); setError(''); setStatus('APIキーをこのタブの一時メモリに設定しました');
    } catch (caught) { key = ''; setError(caught instanceof Error ? caught.message : 'キーを設定できませんでした'); }
  };
  const disconnectKey = () => {
    geminiClient.clearKey(); setKeyConnected(false); setStatus('APIキーを破棄しました'); setKeyOpen(false);
  };

  const runGeneration = async () => {
    if (busy) return;
    if (!keyConnected) { setKeyOpen(true); return; }
    if (!prompt.trim()) { setError('作りたい画像や編集内容を入力してください'); return; }
    if (mode === 'mask' && !containsDrawing(maskRef.current)) { setError('選択ブラシまたは矩形選択で編集範囲を描いてください'); return; }
    if (mode === 'sketch' && !containsDrawing(sketchRef.current)) { setError('スケッチツールで線を描いてください'); return; }
    const originalProject = cloneProject(project);
    const revision = revisionRef.current;
    const maskSnapshot = canvasData(maskRef.current);
    const sketchSnapshot = canvasData(sketchRef.current);
    setBusy(true); setError(''); setStatus('Nano Banana 2.1 に送信しています…');
    try {
      const media: MediaInput[] = [];
      let original = '';
      let geometry = { ratio: settings.ratio, width: originalProject.width, height: originalProject.height, x: 0, y: 0 };
      if (mode !== 'create') {
        const rendered = await renderProject(originalProject);
        original = rendered.toDataURL('image/png');
        const work = mode === 'mask' ? nearestRatio(originalProject.width, originalProject.height) : geometry;
        geometry = work;
        const source = document.createElement('canvas'); source.width = work.width; source.height = work.height;
        source.getContext('2d')!.drawImage(rendered, work.x, work.y);
        media.push(canvasToMedia(source, '編集元画像'));
        if (mode === 'mask' || mode === 'sketch') {
          const overlay = mode === 'mask' ? maskSnapshot : sketchSnapshot;
          const overlayImage = await imageFromData(overlay);
          const annotated = document.createElement('canvas'); annotated.width = work.width; annotated.height = work.height;
          const ctx = annotated.getContext('2d')!; ctx.drawImage(source, 0, 0);
          if (mode === 'mask') {
            const tint = document.createElement('canvas'); tint.width = work.width; tint.height = work.height;
            const tintCtx = tint.getContext('2d')!; tintCtx.drawImage(overlayImage, work.x, work.y);
            tintCtx.globalCompositeOperation = 'source-in'; tintCtx.fillStyle = '#ed665e'; tintCtx.fillRect(0, 0, tint.width, tint.height);
            ctx.globalAlpha = .65; ctx.drawImage(tint, 0, 0); ctx.globalAlpha = 1;
          } else ctx.drawImage(overlayImage, work.x, work.y);
          media.push(canvasToMedia(annotated, mode === 'mask' ? '選択範囲' : '手描きスケッチ'));
        }
      }
      const room = MAX_REFERENCES - media.filter(item => item.mimeType.startsWith('image/')).length;
      if (references.filter(item => item.mimeType.startsWith('image/')).length > room) throw new Error(`画像入力は合計${MAX_REFERENCES}枚以内にしてください`);
      media.push(...references);
      let instruction = prompt.trim();
      if (mode === 'mask') instruction += '\n2枚目の色付き選択範囲だけを編集し、周囲の構図を保ってください。選択範囲の表示色は完成画像に残さないでください。';
      if (mode === 'sketch') instruction += '\n2枚目は手描き指示です。線を完成画像に残さず、指示として解釈してください。';
      const requestSettings = mode === 'mask' ? { ...settings, ratio: geometry.ratio } : settings;
      const result = await geminiClient.generate({ prompt: instruction, media, settings: requestSettings,
        history: mode === 'create' ? [] : conversationRef.current });
      const image = result.images[0]?.dataUrl;
      if (!image) throw new Error(result.text || '画像が返されませんでした');
      setCandidate({ image, original, mask: maskSnapshot, mode, revision, width: originalProject.width, height: originalProject.height,
        workWidth: geometry.width, workHeight: geometry.height, workX: geometry.x, workY: geometry.y, prompt: prompt.trim(), result });
      setStatus('候補ができました。確認してから採用できます');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '画像を生成できませんでした');
      setStatus('生成に失敗しました');
    } finally { setBusy(false); }
  };
  const adoptCandidate = async () => {
    if (!candidate) return;
    const snapshot = captureDocument();
    const selectedCandidate = candidate;
    if (snapshot.revision !== selectedCandidate.revision && !window.confirm('候補の生成後にキャンバスを編集しました。この候補は生成開始時の画像に基づきます。現在の編集を置き換えて採用しますか？')) return;
    try {
      let dataUrl = candidate.image;
      if (candidate.mode === 'mask') {
        const proposed = await imageFromData(candidate.image);
        const workRatio = candidate.workWidth / candidate.workHeight;
        const proposedRatio = proposed.naturalWidth / proposed.naturalHeight;
        if (Math.abs(proposedRatio / workRatio - 1) > .015) throw new Error('候補の縦横比が編集元と異なります。比率を合わせて再生成してください');
        const cropped = document.createElement('canvas'); cropped.width = candidate.width; cropped.height = candidate.height;
        const scaleX = proposed.naturalWidth / candidate.workWidth;
        const scaleY = proposed.naturalHeight / candidate.workHeight;
        cropped.getContext('2d')!.drawImage(proposed,
          candidate.workX * scaleX, candidate.workY * scaleY,
          candidate.width * scaleX, candidate.height * scaleY,
          0, 0, candidate.width, candidate.height);
        const maskImage = await imageFromData(candidate.mask);
        const maskCanvas = document.createElement('canvas'); maskCanvas.width = candidate.width; maskCanvas.height = candidate.height;
        maskCanvas.getContext('2d')!.drawImage(maskImage, 0, 0);
        dataUrl = await applyMask(candidate.original, cropped.toDataURL('image/png'), maskCanvas);
      }
      const image = await imageFromData(dataUrl);
      if (!documentUnchanged(snapshot.revision)) return;
      const next: Project = { ...snapshot.project, width: image.naturalWidth, height: image.naturalHeight,
        layers: [...snapshot.project.layers.map(layer => ({ ...layer, visible: false })),
          { id: uid(), name: `AI · ${candidate.prompt.slice(0, 24)}`, dataUrl, visible: true, opacity: 1 }] };
      await validateProjectImages(next);
      if (!documentUnchanged(snapshot.revision) || !commit(next, '', '')) return;
      conversationRef.current = selectedCandidate.result.conversation; setCandidate(null); setStatus('候補を新しいレイヤーとして採用しました');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '候補を採用できませんでした'); }
  };

  const exportPng = async () => {
    try {
      const canvas = await renderProject(project);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG作成に失敗しました')), 'image/png'));
      downloadBlob(blob, `${project.name || 'nano-banana-studio'}.png`); setStatus('PNGを書き出しました');
    } catch { setError('PNGを書き出せませんでした'); }
  };
  const exportJson = () => {
    try {
      downloadBlob(exportProject(project), `${project.name || 'nano-banana-studio'}.nbstudio.json`);
      setStatus('プロジェクトを書き出しました');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'プロジェクトを書き出せませんでした'); }
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    const snapshot = captureDocument();
    try {
      if (file.size > 180_000_000) throw new Error('プロジェクトが大きすぎます');
      const next = importProject(await file.text());
      await validateProjectImages(next);
      if (!documentUnchanged(snapshot.revision) || !commit(next, '', '')) return;
      conversationRef.current = []; setCandidate(null); setStatus('プロジェクトを読み込みました'); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'プロジェクト形式を確認してください'); }
  };
  const save = async () => {
    const snapshot = captureDocument();
    try {
      await saveProject(snapshot.project);
      const current = revisionRef.current === snapshot.revision;
      setSaved(current); setStatus(current ? 'このブラウザに保存しました' : '保存開始時の文書を保存しました。新しい編集は未保存です');
    }
    catch { setSaved(false); setError('ブラウザへの保存に失敗しました。プロジェクトを書き出してください'); }
  };
  const expandCanvas = () => {
    const snapshot = captureDocument();
    const original = snapshot.project;
    const raw = window.prompt('拡張する横幅 × 縦幅（px）', `${original.width + 256} × ${original.height + 256}`);
    if (!raw) return;
    const match = raw.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (!match) { setError('「1536 × 1024」の形式で入力してください'); return; }
    const width = Number(match[1]); const height = Number(match[2]);
    if (width < original.width || height < original.height || width > 8192 || height > 8192 || width * height > 32_000_000) {
      setError(`現在の${original.width} × ${original.height}px以上、8192px以下、合計3200万画素以下で指定してください`); return;
    }
    if (width * height * original.layers.length > MAX_PROJECT_PIXELS) {
      setError('レイヤー全体は1億2800万画素までです'); return;
    }
    const left = Math.floor((width - original.width) / 2); const top = Math.floor((height - original.height) / 2);
    Promise.all(original.layers.map(async layer => {
      const image = await imageFromData(layer.dataUrl);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(image, left, top, original.width, original.height);
      return { ...layer, dataUrl: canvas.toDataURL('image/png') };
    })).then(layers => {
      if (documentUnchanged(snapshot.revision) && commit({ ...original, width, height, layers }, '', '')) setStatus('キャンバスを拡張しました');
    })
      .catch(() => setError('キャンバスを拡張できませんでした'));
  };
  const startBatch = async () => {
    if (busy || batchCreatingRef.current) return;
    const lines = batchText.split('\n').map(x => x.trim()).filter(Boolean);
    if (!keyConnected) { setKeyOpen(true); return; }
    if (!lines.length || lines.length > 20) { setError('Batchは1〜20行の指示を入力してください'); return; }
    const request = ++batchRequestRef.current;
    batchCreatingRef.current = true;
    batchTargetRef.current = null;
    setBatchJob(null); setBatchId('');
    setBusy(true); setError('');
    try {
      const job = await geminiClient.createBatch(lines.map(line => ({ prompt: line, media: [], settings: { ...settings, webSearch: false, imageSearch: false } })));
      if (batchRequestRef.current !== request || batchTargetRef.current !== null) return;
      batchTargetRef.current = job.name;
      setBatchJob(job); setBatchId(job.name); setStatus('Batchジョブを作成しました');
    } catch (caught) { if (batchRequestRef.current === request && batchTargetRef.current === null) setError(caught instanceof Error ? caught.message : 'Batchを開始できませんでした'); }
    finally { batchCreatingRef.current = false; setBusy(false); }
  };
  const refreshBatch = async () => {
    if (!batchJob) return;
    if (!keyConnected) { setKeyOpen(true); return; }
    const name = batchJob.name;
    if (batchTargetRef.current !== name) return;
    const request = ++batchRequestRef.current;
    try {
      const job = await geminiClient.getBatch(name);
      if (batchRequestRef.current !== request || batchTargetRef.current !== name) return;
      if (job.name !== name) throw new Error('Batch IDが応答と一致しませんでした。対象のIDを確認してください');
      setBatchJob(job); setBatchId(job.name); setStatus(`Batch: ${job.state}`);
    }
    catch (caught) { if (batchRequestRef.current === request && batchTargetRef.current === name) setError(caught instanceof Error ? caught.message : 'Batch状態を確認できませんでした'); }
  };
  const cancelBatch = async () => {
    if (!batchJob) return;
    if (!keyConnected) { setKeyOpen(true); return; }
    const name = batchJob.name;
    if (batchTargetRef.current !== name) return;
    const request = ++batchRequestRef.current;
    try {
      const accepted = await geminiClient.cancelBatch(name);
      if (batchRequestRef.current !== request || batchTargetRef.current !== name) return;
      setBatchId(name);
      setStatus(accepted ? 'Batchの中止を依頼しました' : 'Batchの中止状態を確認してください');
      const job = await geminiClient.getBatch(name);
      if (batchRequestRef.current !== request || batchTargetRef.current !== name) return;
      if (job.name !== name) throw new Error('Batch IDが応答と一致しませんでした。対象のIDを確認してください');
      setBatchJob(job); setBatchId(job.name);
    } catch (caught) { if (batchRequestRef.current === request && batchTargetRef.current === name) setError(caught instanceof Error ? caught.message : 'Batchを中止できませんでした'); }
  };
  const loadBatchId = () => {
    if (batchCreatingRef.current) { setError('Batchの作成結果が届くまでお待ちください'); return; }
    const name = batchId.trim();
    if (!/^batches\/[A-Za-z0-9_-]{1,200}$/.test(name)) { setError('Batch IDは batches/… の形式で入力してください'); return; }
    batchRequestRef.current += 1; batchTargetRef.current = name;
    setBatchId(name);
    setBatchJob({ name, state: 'PENDING', images: [], errors: 0 });
    setError(''); setStatus('Batch IDを読み込みました。キーを接続して更新できます');
  };
  const adoptBatchImage = async (url: string) => {
    const snapshot = captureDocument();
    try {
      const image = await imageFromData(url);
      const next = { ...snapshot.project, width: image.naturalWidth, height: image.naturalHeight,
        layers: [...snapshot.project.layers.map(layer => ({ ...layer, visible: false })),
          { id: uid(), name: 'Batchの結果', dataUrl: url, visible: true, opacity: 1 }] };
      await validateProjectImages(next);
      if (!documentUnchanged(snapshot.revision) || !commit(next, '', '')) return;
      conversationRef.current = []; setStatus('Batch画像を採用しました');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Batch画像を採用できませんでした'); }
  };

  const h = historyRef.current;
  const drawTool = tool !== 'move';
  const isStale = candidate && candidate.revision !== revisionRef.current;
  return (
    <div className="app-shell">
      <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void openImage(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={layerFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void addImageLayer(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={projectFileRef} hidden type="file" accept=".json,application/json" onChange={e => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={referenceFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm,video/quicktime" multiple onChange={e => { void addReferences(e.target.files); e.target.value = ''; }} />
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Aperture size={22} strokeWidth={1.9} /></div><div><strong>banana<span>studio</span></strong><small>NANO BANANA 2.1 WORKSPACE</small></div></div>
        <nav className="menu-bar" aria-label="メニューバー">
          <details><summary>ファイル</summary><div className="menu-pop"><button onClick={newDocument}>新規文書</button><button onClick={() => fileRef.current?.click()}>画像を開く</button><button onClick={() => projectFileRef.current?.click()}>プロジェクトを開く</button><button onClick={() => void save()}>保存 <kbd>⌘S</kbd></button><button onClick={() => void exportPng()}>PNGを書き出す</button><button onClick={exportJson}>プロジェクトを書き出す</button></div></details>
          <details><summary>編集</summary><div className="menu-pop"><button onClick={() => historyStep(-1)}>元に戻す <kbd>⌘Z</kbd></button><button onClick={() => historyStep(1)}>やり直し <kbd>⇧⌘Z</kbd></button></div></details>
          <details><summary>画像</summary><div className="menu-pop"><button onClick={expandCanvas}>キャンバスを拡張</button></div></details>
          <details><summary>レイヤー</summary><div className="menu-pop"><button onClick={() => setRightTab('layers')}>レイヤーパネル</button><button onClick={() => layerFileRef.current?.click()}>画像レイヤーを追加</button><button onClick={() => setTool('text')}>文字を追加 <kbd>T</kbd></button></div></details>
          <details><summary>選択範囲</summary><div className="menu-pop"><button onClick={() => { commit(project, '', sketch); setStatus('選択範囲を解除しました'); }}>選択を解除</button><button onClick={() => { setTool('rectangle'); setMode('mask'); }}>矩形選択 <kbd>M</kbd></button></div></details>
          <details><summary>表示</summary><div className="menu-pop"><button onClick={() => setZoom(z => Math.min(160, z + 10))}>拡大</button><button onClick={() => setZoom(z => Math.max(20, z - 10))}>縮小</button><button onClick={() => setZoom(100)}>100%</button></div></details>
          <details><summary>ヘルプ</summary><div className="menu-pop"><a href="/guide.pdf" target="_blank" rel="noopener noreferrer">図解取扱説明書・料金表 ↗</a></div></details>
        </nav>
        <div className="top-project"><span className="project-dot" /> <input aria-label="プロジェクト名" maxLength={150} value={project.name} onChange={e => updateProject(p => ({ ...p, name: e.target.value }))} /><span className="subdued">{saved ? '保存済み' : '未保存'}</span></div>
        <div className="top-actions">
          <button className="icon-btn desktop-only" title="元に戻す" aria-label="元に戻す" disabled={h.index <= 0} onClick={() => historyStep(-1)}><Undo2 size={17} /></button>
          <button className="icon-btn desktop-only" title="やり直す" aria-label="やり直す" disabled={h.index >= h.items.length - 1} onClick={() => historyStep(1)}><Redo2 size={17} /></button>
          <span className="top-divider" />
          <button className="text-btn desktop-only" onClick={() => projectFileRef.current?.click()}><FolderOpen size={16} /> 読込</button>
          <button className="text-btn desktop-only" onClick={() => void save()}><Save size={16} /> 保存</button>
          <div className="export-menu"><button className="text-btn" onClick={exportPng}><Download size={16} /> PNG</button><button className="chevron-btn" onClick={exportJson} title="プロジェクトを書き出す" aria-label="プロジェクトを書き出す"><ChevronDown size={15} /></button></div>
          <button className={`key-pill ${keyConnected ? 'connected' : ''}`} onClick={() => setKeyOpen(true)}><span className="key-led" /><KeyRound size={14} /> {keyConnected ? 'キー接続中' : 'APIキーを設定'}</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="編集ツール">
          <div className="rail-label">TOOLS</div>
          {([
            ['move', MousePointer2], ['brush', Brush], ['erase', Eraser], ['rectangle', RectangleHorizontal],
            ['sketch', SquarePen], ['text', Type],
          ] as const).map(([id, Icon]) => <button key={id} className={`rail-tool ${tool === id ? 'active' : ''}`} aria-label={toolName(id)} title={toolName(id)} onClick={() => { setTool(id); if (id === 'brush' || id === 'erase' || id === 'rectangle') setMode('mask'); if (id === 'sketch') setMode('sketch'); }}><Icon size={20} strokeWidth={1.7} /></button>)}
          <div className="rail-separator" />
          <button className="rail-tool" title="画像レイヤーを追加" aria-label="画像レイヤーを追加" onClick={() => layerFileRef.current?.click()}><ImagePlus size={20} /></button>
          <button className="rail-tool" title="キャンバスを拡張" aria-label="キャンバスを拡張" onClick={expandCanvas}><Maximize2 size={19} /></button>
          <div className="rail-spacer" />
          <div className="rail-bottom"><span>NB</span><small>2.1</small></div>
        </aside>

        <main className="editor-main">
          <div className="canvas-toolbar">
            <div className="canvas-toolbar-left"><span className="breadcrumb">STUDIO <span>/</span> {project.name || 'Untitled'}</span><span className="canvas-size">{project.width} × {project.height} px</span></div>
            <div className="canvas-toolbar-right">
              {(tool === 'brush' || tool === 'erase' || tool === 'sketch') && <div className="brush-control"><Brush size={15} /><input aria-label="ブラシサイズ" type="range" min="4" max="180" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} /><span>{brushSize}px</span></div>}
              <button className="small-icon" aria-label="縮小" onClick={() => setZoom(z => Math.max(20, z - 10))}><ZoomOut size={17} /></button>
              <span className="zoom-label">{zoom}%</span>
              <button className="small-icon" aria-label="拡大" onClick={() => setZoom(z => Math.min(160, z + 10))}><ZoomIn size={17} /></button>
            </div>
          </div>
          <div ref={viewportRef} className="canvas-viewport" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={() => { panRef.current = null; }} onPointerCancel={() => { panRef.current = null; }}>
            <div className="canvas-surround">
              <div className="canvas-stage" style={{ width: `${project.width * zoom / 100}px`, height: `${project.height * zoom / 100}px`, aspectRatio: `${project.width}/${project.height}` }}>
                <canvas ref={displayRef} className="image-canvas" aria-label="編集中の画像" />
                <canvas ref={maskRef} className="overlay-canvas mask-canvas" style={{ opacity: mode === 'mask' || ['brush', 'erase', 'rectangle'].includes(tool) ? .52 : 0 }} aria-hidden="true" />
                <canvas ref={sketchRef} className="overlay-canvas sketch-canvas" style={{ opacity: mode === 'sketch' || tool === 'sketch' ? .88 : 0 }} aria-hidden="true" />
                <canvas className={`pointer-canvas ${drawTool ? 'drawable' : 'movable'}`} width={project.width} height={project.height} aria-label="編集キャンバス" onPointerDown={beginDraw} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerCancel={endDraw} />
              </div>
              <div className="canvas-hint"><span className="hint-sparkle">✦</span> {drawTool ? `${toolName(tool)} · キャンバス上で操作` : '移動ツールでレイヤーをドラッグ · Spaceキーを押しながらパン'}</div>
            </div>
          </div>
          <div className="statusbar"><div><span className={`status-pulse ${busy ? 'busy' : ''}`} />{status}</div><div className="status-info">{project.layers.length} レイヤー <span>·</span> {project.width} × {project.height} <span>·</span> {MODEL}</div></div>
          <div className="bottom-strip">
            <div className="bottom-heading"><span className="eyebrow">WORKSPACE</span><strong>編集履歴</strong><span className="bottom-meta">{h.items.length} ステップ</span></div>
            <div className="history-list">{h.items.map((item, index) => <button key={index} className={`history-item ${index === h.index ? 'current' : ''}`} onClick={() => restoreHistory(index)}><span className="history-node" /><span>{index === 0 ? '開始' : item.project.layers.at(-1)?.name || '編集'}</span><small>{String(index + 1).padStart(2, '0')}</small></button>)}</div>
          </div>
        </main>

        <aside className="right-panel">
          <div className="panel-scroll">
            <div className="right-tabs" role="tablist" aria-label="右パネル"><button role="tab" aria-selected={rightTab === 'ai'} className={rightTab === 'ai' ? 'active' : ''} onClick={() => setRightTab('ai')}>AI生成</button><button role="tab" aria-selected={rightTab === 'layers'} className={rightTab === 'layers' ? 'active' : ''} onClick={() => setRightTab('layers')}>レイヤー</button><button role="tab" aria-selected={rightTab === 'history'} className={rightTab === 'history' ? 'active' : ''} onClick={() => setRightTab('history')}>履歴</button></div>
            {rightTab === 'ai' && <><div className="panel-intro"><div className="panel-overline"><Sparkles size={13} /> NANO BANANA 2.1</div><h1>AI画像生成・編集</h1><p>指示を入力して、候補を確認してから採用します。</p></div>
            <div className="mode-tabs" role="tablist" aria-label="生成モード">
              {([['create', '新規生成'], ['edit', '全体編集'], ['mask', '部分編集'], ['sketch', 'スケッチ']] as const).map(([id, label]) => <button role="tab" aria-selected={mode === id} key={id} className={mode === id ? 'selected' : ''} onClick={() => setMode(id)}>{label}</button>)}
            </div>
            <section className="panel-section prompt-section"><div className="section-head"><label htmlFor="prompt"><WandSparkles size={16} /> プロンプト</label><span>日本語対応</span></div><textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="どんな画像をつくりますか？ 編集したい部分や質感、光の雰囲気などを入力してください。" rows={5} /><div className="prompt-note">{mode === 'mask' ? '選択範囲だけを元画像へ合成。範囲外の画素を保持します。' : mode === 'sketch' ? '手描き線を指示画像としてモデルに送ります。' : mode === 'create' ? '文章と参照素材からの新規生成です。' : 'キャンバスの画像全体を編集します。'}</div></section>
            <section className="panel-section settings-section"><div className="section-head"><span><Settings2 size={16} /> 生成設定</span></div>
              <div className="setting-grid"><label>解像度<select aria-label="解像度" value={settings.size} onChange={e => setSettings(s => ({ ...s, size: e.target.value as GenerationSettings['size'] }))}><option>1K</option><option>2K</option><option>4K</option></select></label><label>アスペクト比<select aria-label="アスペクト比" value={mode === 'mask' ? nearestRatio(project.width, project.height).ratio : settings.ratio} disabled={mode === 'mask'} onChange={e => setSettings(s => ({ ...s, ratio: e.target.value }))}>{RATIOS.map(ratio => <option key={ratio}>{ratio}</option>)}</select></label></div>
              {mode === 'mask' && <p className="ratio-note">部分編集では元画像に近い比率で生成し、元の大きさに合わせて合成します。</p>}
              <button className="section-toggle advanced-toggle" onClick={() => setCollapsed(s => ({ ...s, advanced: !s.advanced }))}><span>詳細オプション</span><ChevronDown size={16} className={collapsed.advanced ? '' : 'rotated'} /></button>
              {!collapsed.advanced && <div className="advanced-settings"><label>思考レベル<select aria-label="思考レベル" value={settings.thinking} onChange={e => setSettings(s => ({ ...s, thinking: e.target.value as GenerationSettings['thinking'] }))}><option value="minimal">minimal · 速い</option><option value="medium">medium · 標準</option><option value="high">high · 詳細</option></select></label><label className="toggle-row"><span><Search size={15} /> Web検索</span><input type="checkbox" checked={settings.webSearch} onChange={e => setSettings(s => ({ ...s, webSearch: e.target.checked }))} /></label><label className="toggle-row"><span><FileImage size={15} /> 画像検索</span><input type="checkbox" checked={settings.imageSearch} onChange={e => setSettings(s => ({ ...s, imageSearch: e.target.checked }))} /></label></div>}
            </section>
            <section className="panel-section refs-section"><button className="section-toggle" onClick={() => setCollapsed(s => ({ ...s, refs: !s.refs }))}><span><ImagePlus size={16} /> 参照素材 <em>{references.length}</em></span><ChevronDown size={16} className={collapsed.refs ? '' : 'rotated'} /></button>{!collapsed.refs && <><p>画像・PDF・動画を添付。画像入力は合計14枚まで。</p><div className="reference-list">{references.map((item, i) => <div key={i} className="reference-chip">{item.mimeType.startsWith('image/') ? <img src={`data:${item.mimeType};base64,${item.data}`} alt="参照画像" /> : <FileImage size={18} />}<span>{item.label || `参照 ${i + 1}`}</span><button title="削除" aria-label={`参照${i + 1}を削除`} onClick={() => setReferences(old => old.filter((_, j) => i !== j))}><X size={14} /></button></div>)}</div><button className="reference-add" onClick={() => referenceFileRef.current?.click()}><Plus size={17} /> 参照素材を追加</button></>}</section>
            <div className="generate-area"><div className="price-note"><span>画像出力の目安</span><strong>{SIZE_PRICE[settings.size]} / 枚</strong></div><button className="generate-button" disabled={busy} onClick={() => void runGeneration()}>{busy ? <><span className="spin" /> 生成中…</> : <><Sparkles size={18} /> {keyConnected ? '画像を生成' : 'キーを設定して生成'} <span className="button-arrow" aria-hidden="true">→</span></>}</button><p>入力・思考・検索などは別料金。生成はボタンを押した時だけ実行します。</p></div>
            <section className="panel-section batch-section"><button className="section-toggle" onClick={() => setBatchOpen(v => !v)}><span><FilePlus2 size={16} /> Batch生成</span><ChevronDown size={16} className={batchOpen ? 'rotated' : ''} /></button>{batchOpen && <div className="batch-body"><p>1行に1つの指示を入力。最大20件。Batchでは検索と参照素材を使いません。</p><textarea aria-label="Batch生成の指示" value={batchText} onChange={e => setBatchText(e.target.value)} placeholder="夕暮れの都市\n淡い緑の森" rows={3} /><button className="secondary-button" disabled={busy} onClick={() => void startBatch()}>Batchを開始</button><label className="batch-id-label">既存のBatch ID</label><div className="batch-id-row"><input aria-label="Batch ID" value={batchId} onChange={e => setBatchId(e.target.value)} placeholder="batches/…" /><button disabled={busy} onClick={loadBatchId}>読込</button></div>{batchJob && <div className="batch-result"><span>{batchJob.state} · {batchJob.images.length}枚 · エラー {batchJob.errors}</span><div className="batch-actions"><button onClick={() => void refreshBatch()}><RotateCcw size={14} /> 更新</button><button onClick={() => void cancelBatch()} disabled={['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(batchJob.state.replace('BATCH_STATE_', ''))}>中止</button></div><div className="batch-thumbs">{batchJob.images.map((image, i) => <button key={i} onClick={() => void adoptBatchImage(image.dataUrl)}><img src={image.dataUrl} alt={`Batch結果 ${i + 1}`} /><span>採用</span></button>)}</div></div>}</div>}</section>
            <div className="panel-footer"><CircleHelp size={15} /><span>キーはこのタブ内の一時メモリで扱います。画像やプロジェクトにキーは含まれません。</span></div>
            </>}
            {rightTab === 'layers' && <section className="panel-section layers-section"><div className="section-head"><span><Layers3 size={16} /> レイヤー</span><span>{project.layers.length} 件</span></div><div className="layers-list">{[...project.layers].reverse().map(layer => <div key={layer.id} className={`layer-row ${selectedLayer === layer.id ? 'active' : ''}`} onClick={() => setSelectedLayer(layer.id)}><button className="layer-eye" title={layer.visible ? '非表示' : '表示'} aria-label={`${layer.name}を${layer.visible ? '非表示' : '表示'}`} onClick={e => { e.stopPropagation(); updateLayer(layer.id, l => ({ ...l, visible: !l.visible })); }}>{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}</button><img src={layer.dataUrl} alt="" /><div className="layer-main"><strong>{layer.name}</strong><small>{Math.round(layer.opacity * 100)}% · 画像レイヤー</small></div><div className="layer-arrows"><button title="前面に移動" aria-label="前面に移動" onClick={e => { e.stopPropagation(); updateProject(p => { const layers = [...p.layers]; const i = layers.findIndex(l => l.id === layer.id); if (i < layers.length - 1) [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; return { ...p, layers }; }); }}><ArrowUp size={12} /></button><button title="背面に移動" aria-label="背面に移動" onClick={e => { e.stopPropagation(); updateProject(p => { const layers = [...p.layers]; const i = layers.findIndex(l => l.id === layer.id); if (i > 0) [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; return { ...p, layers }; }); }}><ArrowDown size={12} /></button></div></div>)}{selectedLayer && project.layers.some(l => l.id === selectedLayer) && <div className="layer-options"><label>不透明度 <input aria-label="レイヤー不透明度" type="range" min="0" max="100" value={Math.round((project.layers.find(l => l.id === selectedLayer)?.opacity || 0) * 100)} onChange={e => updateLayer(selectedLayer, l => ({ ...l, opacity: Number(e.target.value) / 100 }))} /></label><button aria-label="レイヤーを削除" onClick={() => { updateProject(p => ({ ...p, layers: p.layers.filter(l => l.id !== selectedLayer) })); setSelectedLayer(null); }}><Trash2 size={15} /></button></div>}<button className="reference-add" onClick={() => layerFileRef.current?.click()}><Plus size={17} /> 画像レイヤーを追加</button></div></section>}
            {rightTab === 'history' && <section className="panel-section"><div className="section-head"><span><Undo2 size={16} /> 編集履歴</span><span>{h.items.length} ステップ</span></div><div className="right-history">{h.items.map((item, index) => <button key={index} className={index === h.index ? 'selected' : ''} onClick={() => restoreHistory(index)}><span>{String(index + 1).padStart(2, '0')}</span>{index === 0 ? '開始' : item.project.layers.at(-1)?.name || '編集'}</button>)}</div></section>}
          </div>
        </aside>
      </div>

      {error && <div className="toast-error" role="alert"><span>{error}</span><button aria-label="エラーを閉じる" onClick={() => setError('')}><X size={17} /></button></div>}
      {keyOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setKeyOpen(false); }}><div className="modal key-modal" role="dialog" aria-modal="true" aria-label="Gemini APIキーの設定"><button className="modal-close" aria-label="閉じる" onClick={() => setKeyOpen(false)}><X size={20} /></button><div className="modal-icon"><LockKeyhole size={24} /></div><span className="eyebrow">YOUR KEY, YOUR CONTROL</span><h2>自分のキーで、自由に創作。</h2><p>Gemini APIキーはこのタブの一時メモリにのみ保持します。ブラウザの保存領域、プロジェクト、履歴には保存しません。接続解除またはタブを閉じると破棄されます。</p>{keyConnected ? <div className="key-connected-card"><Check size={18} /> キーは設定済みです。キーの値は表示できません。</div> : <><label htmlFor="gemini-key">Gemini APIキー</label><input ref={keyRef} id="gemini-key" type="password" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="gemini-key-temporary" placeholder="APIキーを入力" onKeyDown={e => { if (e.key === 'Enter') void connectKey(); }} /><button className="generate-button" onClick={() => void connectKey()}><KeyRound size={17} /> このタブに設定する</button></>}{keyConnected && <button className="secondary-button danger" onClick={disconnectKey}>キーを破棄して切断</button>}<a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">Google AI Studioでキーを取得 ↗</a><small>自分のAPIキーでの生成にはGoogle側の利用料金がかかる場合があります。共有端末では利用後に接続を解除してください。</small></div></div>}
      {candidate && <div className="modal-backdrop candidate-backdrop"><div className="candidate-modal" role="dialog" aria-modal="true" aria-label="生成結果の確認"><div className="candidate-header"><div><span className="eyebrow">RESULT PREVIEW</span><h2>生成された候補</h2></div><button className="modal-close" aria-label="候補を閉じる" onClick={() => setCandidate(null)}><X size={21} /></button></div>{isStale && <div className="stale-warning">生成中にキャンバスが変更されました。採用すると現在の編集を置き換えます。</div>}<div className="candidate-view"><img src={candidate.image} alt="Nano Banana 2.1が生成した候補" /></div><div className="candidate-body"><p>{candidate.result.text || candidate.prompt}</p>{candidate.result.citations.length > 0 && <div className="citation-list">参照：{candidate.result.citations.map((cite, i) => <a key={i} href={cite.url} target="_blank" rel="noopener noreferrer">{cite.title || cite.url}</a>)}</div>}{candidate.result.suggestions.length > 0 && <div className="citation-list">検索の提案：{candidate.result.suggestions.map((cite, i) => <a key={i} href={cite.url} target="_blank" rel="noopener noreferrer">{cite.title || cite.url}</a>)}</div>}{candidate.result.searchHtml && <iframe className="search-suggestions" title="Google検索の提案" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{background:#fff;color:#222;font:12px sans-serif;margin:8px}</style>${candidate.result.searchHtml}`} />}</div><div className="candidate-actions"><button className="secondary-button" onClick={() => setCandidate(null)}>破棄</button><button className="generate-button" onClick={() => void adoptCandidate()}><Check size={18} /> キャンバスに採用</button></div></div></div>}
    </div>
  );
}
