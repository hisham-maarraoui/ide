const AI_API_URL = 'http://localhost:3000/api/chat'; // Update this to your actual server URL

export async function getChatResponse(message, context, model = 'mixtral-8x7b-32768') {
    console.log('Sending request with model:', model); // Add debug log
    try {
        console.log('Sending request to AI service:', { message, context });

        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message, context, model })
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);

        if (!response.ok) {
            throw new Error(data.details || data.error || 'Failed to get AI response');
        }

        if (!data.response) {
            throw new Error('No response received from AI service');
        }

        return data.response;
    } catch (error) {
        console.error('AI Service Error:', error);
        throw error;
    }
} 