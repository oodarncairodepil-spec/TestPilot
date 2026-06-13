FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /workspace

COPY package.json /workspace/package.json
RUN npm install --no-audit --no-fund
RUN npx playwright install
RUN npx playwright install-deps

