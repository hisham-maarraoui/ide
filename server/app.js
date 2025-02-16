const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');
const marked = require('marked');
const fetch = require('node-fetch');  // Make sure this is at the top with other requires

const app = express();

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Add these lines after the CORS middleware
app.use(express.static(path.join(__dirname, '..'))); // Serve files from parent directory

// Initialize variables to store API clients
let groqClient = null;

// Add this near the top of the file with other constants
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Define available models with their providers
const AVAILABLE_MODELS = {
    // Groq Models
    'groq/mixtral-8x7b-32768': {
        name: 'Mixtral 8x7B',
        description: 'Powerful open-source model with large 32K context window',
        context_length: 32768,
        provider: 'groq',
        default: false
    },
    'groq/deepseek-r1-distill-llama-70b': {
        name: 'DeepSeek R1 Distill LLaMA 70B (Think Tags Removed)',
        description: 'DeepSeek R1 Distill LLaMA 70B',
        context_length: 32768,
        provider: 'groq',
        default: true
    },
    // OpenRouter Models
    'anthropic/claude-3-haiku': {
        name: 'Claude 3 Haiku',
        description: 'Fast and efficient Claude model',
        context_length: 4096,
        provider: 'openrouter',
        default: false
    },
    'deepseek/deepseek-chat:free': {
        name: 'DeepSeek V3',
        description: 'Latest DeepSeek model with strong instruction following and coding abilities',
        context_length: 131072,
        provider: 'openrouter',
        default: false
    },
    'openai/o3-mini-high': {
        name: 'O3 Mini High',
        description: 'Cost-efficient model optimized for STEM reasoning with high reasoning effort',
        context_length: 200000,
        provider: 'openrouter',
        default: false
    }
};

// Function to make OpenRouter API calls
async function callOpenRouter(model, messages, temperature, apiKey) {
    try {
        const response = await fetch(OPENROUTER_BASE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Code Assistant'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                max_tokens: 4000,
                stream: false
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `OpenRouter API error: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error('OpenRouter Call Failed:', error);
        throw error;
    }
}

// Add this helper function to format code blocks
function formatCodeBlocks(content) {
    // Regular expression to match both formatted and unformatted code blocks
    const codeBlockRegex = /(?:```(\w+)?\n([\s\S]*?)```)|(?:Here's the code:?\n+([\s\S]*?)(?:\n\n|$))/g;

    let formattedContent = content;
    let match;

    // Replace all code blocks with properly formatted ones
    while ((match = codeBlockRegex.exec(content)) !== null) {
        const language = match[1] || 'python';  // Default to python if no language specified
        const code = match[2] || match[3];      // Use either formatted or unformatted code

        // Replace the matched code block with properly formatted version
        const formattedBlock = `\`\`\`${language}\n${code.trim()}\n\`\`\``;
        formattedContent = formattedContent.replace(match[0], formattedBlock);
    }

    return formattedContent
        .replace(/<\/?(?:MODEL|CODE|ANSWER)>/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

app.post('/api/chat', async (req, res) => {
    const modelId = req.body.model || 'groq/mixtral-8x7b-32768';
    const { message, context, groq_api_key, openrouter_api_key } = req.body;

    try {
        const model = AVAILABLE_MODELS[modelId];
        if (!model) {
            throw new Error('Invalid model selected');
        }

        // Check API keys from request
        if (model.provider === 'groq' && !groq_api_key) {
            throw new Error('Groq API key not configured. Please add your API key in settings.');
        }
        if (model.provider === 'openrouter' && !openrouter_api_key) {
            throw new Error('OpenRouter API key not configured. Please add your API key in settings.');
        }

        const messages = [
            {
                role: "system",
                content: `You are an intelligent programming assistant. You help users understand and improve their code.

When asked about who you are, introduce yourself naturally.

When helping with code:
1. Be clear and concise
2. Provide practical solutions
3. Explain your suggestions when helpful
4. Use code blocks with appropriate language tags
5. Focus on best practices and readability`
            },
            {
                role: "user",
                content: `Current code:\n\`\`\`${context.language}\n${context.code}\n\`\`\`\n\nUser question: ${message}`
            }
        ];

        let completion;
        if (model.provider === 'groq') {
            const client = new Groq({ apiKey: groq_api_key });
            completion = await client.chat.completions.create({
                model: modelId.replace('groq/', ''),
                messages: messages,
                temperature: 0.1,
                max_tokens: model.context_length
            });
        } else if (model.provider === 'openrouter') {
            completion = await callOpenRouter(modelId, messages, 0.1, openrouter_api_key);
        }

        res.json({ response: formatCodeBlocks(completion.choices[0].message.content) });
    } catch (error) {
        console.error('Error with model:', modelId, error);
        res.status(500).json({
            error: 'Failed to get AI response',
            details: error.message,
            model: modelId
        });
    }
});

app.get('/api/models', (req, res) => {
    res.json(AVAILABLE_MODELS);
});

// Add a root route handler
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('GROQ_API_KEY present:', !!process.env.GROQ_API_KEY);
    console.log('NODE_ENV:', process.env.NODE_ENV);
}); 