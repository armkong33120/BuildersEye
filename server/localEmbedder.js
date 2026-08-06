// localEmbedder.js — Local embedding (multilingual-e5-small) รองรับภาษาไทย ไม่ต้องเสียค่า API
// โมเดลดาวน์โหลดครั้งแรก (~120MB) แล้ว cache ไว้ใช้ offline ได้
// ตรงแผน Brain Selector: นี่คือ "สมอง B (Local)" สำหรับ embedding
const MODEL_NAME = 'Xenova/multilingual-e5-small';

let _extractor = null;

export async function getEmbedder() {
  if (!_extractor) {
    const { pipeline, env } = await import('@xenova/transformers');
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
