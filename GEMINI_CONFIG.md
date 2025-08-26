# Gemini AI Configuration Guide

## Quick Setup

1. **Get API Key**: Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Create `.env` file** in the root directory
3. **Add configuration**:

```env
GEMINI_API_KEY=your_actual_api_key_here
GEMINI_MODEL=gemini-1.5-flash
GEMINI_TEMPERATURE=0.7
GEMINI_MAX_TOKENS=4000
```

## Supported Models

| Model | Speed | Capability | Use Case |
|-------|-------|------------|----------|
| `gemini-1.5-flash` | ⚡ Fastest | 🟡 Good | **Recommended for most users** |
| `gemini-1.5-pro` | 🐌 Slower | 🟢 Best | Use for complex projects |

## ⚠️ Important Notes

- **`gemini-pro` is DEPRECATED** and will cause "Model not found" errors
- Always use `gemini-1.5-flash` or `gemini-1.5-pro`
- The server will automatically fall back to `gemini-1.5-flash` if an invalid model is specified

## Troubleshooting

### Error: "Model not found"
```
❌ AI generation failed: [404 Not Found] models/gemini-pro is not found
```

**Solution**: Update your `.env` file to use a supported model:
```env
GEMINI_MODEL=gemini-1.5-flash
```

### Error: "No Gemini API key found"
**Solution**: Ensure your `.env` file exists and contains:
```env
GEMINI_API_KEY=your_actual_api_key_here
```

### Error: "AI generation failed"
**Solutions**:
1. Check API key validity
2. Verify network connectivity
3. Check [Google AI Studio status](https://status.ai.google.com/)

## Fallback System

If AI generation fails, GitGen automatically falls back to:
- Template-based README generation
- Code analysis and feature detection
- Professional formatting and structure

Your projects will still generate documentation even without AI!

## Testing

After configuration, test your setup:
1. Start the server: `npm start`
2. Check logs for: `✅ Gemini AI initialized successfully`
3. Try creating a project with AI generation enabled

## Support

- Check the main README for general usage
- Review server logs for detailed error messages
- Ensure you're using the latest version of GitGen
