# 构建阶段：安装依赖并产出 dist（前端 + 打包后的后端 boot.js）
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：同一目录直接启动（.env 中含数据库等配置，dotenv 自动加载）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "start"]
