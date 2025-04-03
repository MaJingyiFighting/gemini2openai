# Gemini to OpenAI Proxy Worker (中文 / English)

## 简介 (Introduction)

这是一个 Cloudflare Worker 代理，用于将 OpenAI API 请求转换为 Google Gemini API 请求，并将响应转换回来。
(This is a Cloudflare Worker proxy that converts OpenAI API requests to Google Gemini API requests and transforms the responses back.)

## 功能 (Features)

*   转换 OpenAI 消息格式到 Gemini 格式 (Converts OpenAI message format to Gemini format)
*   映射 API 参数 (Maps API parameters)
*   处理错误响应 (Handles error responses)
*   支持 API Key 认证 (Supports API Key authentication)
*   支持流式响应 (Supports streaming responses)

## 使用方法 (Usage)

1.  **部署 (Deploy):** 将 `gemini-proxy-worker.js` 的内容手动部署到 Cloudflare Worker。 (Manually deploy the content of `gemini-proxy-worker.js` to a Cloudflare Worker.)
2.  **请求 (Request):** 向 Worker 端点发送 POST 请求。 (Send POST requests to the worker endpoint.)
    *   **Header:** `Authorization: Bearer YOUR_GEMINI_API_KEY`
    *   **Body:** 使用 OpenAI Chat Completions API 格式。 (Use OpenAI Chat Completions API format.)

## 注意 (Notes)

*   系统消息会合并到首个用户消息前。 (System messages are merged before the first user message.)
*   部分 OpenAI 参数可能无直接对应。 (Some OpenAI parameters may lack direct equivalents.)
