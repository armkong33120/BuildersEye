# BuildersEye backend — production image for Azure Container Apps
# Context: repo ROOT (server ต้องอ่าน ../src/data สำหรับ fallback data + identity-graph)
# base = slim (Debian/glibc) เพราะ onnxruntime-node (optional dep) ไม่มี musl build สำหรับ alpine
FROM node:20-slim

WORKDIR /app

# ติดตั้ง deps ก่อน (cache layer)
# หมายเหตุ: รวม optional deps (@xenova/transformers) ด้วย — cloud ต้อง embed query สำหรับ semantic search
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# โค้ด server + ข้อมูล fallback ที่ commit ไว้ (identity-graph + hr_onedrive_demo)
COPY server/ ./server/
COPY src/data/ ./src/data/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "index.js"]
