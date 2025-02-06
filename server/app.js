const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');
const marked = require('marked');
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

// Initialize Groq client with explicit apiKey object
const client = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        console.log('Received request:', { message, context });

        if (!message || !context) {
            throw new Error('Missing message or context');
        }

        console.log('Sending request to Groq...');
        const completion = await client.chat.completions.create({
            model: "mixtral-8x7b-32768",
            messages: [
                {
                    role: "system",
                    content: `You are a helpful programming assistant. Always format code suggestions as markdown code blocks with language tags. For example:
                    
                    \`\`\`python
                    def example():
                        return "Hello World"
                    \`\`\`
                    
                    Always use proper markdown formatting and include the language tag.`
                },
                {
                    role: "user",
                    content: `Current code:\n\`\`\`${context.language}\n${context.code}\n\`\`\`\n\nUser question: ${message}`
                }
            ],
            temperature: 0.5,
            max_tokens: 4096
        });

        const responseContent = completion.choices[0].message.content;
        console.log('Groq response received:', responseContent);

        res.json({ response: responseContent });
    } catch (error) {
        console.error('Detailed Groq API Error:', error);
        res.status(500).json({
            error: 'Failed to get AI response',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
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