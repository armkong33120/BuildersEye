# BuildersEye backend — production image for Azure Container Apps
# Context: repo ROOT (server ต้องอ่าน ../src/data สำหรับ fallback data + identity-graph)
# base = slim (Debian/glibc) เพราะ onnxruntime-node (optional dep) ไม่มี musl build สำหรับ alpine
FROM node:20-slim

# onnxruntime-node ต้องการ libgomp (OpenMP) — slim ไม่มี → ถ้าไม่ลง process จะ segfault ตอนโหลดโมเดล
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ติดตั้ง deps ก่อน (cache layer)
# หมายเหตุ: รวม optional deps (@xenova/transformers) ด้วย — cloud ต้อง embed query สำหรับ semantic search
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# โค้ด server + ข้อมูล fallback ที่ commit ไว้ (identity-graph + hr_onedrive_demo)
COPY server/ ./server/
COPY src/data/ ./src/data/

# pre-bake embedding model เข้า image (กัน cold start ต้องโหลด 120MB ทุกครั้ง)
ENV EMBED_CACHE_DIR=/models
RUN cd server && node -e "import('./localEmbedder.js').then(m => m.getEmbedder()).then(() => console.log('[build] embedding model cached')).catch(e => { console.warn('[build] model pre-cache skipped:', e.message); })"

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "index.js"]
