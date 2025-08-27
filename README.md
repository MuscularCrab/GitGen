# GitGen - Git Documentation Generator

A modern, feature-rich alternative to gitdocify.com that automatically generates comprehensive documentation from Git repositories.

## 🚀 Features

- **Automatic Documentation Generation**: Connect any Git repository and get instant documentation
- **Multi-Language Support**: Supports JavaScript, TypeScript, Python, Java, C++, C#, PHP, Ruby, Go, Rust, Swift, and more
- **Smart Code Analysis**: Automatically extracts functions, classes, and code structure
- **Beautiful UI**: Modern, responsive interface built with React and Tailwind CSS
- **Real-time Processing**: Live status updates and progress tracking
- **Repository Structure Analysis**: Complete file tree and organization overview
- **README Integration**: Automatically processes and displays README files
- **Export & Share**: Download and share documentation with your team

## 🐳 Quick Start with Docker

**Fastest way to get GitGen running:**

```bash
# Clone the repository
git clone <your-repo-url>
cd gitgen

# Build and run with Docker (recommended)
sudo docker build -f Dockerfile.working -t gitgen .
sudo docker run -p 3030:3030 --name gitgen-container gitgen

# Open your browser
# Web Interface: http://localhost:3030
# Health Check: http://localhost:3030/api/health
```

**Alternative: Use Docker Compose**
```bash
sudo docker-compose up -d
```

See the [Deployment section](#-deployment) for detailed Docker instructions and troubleshooting.

## 🏗️ Architecture

- **Backend**: Node.js with Express.js
- **Frontend**: React 18 with modern hooks and context
- **Styling**: Tailwind CSS for beautiful, responsive design
- **Git Integration**: Simple-git for repository cloning and analysis
- **Markdown Processing**: Marked.js with syntax highlighting
- **State Management**: React Context API for global state

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- Git installed on the system

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd gitgen
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Start the development server**
   ```bash
   # Terminal 1 - Start backend
   npm run dev
   
   # Terminal 2 - Start frontend
   cd client
   npm start
   ```

4. **Open your browser**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

## 🚀 Production Build

```bash
# Build the React app
npm run build

# Start production server
npm start
```

## 📖 Usage

### 1. Create a New Project
- Navigate to the home page
- Enter your Git repository URL (supports GitHub, GitLab, Bitbucket, etc.)
- Click "Generate Documentation" - the AI will analyze everything automatically

### 2. Monitor Progress
- Real-time status updates during processing
- Progress indicators for repository analysis (Clone → Analyze → Scan → Process → Generate → Complete)
- Automatic polling for completion status

### 3. View Documentation
- **Overview**: Project statistics and summary
- **File Structure**: Interactive repository tree
- **File Details**: Code analysis with functions and classes
- **README**: Processed markdown content
- **Generated README**: AI-powered README generation

### 4. Export & Share
- Download documentation in various formats
- Share with team members
- Embed in other documentation systems

## 🧪 Debug & Testing

Access the debug page at `/debug` to test API connections and backend functionality:

- **API Connection Test**: Verify backend connectivity
- **Health Check**: Test backend health endpoints
- **Git Functionality**: Test repository operations
- **Project Creation**: Test project workflow
- **System Information**: View current configuration

## 📝 TODO List

### 🚀 **High Priority**
- [ ] **Performance Optimization**: Implement caching for large repositories
- [ ] **Batch Processing**: Support for processing multiple repositories simultaneously
- [ ] **Real-time Collaboration**: Live updates when multiple users view the same project
- [ ] **Advanced Search**: Full-text search across all project documentation
- [ ] **Custom Templates**: Allow users to create custom README templates

### 🔧 **Medium Priority**
- [x] **Plugin System**: Extensible architecture for custom analyzers
- [x] **API Rate Limiting**: Implement proper rate limiting for external services
- [x] **Webhook Support**: GitHub/GitLab webhooks for automatic updates
- [x] **User Authentication**: User accounts and project management
- [x] **Team Collaboration**: Shared projects and team permissions
- [x] **Export Formats**: Support for PDF, Word, and other document formats
- [x] **Internationalization**: Multi-language support for the UI

### 📊 **Enhancement Features**
- [ ] **Analytics Dashboard**: Project usage statistics and insights
- [ ] **Code Quality Metrics**: Integration with tools like SonarQube
- [ ] **Dependency Analysis**: Security vulnerability scanning
- [ ] **Architecture Diagrams**: Automatic generation of system architecture
- [ ] **API Documentation**: OpenAPI/Swagger generation for API projects
- [ ] **Database Schema**: Automatic database schema documentation
- [ ] **Deployment Guides**: Platform-specific deployment instructions

### 🎨 **UI/UX Improvements**
- [ ] **Dark Mode**: Complete dark theme implementation
- [ ] **Mobile App**: React Native mobile application
- [ ] **Keyboard Shortcuts**: Power user keyboard navigation
- [ ] **Drag & Drop**: File upload and repository import
- [ ] **Customizable Dashboard**: User-configurable project overview
- [ ] **Progress Animations**: Enhanced loading and progress indicators

### 🔒 **Security & Compliance**
- [ ] **Audit Logging**: Comprehensive activity logging
- [ ] **Data Encryption**: Encrypt sensitive project data
- [ ] **GDPR Compliance**: Data privacy and user consent management
- [ ] **SSO Integration**: Single sign-on with enterprise systems
- [ ] **Role-based Access Control**: Granular permission system

### 📚 **Documentation & Support**
- [ ] **API Documentation**: Complete API reference with examples
- [ ] **Video Tutorials**: Step-by-step video guides
- [ ] **Community Forum**: User community and support platform
- [ ] **Integration Guides**: Third-party service integrations
- [ ] **Best Practices**: Documentation standards and guidelines

---

**Contributing**: We welcome contributions! Check out our [Contributing Guidelines](CONTRIBUTING.md) for more details.

**Access URL**: `http://localhost:3000/debug` (or your deployed domain + `/debug`)

> **Note**: The debug page includes comprehensive testing tools for troubleshooting API issues, Git operations, and project creation workflows. Use this page to diagnose any connectivity or functionality problems.

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
PORT=3001
NODE_ENV=development
```

### Gemini AI Configuration (Optional)
For AI-powered README generation, add these variables:

```env
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-1.5-flash
GEMINI_TEMPERATURE=0.7
GEMINI_MAX_TOKENS=4000
```

**Important**: Use `gemini-1.5-flash` (fastest) or `gemini-1.5-pro` (most capable). The old `gemini-pro` model is deprecated and no longer supported.

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

### Supported Git Hosts
- GitHub (https://github.com/username/repo)
- GitLab (https://gitlab.com/username/repo)
- Bitbucket (https://bitbucket.org/username/repo)
- Any Git-compatible hosting service

## 🏗️ Project Structure

```
gitgen/
├── server.js              # Express server and API endpoints
├── package.json           # Backend dependencies
├── client/                # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components (Home, Projects, ProjectDetail, Debug)
│   │   ├── context/       # React context for state management
│   │   └── App.js         # Main application component
│   ├── public/            # Static assets
│   └── package.json       # Frontend dependencies
└── README.md              # This file
```

## 🧪 Testing

```bash
# Run backend tests
npm test

# Run frontend tests
cd client
npm test
```

## 🔍 Troubleshooting

### AI Generation Issues
If you encounter "Model not found" errors:

1. **Check your model name**: Use `gemini-1.5-flash` or `gemini-1.5-pro`
2. **Verify API key**: Ensure `GEMINI_API_KEY` is set correctly
3. **Check API status**: Visit [Google AI Studio](https://makersuite.google.com/app/apikey) to verify service status
4. **Fallback**: Template generation will still work without AI

### Common Error Messages
- **"Model not found"**: Update `GEMINI_MODEL` to use supported models
- **"No Gemini API key found"**: Set `GEMINI_API_KEY` in your `.env` file
- **"AI generation failed"**: Check API key validity and network connectivity

## 🚀 Deployment

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3001
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with modern web technologies
- Inspired by the need for better documentation tools
- Community contributions and feedback

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/gitgen/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/gitgen/discussions)
- **Email**: support@gitgen.com

## 🔮 Roadmap

- [ ] PDF export functionality
- [ ] API documentation generation
- [ ] Team collaboration features
- [ ] Custom documentation templates
- [ ] Integration with CI/CD pipelines
- [ ] Advanced code analysis
- [ ] Multi-repository support
- [ ] Documentation versioning

---

**GitGen** - Making documentation generation effortless and beautiful. 🚀