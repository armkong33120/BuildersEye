# BuildersEye backend — production image for Azure Container Apps
# Context: repo ROOT (server ต้องอ่าน ../src/data สำหรับ fallback data + identity-graph)
FROM node:20-alpine

WORKDIR /app

# ติดตั้ง deps ก่อน (cache layer) — omit optional (@xenova/transformers/onnxruntime ไม่จำเป็นบน cloud)
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --omit=optional

# โค้ด server + ข้อมูล fallback ที่ commit ไว้ (identity-graph + hr_onedrive_demo)
COPY server/ ./server/
COPY src/data/ ./src/data/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "index.js"]
