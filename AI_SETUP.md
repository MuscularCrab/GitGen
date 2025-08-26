# AI-Powered README Generation Setup

GitGen now supports AI-powered README generation using Google's Gemini AI! This feature automatically generates intelligent, project-specific README files based on your code analysis.

## Features

- **🤖 AI-Powered Generation**: Uses Gemini AI to create unique, context-aware READMEs
- **📝 Smart Fallback**: Falls back to template-based generation if AI is unavailable
- **🔧 No Dependencies**: Works without installing additional packages
- **⚡ Conditional Loading**: Only loads AI when configured

## Setup Instructions

### 1. Get a Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key

### 2. Configure Environment Variables

Create a `.env` file in your project root:

```bash
# Gemini AI Configuration
GEMINI_API_KEY=your_actual_api_key_here

# Optional AI Settings
GEMINI_MODEL=gemini-1.5-flash
GEMINI_TEMPERATURE=0.7
GEMINI_MAX_TOKENS=4000

# Server Configuration
PORT=3030
NODE_ENV=development
```

### 3. Install AI Dependencies (Optional)

If you want to install the AI packages locally for development:

```bash
npm install @google/generative-ai dotenv
```

**Note**: This is optional! GitGen will work without these packages, falling back to template-based generation.

## How It Works

### AI Generation Process

1. **Code Analysis**: Analyzes your repository structure, languages, and code patterns
2. **AI Prompt Construction**: Builds a comprehensive prompt with project context
3. **Gemini AI Call**: Sends the prompt to Gemini AI for intelligent generation
4. **Content Validation**: Ensures the generated content meets quality standards
5. **Fallback**: Falls back to template generation if AI fails

### AI Prompt Includes

- Project name, description, version, author, license
- Detected languages and technologies
- File structure and code samples
- Feature detection (frameworks, databases, APIs, etc.)
- Design patterns and architectural approaches

### Fallback System

If AI generation fails or is unavailable, GitGen automatically falls back to:
- Intelligent template-based generation
- Code analysis and feature detection
- Context-aware installation and usage commands
- Professional formatting and structure

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | Required | Your Gemini API key |
| `GEMINI_MODEL` | `gemini-1.5-flash` | AI model to use (gemini-1.5-flash or gemini-1.5-pro) |
| `GEMINI_TEMPERATURE` | `0.7` | Creativity level (0.0-1.0) |
| `GEMINI_MAX_TOKENS` | `4000` | Maximum response length |

## Troubleshooting

### AI Not Working?

1. **Check API Key**: Ensure `GEMINI_API_KEY` is set correctly
2. **Verify Package**: Check if `@google/generative-ai` is available
3. **Check Logs**: Look for AI initialization messages in server logs
4. **Fallback**: Template generation will still work

### Common Issues

- **"No Gemini API key found"**: Set `GEMINI_API_KEY` in your `.env` file
- **"Gemini AI package not installed"**: Install with `npm install @google/generative-ai`
- **"AI generation failed"**: Check API key validity and network connectivity
- **"Model not found"**: Use `gemini-1.5-flash` or `gemini-1.5-pro` (gemini-pro is deprecated)

## Benefits

### AI-Powered Generation
- **Unique Content**: Each README is tailored to your specific project
- **Intelligent Analysis**: Understands your code structure and patterns
- **Professional Quality**: Generates GitHub-ready documentation
- **Context Awareness**: Adapts to your project's technologies and features

### Template Fallback
- **Reliable**: Always works, even without AI
- **Fast**: Quick generation for simple projects
- **Consistent**: Maintains professional formatting standards
- **Customizable**: Easy to modify and extend

## Example Output

### AI-Generated README
```markdown
# DeDupe - Video Frame Extraction & Duplicate Removal

A sophisticated Windows application that extracts frames from video files at specified frame rates and intelligently removes duplicate frames using advanced similarity algorithms.

## Features
- **Video Processing**: Supports multiple video formats (MP4, AVI, MOV)
- **Frame Extraction**: Configurable frame rate extraction
- **Duplicate Detection**: AI-powered similarity analysis
- **GUI Interface**: User-friendly Windows application
- **Batch Processing**: Handle multiple files efficiently

## Technologies
- **C#/.NET**: Modern Windows development framework
- **OpenCV**: Computer vision and image processing
- **WPF**: Rich desktop user interface
- **FFmpeg**: Video file handling and conversion
```

### Template-Generated README
```markdown
# DeDupe

A software project with video processing capabilities.

## Features
- Multi-language support: C#, XML
- 15 source files
- 3 directories
- Modern architecture
- Easy to use
```

## Support

- **Documentation**: Check the main README for general usage
- **Issues**: Report problems on GitHub
- **AI Setup**: Use this guide for Gemini AI configuration
- **Fallback**: Template generation works without any setup

---

**Note**: AI generation requires a valid Gemini API key. Template generation works without any additional configuration.
