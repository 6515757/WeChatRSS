FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install --production=false

# 复制源码并构建
COPY . .
RUN npm run build

# 复制静态文件到 dist
RUN cp -r src/public dist/public

# 生产依赖
RUN npm prune --production

EXPOSE 3000

# 创建数据目录
RUN mkdir -p /app/data

CMD ["node", "dist/index.js"]
