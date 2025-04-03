// gemini-proxy-worker.js

// 辅助函数：将 OpenAI messages 转换为 Gemini contents
function convertToGeminiMessages(messages) {
  const geminiMessages = [];
  let currentRole = "user"; // Gemini API 需要 user 和 model 交替

  for (const message of messages) {
    let role = message.role.toLowerCase();
    // 处理 system prompt
    if (role === "system") {
       // Gemini API v1 beta 不直接支持 system role, 将其内容附加到下一个 user message
       // 或者可以考虑将其作为单独的 user message 发送，但这可能不符合预期
       // 这里我们选择忽略 system message 或尝试合并，但最简单是要求用户不要发送 system message
       // 为了兼容性，暂时将其视为 user message
       role = "user";
    }

    // 映射角色: OpenAI 的 'assistant' 对应 Gemini 的 'model'
    if (role === "assistant") {
      role = "model";
    } else {
      role = "user"; // 其他角色（如 system, function）都映射为 user 或根据需要处理
    }

    // Gemini API 要求 user/model 严格交替，且必须以 user 开始
    // 确保以 user 开始
    if (geminiMessages.length === 0 && role === 'model') {
        // 插入一个空的 user message 来满足 Gemini 的要求
        // 这可能不是最佳实践，但能避免 Gemini API 报错
        geminiMessages.push({ role: 'user', parts: [{ text: '' }] });
        console.warn("Inserted empty user message to start with user role for Gemini API.");
    }
    // 检查角色交替
    else if (geminiMessages.length > 0 && geminiMessages[geminiMessages.length - 1].role === role) {
       // 如果角色重复，发出警告。Gemini 通常不允许连续的相同角色。
       // 应用程序应确保发送交替的角色。
       console.warn(`Warning: Consecutive messages with the same role ('${role}') detected. Gemini API might reject this request or behave unexpectedly.`);
       // 可以选择抛出错误强制要求输入正确:
       // throw new Error(`Invalid message sequence: Consecutive messages with the same role ('${role}')`);
    }

    geminiMessages.push({
      role: role,
      parts: [{ text: message.content }], // 假设 content 总是 string
    });
    currentRole = role;
  }
  return geminiMessages;
}

// 辅助函数：将 Gemini finishReason 转换为 OpenAI finish_reason
function mapFinishReason(geminiReason) {
  switch (geminiReason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'content_filter';
    case 'RECITATION':
      // OpenAI 没有直接对应 'RECITATION'，可以映射为 'stop' 或自定义值
      return 'stop'; // 或者 'recitation_policy'
    case 'OTHER':
    default:
      // 对于未知或未处理的原因，映射为 'stop'
      return 'stop';
  }
}

export default {
  async fetch(request, env /*, ctx */) { // 移除了 ctx 参数
    // 只接受 POST 请求
    if (request.method !== 'POST') {
      return new Response('Expected POST method', { status: 405, headers: { 'Allow': 'POST' } });
    }

    // 验证 Authorization 头是否存在且格式正确 (Bearer <token>)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errorResponse = { error: { message: 'Missing or invalid Authorization header. Provide your Gemini API Key as a Bearer token.', type: 'invalid_request_error', param: null, code: 'missing_api_key' } };
      return new Response(JSON.stringify(errorResponse), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // 提取 Gemini API Key
    const geminiApiKey = authHeader.substring(7).trim();
    if (!geminiApiKey) {
        const errorResponse = { error: { message: 'Invalid Authorization header. Bearer token is empty.', type: 'invalid_request_error', param: null, code: 'empty_api_key' } };
        return new Response(JSON.stringify(errorResponse), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }


    let openAIRequestBody;
    try {
      // 解析请求体为 JSON
      openAIRequestBody = await request.json();
    } catch (e) {
      const errorResponse = { error: { message: 'Failed to parse JSON body.', type: 'invalid_request_error', param: null, code: 'invalid_json' } };
      return new Response(JSON.stringify(errorResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // 验证请求体中必需的字段
    if (!openAIRequestBody.model || !Array.isArray(openAIRequestBody.messages) || openAIRequestBody.messages.length === 0) {
        const errorResponse = { error: { message: 'Missing required fields in JSON body: "model" and a non-empty "messages" array are required.', type: 'invalid_request_error', param: null, code: 'missing_fields' } };
        return new Response(JSON.stringify(errorResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // 当前实现不支持流式响应
    if (openAIRequestBody.stream) {
        const errorResponse = { error: { message: 'Streaming responses are not supported in this proxy version.', type: 'invalid_request_error', param: 'stream', code: 'streaming_not_supported' } };
        return new Response(JSON.stringify(errorResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let geminiMessages;
    try {
        // 转换消息格式
        geminiMessages = convertToGeminiMessages(openAIRequestBody.messages);
    } catch (error) {
        const errorResponse = { error: { message: `Failed to convert messages: ${error.message}`, type: 'invalid_request_error', param: 'messages', code: 'message_conversion_failed' } };
        return new Response(JSON.stringify(errorResponse), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // 构建 Gemini API 请求体
    const geminiRequestBody = {
      contents: geminiMessages,
      generationConfig: {
        // 映射 OpenAI 参数到 Gemini 参数
        temperature: openAIRequestBody.temperature ?? 0.7, // 提供默认值
        maxOutputTokens: openAIRequestBody.max_tokens, // 直接映射
        // topP: openAIRequestBody.top_p, // 如果需要，添加映射
        // topK: openAIRequestBody.top_k, // 如果需要，添加映射
        // stopSequences: openAIRequestBody.stop // 需要映射
      },
      // safetySettings: [...] // 可以根据需要添加安全设置
    };

    // 直接使用 OpenAI 请求中指定的模型名称，假设用户会提供 Gemini 模型名
    // 例如 'gemini-1.5-pro-latest', 'gemini-pro' 等
    const geminiModel = openAIRequestBody.model;
    // 构造 Gemini API URL
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

    try {
      // 发送请求到 Gemini API
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequestBody),
      });

      // 处理 Gemini API 的错误响应
      if (!geminiResponse.ok) {
        const errorBodyText = await geminiResponse.text();
        console.error(`Gemini API Error (${geminiResponse.status}): ${errorBodyText}`);
        let errorJson = { message: `Gemini API request failed with status ${geminiResponse.status}.`, details: errorBodyText };
        try {
            // 尝试解析 Gemini 返回的错误详情
            const parsedError = JSON.parse(errorBodyText);
            if (parsedError.error) {
                errorJson.message = parsedError.error.message || errorJson.message;
                errorJson.details = parsedError.error; // 保留完整的 Gemini 错误对象
            }
        } catch(e) { /* 忽略 JSON 解析错误 */ }

        // 返回符合 OpenAI 错误格式的响应
        const errorResponseToClient = { error: { message: errorJson.message, type: 'api_error', param: null, code: `gemini_${geminiResponse.status}`, details: errorJson.details } };
        return new Response(JSON.stringify(errorResponseToClient), { status: geminiResponse.status, headers: { 'Content-Type': 'application/json' } });
      }

      // 解析 Gemini API 的成功响应
      const geminiResponseBody = await geminiResponse.json();

      // 检查 Gemini 响应是否有效和包含内容
      if (!geminiResponseBody.candidates || geminiResponseBody.candidates.length === 0 || !geminiResponseBody.candidates[0].content || !geminiResponseBody.candidates[0].content.parts || geminiResponseBody.candidates[0].content.parts.length === 0) {
          const finishReason = geminiResponseBody.candidates?.[0]?.finishReason ?? 'unknown';
          let message = `Gemini response was empty or invalid. Finish reason: ${finishReason}`;
          if (finishReason === 'SAFETY') {
              message = 'Content generation stopped due to safety settings.';
          } else if (finishReason === 'RECITATION') {
              message = 'Content generation stopped due to recitation policy.';
          }
          // 返回错误信息给客户端
          const errorResponse = { error: { message: message, type: 'api_error', param: null, code: `gemini_empty_response_${finishReason.toLowerCase()}` } };
          // 使用 500 Internal Server Error 或 400 Bad Request 可能更合适
          return new Response(JSON.stringify(errorResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // 将 Gemini 响应转换为 OpenAI 格式
      const openAIResponseBody = {
        id: `chatcmpl-${Date.now()}${Math.random().toString(36).substring(2)}`, // 生成一个唯一的响应 ID
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000), // 当前时间戳 (秒)
        model: openAIRequestBody.model, // 返回请求中使用的模型名称
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              // 合并 Gemini 可能返回的多个 parts
              content: geminiResponseBody.candidates[0].content.parts.map(part => part.text).join('').trim(),
            },
            // 映射停止原因
            finish_reason: mapFinishReason(geminiResponseBody.candidates[0].finishReason),
          },
        ],
        usage: {
          // 映射 token 使用情况
          prompt_tokens: geminiResponseBody.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: geminiResponseBody.usageMetadata?.candidatesTokenCount ?? 0,
          total_tokens: geminiResponseBody.usageMetadata?.totalTokenCount ?? 0,
        },
      };

      // 返回 OpenAI 格式的响应
      return new Response(JSON.stringify(openAIResponseBody), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // 处理 fetch 或其他意外错误
      console.error('Internal proxy error:', error);
      const errorResponse = { error: { message: `Internal server error: ${error.message}`, type: 'api_error', param: null, code: 'internal_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
};
