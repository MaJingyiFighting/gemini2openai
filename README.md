# Gemini to OpenAI Proxy Worker

这是一个 Cloudflare Worker 脚本，它充当代理服务器，接收符合 OpenAI Chat Completions API 格式的请求，将其转换为 Google Gemini API 格式，并将 Gemini 的响应转换回 OpenAI 格式。

## 功能

*   将 OpenAI 格式的 `messages` 转换为 Gemini 格式的 `contents`。
