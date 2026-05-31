# Imagem oficial do Playwright — já inclui todas as dependências do Chromium
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copia dependências primeiro para aproveitar cache de camadas do Docker
COPY package*.json ./
RUN npm ci --omit=dev

# Instala apenas o Chromium (Firefox e WebKit não são necessários)
RUN npx playwright install chromium --with-deps

# Cria o diretório de dados persistentes e cede ao usuário não-root da imagem
# /data é montado como volume no EasyPanel para sobreviver a restarts
RUN mkdir -p /data/prints && chown -R pwuser:pwuser /data

COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Usuário não-root (padrão da imagem Playwright)
USER pwuser

CMD ["node", "src/server.js"]
