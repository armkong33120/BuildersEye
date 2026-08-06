// localEmbedder.js — Local embedding (multilingual-e5-small) รองรับภาษาไทย ไม่ต้องเสียค่า API
// โมเดลดาวน์โหลดครั้งแรก (~120MB) แล้ว cache ไว้ใช้ offline ได้
// ตรงแผน Brain Selector: นี่คือ "สมอง B (Local)" สำหรับ embedding
// หมายเหตุ: เป็น optionalDependency — บน cloud image ไม่มีโมดูลนี้ → isEmbedderAvailable() = false
const MODEL_NAME = 'Xenova/multilingual-e5-small';

let _extractor = null;
let _unavailable = false;

export function isEmbedderAvailable() {
  return !_unavailable;
}

export async function getEmbedder() {
  if (_unavailable) throw new Error('Local embedder not available on this deployment');
  if (!_extractor) {
    let pipeline, env;
    try {
      ({ pipeline, env } = await import('@xenova/transformers'));
    } catch {
      _unavailable = true;
      throw new Error('@xenova/transformers not installed on this deployment (optional dep)');
    }
    env.allowLocalModels = true;
    _extractor = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
  }
  return _extractor;
}

// e5 ต้องใส่ prefix "query: " / "passage: " ตามสเปกของโมเดล
export async function embedTexts(texts, { isQuery = false } = {}) {
  const extractor = await getEmbedder();
  const prefixed = texts.map(t => (isQuery ? 'query: ' : 'passage: ') + t);
  const output = await extractor(prefixed, { pooling: 'mean', normalize: true });
  return output.tolist(); // number[][]
}

export async function embedOne(text, opts) {
  const [vec] = await embedTexts([text], opts);
  return vec;
}
