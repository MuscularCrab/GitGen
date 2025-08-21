# DocuFlow - Git Documentation Generator

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
   cd docuflow
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
- Provide a project name and optional description
- Click "Generate Documentation"

### 2. Monitor Progress
- Real-time status updates during processing
- Progress indicators for repository analysis
- Automatic polling for completion status

### 3. View Documentation
- **Overview**: Project statistics and summary
- **File Structure**: Interactive repository tree
- **File Details**: Code analysis with functions and classes
- **README**: Processed markdown content

### 4. Export & Share
- Download documentation in various formats
- Share with team members
- Embed in other documentation systems

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
PORT=3001
NODE_ENV=development
```

### Supported Git Hosts
- GitHub (https://github.com/username/repo)
- GitLab (https://gitlab.com/username/repo)
- Bitbucket (https://bitbucket.org/username/repo)
- Any Git-compatible hosting service

## 🏗️ Project Structure

```
docuflow/
├── server.js              # Express server and API endpoints
├── package.json           # Backend dependencies
├── client/                # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
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

- **Issues**: [GitHub Issues](https://github.com/yourusername/docuflow/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/docuflow/discussions)
- **Email**: support@docuflow.com

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

**DocuFlow** - Making documentation generation effortless and beautiful. 🚀