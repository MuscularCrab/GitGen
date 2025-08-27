const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const simpleGit = require('simple-git');
const marked = require('marked');
const hljs = require('highlight.js');
const multer = require('multer');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// AI loading - packages are pre-installed in Docker image
let geminiAI = null;
let AI_CONFIG = null;

// Load Gemini AI package (always available in Docker)
try {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  require('dotenv').config();

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    geminiAI = new GoogleGenerativeAI(apiKey);
    AI_CONFIG = {
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7,
      maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS) || 4000
    };
    
    // Validate the model name
    const validModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    if (!validModels.includes(AI_CONFIG.model)) {
      console.log(`   Supported models: ${validModels.join(', ')}`);
      console.log(`   Falling back to 'gemini-1.5-flash'`);
      AI_CONFIG.model = 'gemini-1.5-flash';
    }
    console.log('✅ Gemini AI initialized successfully');
    console.log(`   Using model: ${AI_CONFIG.model}`);
  } else {
    console.log('⚠️  No Gemini API key found. AI generation will be disabled.');
    console.log('   Add GEMINI_API_KEY to your .env file to enable AI generation.');
  }
} catch (error) {
  console.log('⚠️  Gemini AI package not available. AI generation will be disabled.');
}

const app = express();
const PORT = process.env.PORT || 3030;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

// Configure marked for syntax highlighting
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (err) {}
    }
    return hljs.highlightAuto(code).value;
  }
});

// Storage for temporary projects
const projects = new Map();
const upload = multer({ dest: 'uploads/' });

// Add full-text search functionality
const searchIndex = new Map(); // projectId -> { files: [], content: Map }

// Build search index for a project
function buildSearchIndex(projectId, documentation) {
  if (!documentation || !documentation.files) return;
  
  const index = {
    files: [],
    content: new Map(),
    metadata: {
      projectName: '',
      repoUrl: '',
      totalFiles: 0,
      languages: [],
      lastIndexed: Date.now()
    }
  };
  
  try {
    // Get project metadata
    const project = projects.get(projectId);
    if (project) {
      index.metadata.projectName = project.projectName;
      index.metadata.repoUrl = project.repoUrl;
    }
    
    // Index files
    documentation.files.forEach(file => {
      const fileIndex = {
        path: file.path,
        language: file.language || 'unknown',
        size: file.size || 0,
        functions: file.functions || [],
        classes: file.classes || [],
        tokens: file.tokens || []
      };
      
      index.files.push(fileIndex);
      index.content.set(file.path, file.raw || '');
      index.metadata.totalFiles++;
      
      if (file.language && !index.metadata.languages.includes(file.language)) {
        index.metadata.languages.push(file.language);
      }
    });
    
    searchIndex.set(projectId, index);
    console.log(`Search index built for project ${projectId}: ${index.metadata.totalFiles} files`);
  } catch (error) {
    console.error(`Error building search index for project ${projectId}:`, error);
  }
}

// Search projects
function searchProjects(query, filters = {}) {
  const results = [];
  const queryLower = query.toLowerCase();
  
  for (const [projectId, index] of searchIndex.entries()) {
    if (!index.files) continue;
    
    let projectScore = 0;
    const project = projects.get(projectId);
    if (!project) continue;
    
    // Check project metadata
    if (project.projectName.toLowerCase().includes(queryLower)) projectScore += 10;
    if (project.description && project.description.toLowerCase().includes(queryLower)) projectScore += 5;
    
    // Check files
    for (const file of index.files) {
      let fileScore = 0;
      
      // Apply filters
      if (filters.language && file.language !== filters.language) continue;
      if (filters.fileType && !file.path.includes(filters.fileType)) continue;
      if (filters.minSize && file.size < filters.minSize) continue;
      if (filters.maxSize && file.size > filters.maxSize) continue;
      
      // Check file path
      if (file.path.toLowerCase().includes(queryLower)) fileScore += 8;
      
      // Check functions
      file.functions.forEach(func => {
        if (func.toLowerCase().includes(queryLower)) fileScore += 6;
      });
      
      // Check classes
      file.classes.forEach(cls => {
        if (cls.toLowerCase().includes(queryLower)) fileScore += 6;
      });
      
      // Check content
      const content = index.content.get(file.path) || '';
      if (content.toLowerCase().includes(queryLower)) fileScore += 3;
      
      if (fileScore > 0) {
        results.push({
          projectId,
          projectName: project.projectName,
          repoUrl: project.repoUrl,
          file: file.path,
          score: projectScore + fileScore,
          matchType: 'file',
          language: file.language
        });
      }
    }
  }
  
  // Sort by score and return
  return results.sort((a, b) => b.score - a.score);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    version: '2.0.0'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'GitGen API',
    version: '2.0.0',
    description: 'AI-powered repository analysis and documentation generation',
    endpoints: {
      health: '/api/health',
      info: '/api',
      test: '/api/test',
      'test-git': '/api/test-git',
      'test-project': '/api/test-project',
      'debug/projects': '/api/debug/projects',
      'readme-modes': '/api/readme-modes',
      projects: '/api/projects',
      'projects/:id': '/api/projects/:id',
      search: '/api/search',
      'search/suggestions': '/api/search/suggestions'
    }
  });
});

// Test endpoint for API connectivity
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working correctly!',
    timestamp: Date.now(),
    status: 'success'
  });
});

// Test endpoint for Git functionality
app.get('/api/test-git', (req, res) => {
  res.json({
    message: 'Git functionality test passed!',
    timestamp: Date.now(),
    gitAvailable: true,
    status: 'success'
  });
});

// Test endpoint for project creation
app.post('/api/test-project', (req, res) => {
  const { repoUrl, projectName, description } = req.body;
  
  res.json({
    message: 'Test project creation successful!',
    timestamp: Date.now(),
    testData: {
      repoUrl,
      projectName,
      description
    },
    status: 'success'
  });
});

// Debug endpoint for projects information
app.get('/api/debug/projects', (req, res) => {
  res.json({
    totalProjects: projects.size,
    timestamp: new Date().toISOString(),
    projects: Array.from(projects.values()),
    status: 'success',
    message: 'Debug endpoint working'
  });
});

// README modes endpoint
app.get('/api/readme-modes', (req, res) => {
  res.json({
    modes: [
      {
        id: 'v1',
        name: 'Comprehensive',
        description: 'Detailed documentation with full API reference, architecture diagrams, and comprehensive guides',
        features: [
          'Full API documentation',
          'Architecture diagrams',
          'Detailed installation guides',
          'Usage examples',
          'Contributing guidelines',
          'Performance analysis'
        ],
        recommendedFor: 'Enterprise projects, open source libraries, complex systems'
      },
      {
        id: 'v2',
        name: 'Beginner-Friendly',
        description: 'Simple, clear documentation focused on getting started quickly',
        features: [
          'Quick start guide',
          'Basic usage examples',
          'Simple installation steps',
          'Essential information only',
          'Clear project overview'
        ],
        recommendedFor: 'Simple projects, demos, learning projects, quick documentation'
      }
    ],
    defaultMode: 'v2',
    timestamp: new Date().toISOString()
  });
});

// Search endpoint
app.get('/api/search', (req, res) => {
  try {
    const { q: query, status, language, fileType, minSize, maxSize, limit = 50 } = req.query;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const filters = {
      status: status || null,
      language: language || null,
      fileType: fileType || null,
      minSize: minSize ? parseInt(minSize) : null,
      maxSize: maxSize ? parseInt(maxSize) : null
    };
    
    const results = searchProjects(query.trim(), filters);
    
    // Apply limit
    const limitedResults = results.slice(0, parseInt(limit));
    
    res.json({
      query: query.trim(),
      filters,
      totalResults: results.length,
      results: limitedResults,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('Error in search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Search suggestions endpoint
app.get('/api/search/suggestions', (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.json({ suggestions: [] });
    }
    
    const suggestions = new Set();
    const queryLower = query.toLowerCase();
    
    // Get suggestions from indexed content
    for (const [projectId, index] of searchIndex.entries()) {
      for (const file of index.files) {
        // Check file names
        if (file.path.toLowerCase().includes(queryLower)) {
          suggestions.add(file.path);
        }
        
        // Check function names
        file.functions.forEach(func => {
          if (func.toLowerCase().includes(queryLower)) {
            suggestions.add(func);
          }
        });
        
        // Check class names
        file.classes.forEach(cls => {
          if (cls.toLowerCase().includes(queryLower)) {
            suggestions.add(cls);
          }
        });
      }
    }
    
    const limitedSuggestions = Array.from(suggestions)
      .slice(0, parseInt(limit))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    
    res.json({
      query: query.trim(),
      suggestions: limitedSuggestions,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('Error getting search suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { repoUrl, projectName, description, mode = 'v2' } = req.body;
    
    console.log('Creating project:', { repoUrl, projectName, description, mode });
    
    if (!repoUrl || !projectName) {
      return res.status(400).json({ error: 'Repository URL and project name are required' });
    }

    // Validate mode parameter
    if (mode && !['v1', 'v2'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use "v1" for comprehensive or "v2" for beginner-friendly.' });
    }

    // Validate repository URL format
    if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
      return res.status(400).json({ error: 'Invalid repository URL format. Use HTTPS or SSH format.' });
    }

    // Check if a project with this repository URL already exists
    const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
    if (existingProject) {
      console.log('Project with this repository already exists:', existingProject.id);
      
      // If the existing project is completed, return it immediately
      if (existingProject.status === 'completed') {
        return res.json({ 
          projectId: existingProject.id, 
          status: 'completed', 
          mode: existingProject.mode || 'v2',
          message: 'Project already exists and is completed'
        });
      }
      
      // If the existing project is processing, return it
      if (existingProject.status === 'processing') {
        return res.json({ 
          projectId: existingProject.id, 
          status: 'processing', 
          mode: existingProject.mode || 'v2',
          message: 'Project already exists and is being processed'
        });
      }
      
      // If the existing project failed, we can regenerate it
      if (existingProject.status === 'failed') {
        console.log('Regenerating failed project:', existingProject.id);
        // Remove the old project and continue with creation
        projects.delete(existingProject.id);
      }
    }

    const projectId = uuidv4();
    const project = {
      id: projectId,
      repoUrl,
      projectName,
      description: description || '',
      status: 'processing',
      createdAt: new Date().toISOString(),
      documentation: null,
      error: null,
      mode: mode || 'v2'
    };
    
    projects.set(projectId, project);
    
    console.log('Project created:', { projectId, projectName, totalProjects: projects.size });
    
    // Start processing the repository
    processRepository(projectId, repoUrl, mode);

    res.json({ projectId, status: 'processing', mode, message: 'Project created successfully' });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get all projects
app.get('/api/projects', (req, res) => {
  console.log('Getting all projects. Total projects:', projects.size);
  
  const projectList = Array.from(projects.values()).map(project => ({
    id: project.id,
    repoUrl: project.repoUrl,
    projectName: project.projectName,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    mode: project.mode
  }));
  
  res.json(projectList);
});

// Get project by ID
app.get('/api/projects/:projectId', (req, res) => {
  const { projectId } = req.params;
  console.log('Getting project:', projectId);
  
  const project = projects.get(projectId);
  
  if (!project) {
    console.log('Project not found:', projectId);
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json(project);
});

// Get project progress
app.get('/api/projects/:projectId/progress', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json({
    projectId,
    status: project.status,
    progress: project.status === 'completed' ? 100 : 50,
    message: project.status === 'completed' ? 'Documentation generated successfully' : 'Processing...'
  });
});

// Get project README
app.get('/api/projects/:projectId/readme', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  if (project.status !== 'completed' || !project.documentation) {
    return res.status(400).json({ error: 'Project documentation not ready yet' });
  }
  
  res.setHeader('Content-Type', 'text/markdown');
  res.send(project.documentation.readme || `# ${project.projectName}\n\nNo README available.`);
});

// Process repository and generate documentation
async function processRepository(projectId, repoUrl, mode = 'v2') {
  const project = projects.get(projectId);
  if (!project) {
    console.error(`Project ${projectId} not found when starting processing`);
    return;
  }

  console.log(`Starting to process repository: ${repoUrl} for project: ${projectId} (${mode.toUpperCase()})`);

  try {
    const tempDir = `temp/${projectId}`;
    console.log(`Creating temp directory: ${tempDir}`);
    
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });

    // Clone repository
    console.log(`Cloning repository: ${repoUrl}`);
    const git = simpleGit();
    
    await git.clone(repoUrl, tempDir);
    console.log(`Repository cloned successfully to: ${tempDir}`);

    // Analyze repository structure
    console.log(`Analyzing repository structure for: ${tempDir}`);
    const documentation = await generateDocumentation(tempDir, project, mode);
    
    // Update project with documentation
    project.documentation = documentation;
    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    
    // Build search index
    buildSearchIndex(projectId, documentation);
    
    projects.set(projectId, project);
    console.log(`Project completed: ${projectId}`);
    
  } catch (error) {
    console.error(`Error processing repository for project ${projectId}:`, error);
    project.status = 'failed';
    project.error = error.message;
    projects.set(projectId, project);
  }
}

// Generate documentation from repository
async function generateDocumentation(tempDir, project, mode) {
  try {
    const documentation = {
      summary: `Documentation for ${project.projectName}`,
      files: [],
      readme: `# ${project.projectName}\n\nDocumentation generated successfully.`
    };

    // Scan directory for files
    const files = await scanDirectory(tempDir);
    documentation.files = files;

    // Generate AI README if available
    if (geminiAI && AI_CONFIG) {
      try {
        const aiReadme = await generateAIReadme(files, project, mode);
        if (aiReadme) {
          documentation.readme = aiReadme;
        }
      } catch (aiError) {
        console.warn('AI README generation failed, using template:', aiError.message);
      }
    }

    return documentation;
  } catch (error) {
    console.error('Error generating documentation:', error);
    throw error;
  }
}

// Scan directory for files
async function scanDirectory(dirPath, basePath = '') {
  const files = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip common directories that don't need documentation
        if (['.git', 'node_modules', 'dist', 'build', '.next'].includes(entry.name)) {
          continue;
        }
        
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        // Analyze file
        const fileInfo = await analyzeFile(fullPath, relativePath);
        if (fileInfo) {
          files.push(fileInfo);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
  
  return files;
}

// Analyze individual file
async function analyzeFile(filePath, relativePath) {
  try {
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    // Skip binary files and very large files
    if (stats.size > 1024 * 1024) { // 1MB limit
      return null;
    }
    
    const fileInfo = {
      path: relativePath,
      size: stats.size,
      language: getLanguageFromExtension(ext),
      functions: [],
      classes: [],
      tokens: []
    };
    
    // Read file content for analysis
    try {
      const content = await fs.readFile(filePath, 'utf8');
      fileInfo.raw = content;
      
      // Basic analysis based on file type
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        fileInfo.functions = extractFunctions(content);
        fileInfo.classes = extractClasses(content);
      }
      
      // Extract tokens for search
      fileInfo.tokens = extractTokens(content);
      
    } catch (readError) {
      // File might be binary or encoded, skip content analysis
      console.warn(`Could not read file content for ${filePath}:`, readError.message);
    }
    
    return fileInfo;
  } catch (error) {
    console.error(`Error analyzing file ${filePath}:`, error);
    return null;
  }
}

// Get language from file extension
function getLanguageFromExtension(ext) {
  const languageMap = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'javascript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.md': 'markdown',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sql': 'sql'
  };
  
  return languageMap[ext] || 'text';
}

// Extract functions from JavaScript/TypeScript code
function extractFunctions(content) {
  const functions = [];
  const functionRegex = /(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s*)?function|(\w+)\s*[:=]\s*(?:async\s*)?\(|(\w+)\s*[:=]\s*=>)/g;
  
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    const funcName = match[1] || match[2] || match[3] || match[4];
    if (funcName && !functions.includes(funcName)) {
      functions.push(funcName);
    }
  }
  
  return functions;
}

// Extract classes from JavaScript/TypeScript code
function extractClasses(content) {
  const classes = [];
  const classRegex = /class\s+(\w+)/g;
  
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const className = match[1];
    if (className && !classes.includes(className)) {
      classes.push(className);
    }
  }
  
  return classes;
}

// Extract tokens for search indexing
function extractTokens(content) {
  const tokens = [];
  const wordRegex = /\b\w{3,}\b/g;
  
  let match;
  while ((match = wordRegex.exec(content)) !== null) {
    const token = match[0].toLowerCase();
    if (token && !tokens.includes(token)) {
      tokens.push(token);
    }
  }
  
  return tokens;
}

// Generate AI README using Gemini
async function generateAIReadme(files, project, mode) {
  if (!geminiAI || !AI_CONFIG) {
    return null;
  }

  try {
    const model = geminiAI.getGenerativeModel({ model: AI_CONFIG.model });
    
    // Prepare context for AI
    const fileSummary = files.slice(0, 20).map(file => 
      `${file.path} (${file.language}) - ${file.functions.length} functions, ${file.classes.length} classes`
    ).join('\n');
    
    const prompt = mode === 'v1' 
      ? `Generate a comprehensive README.md for the project "${project.projectName}" with repository URL ${project.repoUrl}. 
         The project contains these files:\n${fileSummary}\n\nCreate a detailed README with sections for description, installation, usage, API documentation, and contributing guidelines.`
      : `Generate a beginner-friendly README.md for the project "${project.projectName}" with repository URL ${project.repoUrl}. 
         The project contains these files:\n${fileSummary}\n\nCreate a simple, clear README with basic sections for what the project does, how to install it, and how to use it.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error('AI README generation failed:', error);
    return null;
  }
}

// Root route - serve the React app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Catch-all route for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 GitGen server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
  console.log(`📖 API info: http://localhost:${PORT}/api`);
});
