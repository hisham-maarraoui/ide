require('dotenv').config();

const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');
const marked = require('marked');
const fs = require('fs');
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

// Function to get or create Groq client
function getGroqClient() {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('Groq API key not configured. Please add your API key in settings.');
    }
    if (!groqClient) {
        groqClient = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });
    }
    return groqClient;
}

// Update the OpenRouter base URL and headers
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
async function callOpenRouter(model, messages, temperature) {
    try {
        const fetch = require('node-fetch');

        console.log('OpenRouter Request Details:', {
            url: OPENROUTER_BASE_URL,
            model,
            messageCount: messages.length,
            apiKeyPresent: !!process.env.OPENROUTER_API_KEY
        });

        const requestBody = {
            model: model,
            messages: messages,
            temperature: temperature,
            max_tokens: 4000,  // Use a more conservative max_tokens value
            stream: false
        };

        console.log('OpenRouter Full Request Body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(OPENROUTER_BASE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Code Assistant'
            },
            body: JSON.stringify(requestBody)
        });

        const responseData = await response.json();
        console.log('OpenRouter Raw Response:', JSON.stringify(responseData, null, 2));

        if (!response.ok) {
            if (responseData.error?.message?.includes('More credits are required')) {
                throw new Error('OpenRouter credit limit reached. Please upgrade your account.');
            }
            console.error('OpenRouter Error Details:', responseData);
            throw new Error(responseData.error?.message || `OpenRouter API error: ${response.status}`);
        }

        // Return the raw response - OpenRouter should return a standard format
        return responseData;
    } catch (error) {
        console.error('OpenRouter Call Failed:', {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            model,
            requestDetails: {
                url: OPENROUTER_BASE_URL,
                messageCount: messages?.length
            }
        });
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

    try {
        const { message, context } = req.body;
        console.log('Received request with model:', modelId);

        // Get the model first
        const model = AVAILABLE_MODELS[modelId];
        if (!model) {
            throw new Error('Invalid model selected');
        }

        // Then check API keys
        if (model.provider === 'groq' && !process.env.GROQ_API_KEY) {
            throw new Error('Groq API key not configured. Please add your API key in settings.');
        }
        if (model.provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
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
            try {
                completion = await getGroqClient().chat.completions.create({
                    model: modelId.replace('groq/', ''),
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: model.context_length
                });
            } catch (error) {
                console.error('Groq API Error:', error);
                throw new Error(`Groq API error: ${error.message}`);
            }
        } else if (model.provider === 'openrouter') {
            completion = await callOpenRouter(modelId, messages, 0.1);
        }

        const responseContent = formatCodeBlocks(completion.choices[0].message.content);

        console.log('Response received for model:', modelId);
        console.log('Response:', responseContent);

        res.json({ response: responseContent });
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

// Update the update-keys endpoint
app.post('/api/update-keys', (req, res) => {
    const { groq_api_key, openrouter_api_key } = req.body;

    try {
        // Update environment variables
        if (groq_api_key) {
            process.env.GROQ_API_KEY = groq_api_key;
            // Reset the client so it will be recreated with new key
            groqClient = null;
            console.log('Groq API key updated');
        }
        if (openrouter_api_key) {
            process.env.OPENROUTER_API_KEY = openrouter_api_key;
            console.log('OpenRouter API key updated');
        }

        // Update .env file
        const envPath = path.join(__dirname, '.env');
        let envContent = '';

        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Update or add GROQ_API_KEY
        if (groq_api_key) {
            if (envContent.includes('GROQ_API_KEY=')) {
                envContent = envContent.replace(/GROQ_API_KEY=.*\n?/, `GROQ_API_KEY=${groq_api_key}\n`);
            } else {
                envContent += `\nGROQ_API_KEY=${groq_api_key}`;
            }
        }

        // Update or add OPENROUTER_API_KEY
        if (openrouter_api_key) {
            if (envContent.includes('OPENROUTER_API_KEY=')) {
                envContent = envContent.replace(/OPENROUTER_API_KEY=.*\n?/, `OPENROUTER_API_KEY=${openrouter_api_key}\n`);
            } else {
                envContent += `\nOPENROUTER_API_KEY=${openrouter_api_key}`;
            }
        }

        fs.writeFileSync(envPath, envContent.trim() + '\n');

        // Verify the keys are set
        console.log('API Keys Status:', {
            groqKeyPresent: !!process.env.GROQ_API_KEY,
            openRouterKeyPresent: !!process.env.OPENROUTER_API_KEY
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating API keys:', error);
        res.status(500).json({
            error: 'Failed to update API keys',
            details: error.message
        });
    }
});

// Add a debug endpoint to check API key status
app.get('/api/check-keys', (req, res) => {
    res.json({
        groqKeyPresent: !!process.env.GROQ_API_KEY,
        openRouterKeyPresent: !!process.env.OPENROUTER_API_KEY
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('GROQ_API_KEY present:', !!process.env.GROQ_API_KEY);
    console.log('NODE_ENV:', process.env.NODE_ENV);
}); 