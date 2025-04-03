// Gemini to OpenAI API Proxy Worker: Converts requests/responses between OpenAI and Gemini formats.
// (代理Worker：在OpenAI和Gemini格式间转换请求/响应。)

/** Converts OpenAI messages to Gemini contents. (转换OpenAI消息为Gemini内容。) */
function convertToGeminiMessages(messages) {
  const geminiMessages = [];
  let systemMessages = []; // Collect system messages (收集系统消息)
  let currentRole = "user";

  for (const message of messages) {
    let role = message.role.toLowerCase();
    let content = message.content || '';
    
    // Handle system messages: merge before first user message (处理系统消息：合并到首个用户消息前)
    if (role === "system") {
      systemMessages.push(content);
      continue;
    }

    // Merge system messages if it's the first user message (如果是首个用户消息，合并系统消息)
    if (role === "user" && systemMessages.length > 0 && geminiMessages.length === 0) {
      content = systemMessages.join('\n\n') + '\n\n' + content;
      systemMessages = []; // Clear merged system messages (清空已合并的系统消息)
    }

    // Map roles (映射角色)
    if (role === "assistant") {
      role = "model";
    } else {
      role = "user";
    }

    // Ensure alternating roles (确保角色交替)
    if (geminiMessages.length === 0 && role === 'model') {
      // Start with user if first message is model (如果首消息是模型，则以用户开始)
      geminiMessages.push({ role: 'user', parts: [{ text: '' }] }); 
    } else if (geminiMessages.length > 0 && geminiMessages[geminiMessages.length - 1].role === role) {
      // Warn if consecutive messages have the same role (如果连续消息角色相同则警告)
      console.warn(`Warning: Consecutive messages with the same role ('${role}')`);
    }

    geminiMessages.push({
      role: role,
      parts: [{ text: content }],
    });
    currentRole = role;
  }

  return geminiMessages;
}

/**
/** Handles streaming Gemini response to OpenAI format. (处理流式Gemini响应到OpenAI格式。) */
async function handleStreamingResponse(geminiResponse, openAIRequestBody) {
  const reader = geminiResponse.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const geminiData = JSON.parse(chunk);
        
        // Convert to OpenAI stream format (转换为OpenAI流式格式)
        const openAIChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: openAIRequestBody.model,
          choices: [{
            index: 0,
            delta: {
              content: geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '', // 安全访问 (Safe access)
            },
            finish_reason: geminiData.candidates?.[0]?.finishReason 
              ? mapFinishReason(geminiData.candidates[0].finishReason) 
              : null, // 安全访问 (Safe access)
          }]
        };
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

// Main worker entry point (主Worker入口点)
export default {
  /** Handles incoming HTTP requests. (处理传入的HTTP请求。) */
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Expected POST method', { status: 405, headers: { 'Allow': 'POST' } }); // 只接受POST (Only accept POST)
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errorResponse = { error: { message: 'Missing or invalid Authorization header', type: 'invalid_request_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 401 });
    }
    
    const geminiApiKey = authHeader.substring(7).trim();
    let openAIRequestBody;
    
    try {
      openAIRequestBody = await request.json();
    } catch (e) {
      const errorResponse = { error: { message: 'Invalid JSON', type: 'invalid_request_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 400 }); // 无效JSON (Invalid JSON)
    }

    // Validate required fields (验证必需字段)
    if (!openAIRequestBody.model || !Array.isArray(openAIRequestBody.messages)) {
      const errorResponse = { error: { message: 'Missing required fields', type: 'invalid_request_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 400 }); // 缺少字段 (Missing fields)
    }

    // Convert message format (转换消息格式)
    let geminiMessages;
    try {
      geminiMessages = convertToGeminiMessages(openAIRequestBody.messages);
    } catch (error) {
      const errorResponse = { error: { message: `Message conversion failed: ${error.message}`, type: 'invalid_request_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 400 }); // 转换失败 (Conversion failed)
    }

    // Build Gemini request body (构建Gemini请求体)
    const geminiRequestBody = {
      contents: geminiMessages,
      generationConfig: {
        temperature: openAIRequestBody.temperature ?? 0.7,
        maxOutputTokens: openAIRequestBody.max_tokens,
      }
    };

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${openAIRequestBody.model}:streamGenerateContent?key=${geminiApiKey}`;

    try {
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        const errorResponse = { error: { message: `Gemini API error: ${errorText}`, type: 'api_error' } };
        return new Response(JSON.stringify(errorResponse), { status: geminiResponse.status }); // Gemini API错误 (Gemini API error)
      }

      // Handle streaming response (处理流式响应)
      if (openAIRequestBody.stream) {
        return handleStreamingResponse(geminiResponse, openAIRequestBody);
      }

      // Handle non-streaming response (处理非流式响应)
      const geminiResponseBody = await geminiResponse.json();
      
      // Convert to OpenAI format (转换为OpenAI格式)
      const openAIResponseBody = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: openAIRequestBody.model,
        choices: [{
          message: {
            role: 'assistant',
            content: geminiResponseBody.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '', // 安全访问 (Safe access)
          },
          finish_reason: geminiResponseBody.candidates?.[0]?.finishReason 
            ? mapFinishReason(geminiResponseBody.candidates[0].finishReason) 
            : 'stop', // 安全访问 (Safe access)
        }],
        usage: {
          prompt_tokens: geminiResponseBody.usageMetadata?.promptTokenCount ?? 0, // 安全访问 (Safe access)
          completion_tokens: geminiResponseBody.usageMetadata?.candidatesTokenCount ?? 0, // 安全访问 (Safe access)
          total_tokens: geminiResponseBody.usageMetadata?.totalTokenCount ?? 0, // 安全访问 (Safe access)
        }
      };

      return new Response(JSON.stringify(openAIResponseBody), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      const errorResponse = { error: { message: `Internal error: ${error.message}`, type: 'api_error' } };
      return new Response(JSON.stringify(errorResponse), { status: 500 });
    }
  },
};

/**
/** Maps Gemini finish reasons to OpenAI ones. (映射Gemini结束原因到OpenAI。) */
function mapFinishReason(geminiReason) {
  switch (geminiReason) {
    case 'STOP': return 'stop'; // 正常停止 (Normal stop)
    case 'MAX_TOKENS': return 'length'; // 达到最大令牌 (Max tokens reached)
    case 'SAFETY': return 'content_filter'; // 安全原因 (Safety reasons)
    default: return 'stop'; // 默认为停止 (Default to stop)
  }
}
