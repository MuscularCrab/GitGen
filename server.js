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
const cheerio = require('cheerio');

// AI loading - packages are pre-installed in Docker image
let geminiAI = null;
let AI_CONFIG = null;

// Load Gemini AI package (always available in Docker)
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
  console.log('✅ Gemini AI initialized successfully');
  console.log(`   Using model: ${AI_CONFIG.model}`);
} else {
  console.log('⚠️  No Gemini API key found. AI generation will be disabled.');
  console.log('   Add GEMINI_API_KEY to your .env file to enable AI generation.');
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

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'GitGen' });
});

// Test endpoint for debugging
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ 
    message: 'Backend is working!', 
    timestamp: new Date().toISOString(),
    projectsCount: projects.size
  });
});

// Simple status endpoint
app.get('/api/status', (req, res) => {
  console.log('Status endpoint called');
  res.json({ 
    status: 'running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Test Git endpoint (without actual cloning)
app.get('/api/test-git', (req, res) => {
  console.log('Test Git endpoint called');
  try {
    const git = simpleGit();
    res.json({ 
      message: 'Git is available',
      gitVersion: 'simple-git package loaded',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Git not available',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test project creation (without Git operations)
app.post('/api/test-project', async (req, res) => {
  console.log('Test project creation called');
  try {
    const { repoUrl, projectName, description } = req.body;
    
    if (!repoUrl || !projectName) {
      return res.status(400).json({ error: 'Repository URL and project name are required' });
    }

    const projectId = uuidv4();
    const project = {
      id: projectId,
      repoUrl,
      projectName,
      description: description || '',
      status: 'completed', // Mark as completed immediately for testing
      createdAt: new Date().toISOString(),
      documentation: {
        readme: 'This is a test project',
        files: ['test.js'],
        structure: { src: ['test.js'] },
        summary: 'Test project for debugging'
      },
      completedAt: new Date().toISOString(),
      error: null
    };

    projects.set(projectId, project);
    res.json({ projectId, status: 'completed', project });
    
  } catch (error) {
    console.error('Error creating test project:', error);
    res.status(500).json({ error: 'Failed to create test project' });
  }
});

// Create new documentation project
app.post('/api/projects', async (req, res) => {
  try {
    const { repoUrl, projectName, description } = req.body;
    
    console.log('Creating project:', { repoUrl, projectName, description });
    
    if (!repoUrl || !projectName) {
      return res.status(400).json({ error: 'Repository URL and project name are required' });
    }

    // Validate repository URL format
    if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
      return res.status(400).json({ error: 'Invalid repository URL format. Use HTTPS or SSH format.' });
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
      error: null
    };

    projects.set(projectId, project);

    // Process repository asynchronously
    processRepository(projectId, repoUrl);

    res.json({ projectId, status: 'processing' });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get project status
app.get('/api/projects/:projectId', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json(project);
});

// Get all projects
app.get('/api/projects', (req, res) => {
  const projectList = Array.from(projects.values()).map(project => ({
    id: project.id,
    projectName: project.projectName,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt
  }));
  
  res.json(projectList);
});

// Download generated README
app.get('/api/projects/:projectId/readme', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  if (!project.documentation || !project.documentation.generatedReadme) {
    return res.status(404).json({ error: 'Generated README not found' });
  }
  
  const filename = `${project.projectName}-README.md`;
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(project.documentation.generatedReadme.raw);
});

// AI Configuration endpoint
app.get('/api/ai-config', (req, res) => {
  console.log('AI configuration endpoint called');
  try {
    const config = {
      aiEnabled: !!geminiAI,
      model: AI_CONFIG?.model || 'N/A',
      temperature: AI_CONFIG?.temperature || 'N/A',
      maxTokens: AI_CONFIG?.maxTokens || 'N/A',
      hasApiKey: !!process.env.GEMINI_API_KEY,
      packageInstalled: true // Always true in Docker image
    };

    res.json(config);
  } catch (error) {
    console.error('Error getting AI config:', error);
    res.status(500).json({ error: 'Failed to get AI configuration' });
  }
});

// Process repository and generate documentation
async function processRepository(projectId, repoUrl) {
  const project = projects.get(projectId);
  if (!project) return;

  console.log(`Starting to process repository: ${repoUrl} for project: ${projectId}`);

  try {
    const tempDir = `temp/${projectId}`;
    console.log(`Creating temp directory: ${tempDir}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Clone repository with timeout
    console.log(`Cloning repository: ${repoUrl}`);
    const git = simpleGit();
    
    // Add timeout to git clone operation
    const clonePromise = git.clone(repoUrl, tempDir);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Git clone timeout after 60 seconds')), 60000)
    );
    
    try {
      await Promise.race([clonePromise, timeoutPromise]);
      console.log(`Repository cloned successfully to: ${tempDir}`);
    } catch (cloneError) {
      console.error(`Git clone failed for ${repoUrl}:`, cloneError);
      throw new Error(`Failed to clone repository: ${cloneError.message}`);
    }

    // Generate documentation
    console.log(`Generating documentation for: ${tempDir}`);
    const documentation = await generateDocumentation(tempDir);
    
    // Update project
    project.status = 'completed';
    project.documentation = documentation;
    project.completedAt = new Date().toISOString();
    console.log(`Project ${projectId} completed successfully`);
    
    // Cleanup
    console.log(`Cleaning up temp directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    
  } catch (error) {
    console.error(`Error processing repository for project ${projectId}:`, error);
    project.status = 'failed';
    project.error = error.message;
    console.log(`Project ${projectId} failed with error: ${error.message}`);
  }
}

// Generate documentation from repository
async function generateDocumentation(repoPath) {
  const documentation = {
    readme: null,
    files: [],
    structure: {},
    summary: {},
    generatedReadme: null
  };

  try {
    // Read existing README files
    const readmeFiles = await findReadmeFiles(repoPath);
    if (readmeFiles.length > 0) {
      const readmeContent = await fs.readFile(readmeFiles[0], 'utf-8');
      documentation.readme = {
        path: readmeFiles[0].replace(repoPath, ''),
        content: marked.parse(readmeContent),
        raw: readmeContent
      };
    }

    // Analyze repository structure
    documentation.structure = await analyzeRepositoryStructure(repoPath);
    
    // Generate file summaries
    documentation.files = await generateFileSummaries(repoPath);
    
    // Generate overall summary
    documentation.summary = generateSummary(documentation);
    
    // Generate a new README based on the analysis
    documentation.generatedReadme = await generateNewReadme(repoPath, documentation);
    
  } catch (error) {
    console.error('Error generating documentation:', error);
  }

  return documentation;
}

// Find README files in repository
async function findReadmeFiles(repoPath) {
  const readmePatterns = ['README.md', 'README.txt', 'readme.md', 'readme.txt'];
  const readmeFiles = [];
  
  for (const pattern of readmePatterns) {
    try {
      const filePath = path.join(repoPath, pattern);
      await fs.access(filePath);
      readmeFiles.push(filePath);
    } catch (error) {
      // File doesn't exist
    }
  }
  
  return readmeFiles;
}

// Analyze repository structure
async function analyzeRepositoryStructure(repoPath) {
  const structure = {};
  
  async function scanDirectory(dirPath, relativePath = '') {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item === '.git') continue;
        
        const fullPath = path.join(dirPath, item);
        const relativeItemPath = path.join(relativePath, item);
        
        try {
          const stats = await fs.stat(fullPath);
          
          if (stats.isDirectory()) {
            structure[relativeItemPath] = { type: 'directory', children: {} };
            await scanDirectory(fullPath, relativeItemPath);
          } else {
            structure[relativeItemPath] = { 
              type: 'file', 
              size: stats.size,
              extension: path.extname(item)
            };
          }
        } catch (error) {
          // Skip items we can't access
        }
      }
    } catch (error) {
      console.error('Error scanning directory:', error);
    }
  }
  
  await scanDirectory(repoPath);
  return structure;
}

// Generate file summaries
async function generateFileSummaries(repoPath) {
  const files = [];
  
  async function scanFiles(dirPath, relativePath = '') {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item === '.git') continue;
        
        const fullPath = path.join(dirPath, item);
        const relativeItemPath = path.join(relativePath, item);
        
        try {
          const stats = await fs.stat(fullPath);
          
          if (stats.isDirectory()) {
            await scanFiles(fullPath, relativeItemPath);
          } else {
            const extension = path.extname(item);
            if (isDocumentableFile(extension)) {
              const summary = await generateFileSummary(fullPath, relativeItemPath, extension);
              if (summary) {
                files.push(summary);
              }
            }
          }
        } catch (error) {
          // Skip files we can't access
        }
      }
    } catch (error) {
      console.error('Error scanning files:', error);
    }
  }
  
  await scanFiles(repoPath);
  return files;
}

// Check if file type is documentable
function isDocumentableFile(extension) {
  const documentableExtensions = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj',
    '.md', '.txt', '.rst', '.adoc'
  ];
  
  return documentableExtensions.includes(extension.toLowerCase());
}

// Generate summary for a single file
async function generateFileSummary(filePath, relativePath, extension) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    let summary = {
      path: relativePath,
      extension,
      size: content.length,
      lines: content.split('\n').length,
      raw: content // Store raw content for AI analysis
    };
    
    // Generate content summary based on file type
    if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
      summary.type = 'javascript';
      summary.functions = extractFunctions(content);
      summary.classes = extractClasses(content);
      summary.imports = extractImports(content);
      summary.dependencies = extractDependencies(content);
    } else if (['.py'].includes(extension)) {
      summary.type = 'python';
      summary.functions = extractPythonFunctions(content);
      summary.classes = extractPythonClasses(content);
      summary.imports = extractPythonImports(content);
    } else if (['.md', '.txt'].includes(extension)) {
      summary.type = 'markdown';
      summary.content = marked.parse(content.substring(0, 500) + '...');
    } else if (['.json'].includes(extension)) {
      summary.type = 'json';
      try {
        const jsonData = JSON.parse(content);
        summary.jsonData = jsonData;
      } catch (e) {
        // Invalid JSON
      }
    }
    
    return summary;
  } catch (error) {
    return null;
  }
}

// Extract JavaScript/TypeScript functions
function extractFunctions(content) {
  const functionRegex = /(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s+)?function|(\w+)\s*[:=]\s*(?:async\s+)?\([^)]*\)\s*=>)/g;
  const functions = [];
  let match;
  
  while ((match = functionRegex.exec(content)) !== null) {
    const funcName = match[1] || match[2] || match[3];
    if (funcName) {
      functions.push(funcName);
    }
  }
  
  return functions;
}

// Extract JavaScript/TypeScript classes
function extractClasses(content) {
  const classRegex = /class\s+(\w+)/g;
  const classes = [];
  let match;
  
  while ((match = classRegex.exec(content)) !== null) {
    classes.push(match[1]);
  }
  
  return classes;
}

// Extract Python functions
function extractPythonFunctions(content) {
  const functionRegex = /def\s+(\w+)\s*\(/g;
  const functions = [];
  let match;
  
  while ((match = functionRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }
  
  return functions;
}

// Extract Python classes
function extractPythonClasses(content) {
  const classRegex = /class\s+(\w+)/g;
  const classes = [];
  let match;
  
  while ((match = classRegex.exec(content)) !== null) {
    classes.push(match[1]);
  }
  
  return classes;
}

// Extract JavaScript/TypeScript imports
function extractImports(content) {
  const importRegex = /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"`]([^'"`]+)['"`]/g;
  const imports = [];
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  return imports;
}

// Extract dependencies from package.json or similar
function extractDependencies(content) {
  const dependencyRegex = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
  const dependencies = [];
  let match;
  
  while ((match = dependencyRegex.exec(content)) !== null) {
    if (match[1] && match[2]) {
      dependencies.push({ name: match[1], version: match[2] });
    }
  }
  
  return dependencies;
}

// Extract Python imports
function extractPythonImports(content) {
  const importRegex = /(?:from\s+(\w+(?:\.\w+)*)\s+import|import\s+(\w+(?:\s*,\s*\w+)*))/g;
  const imports = [];
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push(match[1]);
    } else if (match[2]) {
      imports.push(...match[2].split(',').map(i => i.trim()));
    }
  }
  
  return imports;
}

// Generate overall summary
function generateSummary(documentation) {
  const summary = {
    totalFiles: Object.keys(documentation.structure).filter(key => 
      documentation.structure[key].type === 'file'
    ).length,
    totalDirectories: Object.keys(documentation.structure).filter(key => 
      documentation.structure[key].type === 'directory'
    ).length,
    hasReadme: !!documentation.readme,
    languages: {},
    fileTypes: {}
  };
  
  // Analyze file types and languages
  documentation.files.forEach(file => {
    if (file.extension) {
      summary.fileTypes[file.extension] = (summary.fileTypes[file.extension] || 0) + 1;
    }
    if (file.type) {
      summary.languages[file.type] = (summary.languages[file.type] || 0) + 1;
    }
  });
  
  return summary;
}

// Generate a new README file based on repository analysis
async function generateNewReadme(repoPath, documentation) {
  try {
    console.log('Generating new README for repository...');
    
    // Get package.json if it exists
    let packageInfo = null;
    try {
      const packagePath = path.join(repoPath, 'package.json');
      const packageContent = await fs.readFile(packagePath, 'utf-8');
      packageInfo = JSON.parse(packageContent);
    } catch (error) {
      // No package.json found, that's okay
    }

    // Get main entry point
    let mainFile = 'index.js';
    if (packageInfo && packageInfo.main) {
      mainFile = packageInfo.main;
    } else {
      // Try to find common entry points
      const commonEntries = ['index.js', 'main.js', 'app.js', 'server.js'];
      for (const entry of commonEntries) {
        try {
          await fs.access(path.join(repoPath, entry));
          mainFile = entry;
          break;
        } catch (error) {
          // File doesn't exist
        }
      }
    }

    // Generate README content
    const readmeContent = await generateReadmeContent(documentation, packageInfo, mainFile);
    
    console.log('README generation completed');
    return {
      content: readmeContent,
      markdown: marked.parse(readmeContent),
      raw: readmeContent
    };
    
  } catch (error) {
    console.error('Error generating README:', error);
    return null;
  }
}

// Generate README content based on analysis
async function generateReadmeContent(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  
             // Try AI generation first, fallback to template-based generation
           if (geminiAI) {
             try {
               console.log('🤖 Using AI to generate README...');
               const aiReadme = await generateAIReadme(documentation, packageInfo, mainFile);
               if (aiReadme) {
                 console.log('✅ AI README generation successful');
                 return aiReadme;
               }
             } catch (error) {
               console.error('❌ AI generation failed, falling back to template:', error.message);
             }
           }

           // Fallback to template-based generation (when no API key or AI fails)
           console.log('📝 Using template-based README generation...');
           return generateTemplateReadme(documentation, packageInfo, mainFile);
}

// Generate intelligent description based on code analysis
function generateIntelligentDescription(documentation, packageInfo) {
  // If package.json has a good description, use it
  if (packageInfo?.description && packageInfo.description.length > 10) {
    return packageInfo.description;
  }
  
  // Analyze the code to generate a description
  let description = '';
  
  // Analyze file types and languages
  const languages = Object.keys(documentation.summary.languages || {});
  const fileTypes = Object.keys(documentation.summary.fileTypes || {});
  
  // Analyze main functionality based on file names and content
  const mainFiles = documentation.files.filter(f => 
    f.path.includes('main') || f.path.includes('index') || f.path.includes('app') || f.path.includes('server')
  );
  
  // Look for key indicators in the code
  let hasWebServer = false;
  let hasDatabase = false;
  let hasAPI = false;
  let hasCLI = false;
  let hasTests = false;
  let hasDocker = false;
  
  // Check for common patterns
  documentation.files.forEach(file => {
    const content = file.raw || '';
    const path = file.path.toLowerCase();
    
    if (content.includes('express') || content.includes('app.listen') || content.includes('server.listen')) {
      hasWebServer = true;
    }
    if (content.includes('database') || content.includes('db.') || content.includes('mongoose') || content.includes('sequelize')) {
      hasDatabase = true;
    }
    if (content.includes('api/') || content.includes('router.') || content.includes('@RestController')) {
      hasAPI = true;
    }
    if (content.includes('process.argv') || content.includes('commander') || content.includes('argparse')) {
      hasCLI = true;
    }
    if (path.includes('test') || path.includes('spec') || path.includes('__tests__')) {
      hasTests = true;
    }
    if (path.includes('dockerfile') || path.includes('docker-compose')) {
      hasDocker = true;
    }
  });
  
  // Generate description based on analysis
  if (hasWebServer && hasAPI) {
    description = `A modern web API server built with ${languages.join(', ')}.`;
  } else if (hasWebServer) {
    description = `A web application built with ${languages.join(', ')}.`;
  } else if (hasCLI) {
    description = `A command-line interface tool built with ${languages.join(', ')}.`;
  } else if (hasDatabase) {
    description = `A data-driven application with ${languages.join(', ')} backend.`;
  } else if (hasTests) {
    description = `A well-tested ${languages.join(', ')} project with comprehensive test coverage.`;
  } else if (hasDocker) {
    description = `A containerized ${languages.join(', ')} application ready for deployment.`;
  } else {
    // Generic but more specific based on what we found
    const totalFiles = documentation.summary.totalFiles || 0;
    const totalDirs = documentation.summary.totalDirectories || 0;
    
    if (totalFiles > 50) {
      description = `A comprehensive ${languages.join(', ')} project with ${totalFiles} source files.`;
    } else if (totalFiles > 20) {
      description = `A medium-scale ${languages.join(', ')} application with ${totalFiles} source files.`;
    } else {
      description = `A ${languages.join(', ')} project with ${totalFiles} source files.`;
    }
  }
  
  // Add specific details if we found interesting patterns
  if (hasWebServer && hasDatabase && hasAPI) {
    description += ' Features a RESTful API with database integration.';
  } else if (hasWebServer && hasAPI) {
    description += ' Provides a clean API interface for web services.';
  } else if (hasTests) {
    description += ' Includes comprehensive testing for reliability.';
  } else if (hasDocker) {
    description += ' Containerized for easy deployment and scaling.';
  }
  
  return description;
}

// Detect project features based on code analysis
function detectProjectFeatures(documentation) {
  const features = [];
  
  // Check for common patterns and technologies
  let hasExpress = false;
  let hasReact = false;
  let hasVue = false;
  let hasAngular = false;
  let hasDatabase = false;
  let hasTesting = false;
  let hasDocker = false;
  let hasCI = false;
  let hasLinting = false;
  let hasTypeScript = false;
  let hasPython = false;
  let hasJava = false;
  
  documentation.files.forEach(file => {
    const content = file.raw || '';
    const path = file.path.toLowerCase();
    
    // Framework detection
    if (content.includes('express') || content.includes('app.use')) {
      hasExpress = true;
    }
    if (content.includes('react') || content.includes('jsx') || content.includes('useState')) {
      hasReact = true;
    }
    if (content.includes('vue') || content.includes('createApp')) {
      hasVue = true;
    }
    if (content.includes('angular') || content.includes('@Component')) {
      hasAngular = true;
    }
    
    // Technology detection
    if (content.includes('database') || content.includes('mongoose') || content.includes('sequelize')) {
      hasDatabase = true;
    }
    if (path.includes('test') || path.includes('spec') || content.includes('jest') || content.includes('mocha')) {
      hasTesting = true;
    }
    if (path.includes('dockerfile') || path.includes('docker-compose')) {
      hasDocker = true;
    }
    if (path.includes('.github') || path.includes('travis') || path.includes('circle')) {
      hasCI = true;
    }
    if (content.includes('eslint') || content.includes('prettier')) {
      hasLinting = true;
    }
    if (file.extension === '.ts' || file.extension === '.tsx') {
      hasTypeScript = true;
    }
    if (file.extension === '.py') {
      hasPython = true;
    }
    if (file.extension === '.java') {
      hasJava = true;
    }
  });
  
  // Add detected features
  if (hasExpress) features.push('Express.js backend framework');
  if (hasReact) features.push('React frontend framework');
  if (hasVue) features.push('Vue.js frontend framework');
  if (hasAngular) features.push('Angular frontend framework');
  if (hasDatabase) features.push('Database integration');
  if (hasTesting) features.push('Comprehensive testing suite');
  if (hasDocker) features.push('Docker containerization');
  if (hasCI) features.push('Continuous Integration/Deployment');
  if (hasLinting) features.push('Code quality tools');
  if (hasTypeScript) features.push('TypeScript support');
  if (hasPython) features.push('Python backend');
  if (hasJava) features.push('Java backend');
  
  return features;
}

// Generate intelligent installation commands
function generateInstallCommands(packageInfo, documentation) {
  const commands = [];
  
  // Check if it's a Node.js project
  if (packageInfo && packageInfo.scripts) {
    commands.push('# Install dependencies\nnpm install');
    
    // Check for additional setup steps
    if (documentation.files.some(f => f.path.includes('package-lock.json'))) {
      commands.push('# Or use yarn if preferred\nyarn install');
    }
  }
  
  // Check for Python requirements
  if (documentation.files.some(f => f.path.includes('requirements.txt'))) {
    commands.push('# Install Python dependencies\npip install -r requirements.txt');
  }
  
  // Check for Docker
  if (documentation.files.some(f => f.path.includes('dockerfile') || f.path.includes('docker-compose'))) {
    commands.push('# Or use Docker\ndocker-compose up --build');
  }
  
  // Default fallback
  if (commands.length === 0) {
    commands.push('# Clone the repository\ngit clone <repository-url>', '# Navigate to project directory\ncd <project-name>');
  }
  
  return commands;
}

// Generate intelligent usage commands
function generateUsageCommands(packageInfo, mainFile, documentation) {
  const commands = [];
  
  // Check for npm scripts
  if (packageInfo && packageInfo.scripts) {
    if (packageInfo.scripts.start) {
      commands.push('# Start the application\nnpm start');
    }
    if (packageInfo.scripts.dev) {
      commands.push('# Start in development mode\nnpm run dev');
    }
    if (packageInfo.scripts.build) {
      commands.push('# Build for production\nnpm run build');
    }
    if (packageInfo.scripts.test) {
      commands.push('# Run tests\nnpm test');
    }
  }
  
  // Check for Python main files
  if (documentation.files.some(f => f.extension === '.py' && f.path.includes('main'))) {
    commands.push('# Run Python application\npython main.py');
  }
  
  // Check for Java
  if (documentation.files.some(f => f.extension === '.java')) {
    commands.push('# Compile and run Java application\njavac *.java\njava Main');
  }
  
  // Default fallback
  if (commands.length === 0) {
    commands.push(`# Run the application\nnode ${mainFile}`);
  }
  
  return commands;
}

// Generate intelligent project structure description
function generateStructureDescription(structure) {
  const directories = Object.keys(structure).filter(key => structure[key].type === 'directory');
  const files = Object.keys(structure).filter(key => structure[key].type === 'file');
  
  let description = '';
  
  // Analyze common patterns
  if (directories.includes('src') && directories.includes('public')) {
    description = 'This project follows a modern web application structure with separate source and public directories.';
  } else if (directories.includes('src') && directories.includes('tests')) {
    description = 'The project is organized with source code in the `src` directory and tests in the `tests` directory.';
  } else if (directories.includes('app') && directories.includes('config')) {
    description = 'This application uses a modular structure with separate app and configuration directories.';
  } else if (directories.includes('lib') && directories.includes('bin')) {
    description = 'The project follows a library structure with core functionality in `lib` and executables in `bin`.';
  } else if (directories.includes('components') && directories.includes('pages')) {
    description = 'This appears to be a component-based application with organized component and page directories.';
  }
  
  // Add file count information
  if (files.length > 0) {
    if (!description) description = 'The project contains ';
    else description += ' ';
    
    if (files.length > 100) {
      description += `a large number of source files (${files.length} total).`;
    } else if (files.length > 50) {
      description += `a substantial codebase with ${files.length} source files.`;
    } else if (files.length > 20) {
      description += `a moderate-sized codebase with ${files.length} source files.`;
    } else {
      description += `${files.length} source files.`;
    }
  }
  
  return description;
}

// Analyze the codebase for intelligent insights
function analyzeCodebase(documentation) {
  const analysis = {
    languages: [],
    patterns: []
  };
  
  // Analyze languages and their usage
  const languageStats = documentation.summary.languages || {};
  Object.entries(languageStats).forEach(([lang, count]) => {
    let description = '';
    
    switch (lang) {
      case 'javascript':
        description = `Primary language with ${count} files. Modern ES6+ features and Node.js ecosystem.`;
        break;
      case 'typescript':
        description = `Type-safe JavaScript with ${count} files. Enhanced developer experience and better maintainability.`;
        break;
      case 'python':
        description = `Backend language with ${count} files. Clean syntax and extensive library ecosystem.`;
        break;
      case 'java':
        description = `Enterprise-grade language with ${count} files. Strong typing and object-oriented design.`;
        break;
      default:
        description = `Used in ${count} files.`;
    }
    
    analysis.languages.push({ name: lang, description, count });
  });
  
  // Detect design patterns and architectural approaches
  const files = documentation.files;
  let hasComponents = false;
  let hasServices = false;
  let hasModels = false;
  let hasControllers = false;
  let hasMiddleware = false;
  let hasUtils = false;
  
  files.forEach(file => {
    const path = file.path.toLowerCase();
    if (path.includes('component') || path.includes('components')) hasComponents = true;
    if (path.includes('service') || path.includes('services')) hasServices = true;
    if (path.includes('model') || path.includes('models')) hasModels = true;
    if (path.includes('controller') || path.includes('controllers')) hasControllers = true;
    if (path.includes('middleware')) hasMiddleware = true;
    if (path.includes('util') || path.includes('utils')) hasUtils = true;
  });
  
  // Add detected patterns
  if (hasComponents && hasServices) {
    analysis.patterns.push({
      name: 'Component-Service Architecture',
      description: 'Separation of concerns with reusable components and business logic services.'
    });
  }
  
  if (hasModels && hasControllers) {
    analysis.patterns.push({
      name: 'MVC Pattern',
      description: 'Model-View-Controller architecture for organized code structure.'
    });
  }
  
  if (hasMiddleware) {
    analysis.patterns.push({
      name: 'Middleware Pattern',
      description: 'Request processing pipeline with modular middleware functions.'
    });
  }
  
  if (hasUtils) {
    analysis.patterns.push({
      name: 'Utility Functions',
      description: 'Reusable helper functions for common operations.'
    });
  }
  
  // Check for testing patterns
  if (documentation.files.some(f => f.path.includes('test') || f.path.includes('spec'))) {
    analysis.patterns.push({
      name: 'Test-Driven Development',
      description: 'Comprehensive testing approach with dedicated test files.'
    });
  }
  
  return analysis;
}

// Generate AI-powered README using Gemini
async function generateAIReadme(documentation, packageInfo, mainFile) {
  if (!geminiAI) {
    throw new Error('Gemini AI not initialized');
  }

  try {
    const model = geminiAI.getGenerativeModel({ model: AI_CONFIG.model });
    
    // Prepare the prompt with project context
    const prompt = buildAIPrompt(documentation, packageInfo, mainFile);
    
    console.log('🤖 Sending prompt to Gemini AI...');
    console.log(`   Model: ${AI_CONFIG.model}`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiGeneratedReadme = response.text();
    
    if (!aiGeneratedReadme || aiGeneratedReadme.trim().length < 100) {
      throw new Error('AI generated content too short or empty');
    }
    
    console.log('✅ AI generated README successfully');
    return aiGeneratedReadme;
    
  } catch (error) {
    console.error('❌ AI generation error:', error);
    
    // Handle specific Gemini API errors
    if (error.message.includes('404 Not Found') || error.message.includes('models/')) {
      console.error('   This model may not be available. Try updating GEMINI_MODEL in your .env file.');
      console.error('   Available models: gemini-1.5-flash, gemini-1.5-pro, gemini-pro');
    }
    
    throw error;
  }
}

// Build comprehensive AI prompt for README generation
function buildAIPrompt(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  const description = packageInfo?.description || '';
  const version = packageInfo?.version || '1.0.0';
  const author = packageInfo?.author || 'Developer';
  const license = packageInfo?.license || 'MIT';
  
  // Extract key information for the AI
  const languages = Object.keys(documentation.summary.languages || {});
  const totalFiles = documentation.summary.totalFiles || 0;
  const totalDirs = documentation.summary.totalDirectories || 0;
  
  // Get sample code snippets for context
  const codeSnippets = documentation.files
    .filter(f => f.raw && f.raw.length > 50)
    .slice(0, 5)
    .map(f => `File: ${f.path}\n${f.raw.substring(0, 200)}...`)
    .join('\n\n');
  
  // Get detected features
  const features = detectProjectFeatures(documentation);
  
  const prompt = `You are an expert software developer and technical writer. Generate a comprehensive, professional README.md file for a software project based on the following analysis:

PROJECT INFORMATION:
- Name: ${projectName}
- Description: ${description}
- Version: ${version}
- Author: ${author}
- License: ${license}

TECHNICAL ANALYSIS:
- Languages: ${languages.join(', ')}
- Total Files: ${totalFiles}
- Total Directories: ${totalDirs}
- Detected Features: ${features.join(', ')}

CODE SAMPLES:
${codeSnippets}

REQUIREMENTS:
1. Create a professional, engaging README.md that accurately reflects the project
2. Use the actual project name and description when available
3. Include appropriate badges for version and license
4. Create a comprehensive table of contents
5. Write intelligent, project-specific descriptions based on the code analysis
6. Include installation and usage instructions appropriate for the detected technologies
7. Highlight the actual features and technologies found in the code
8. Add a project structure section if meaningful
9. Include contributing guidelines and license information
10. Make it engaging and professional, suitable for GitHub or similar platforms
11. Use proper Markdown formatting with headers, code blocks, and lists
12. Be specific about what the project actually does based on the code analysis
13. Avoid generic placeholder text - make it specific to this project

The README should be comprehensive but not overly verbose. Focus on being helpful to developers who want to understand and use this project.

Generate only the README content in Markdown format, starting with the title.`;

  return prompt;
}

// Generate template-based README (fallback)
function generateTemplateReadme(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  
  // Generate intelligent description based on code analysis
  const description = generateIntelligentDescription(documentation, packageInfo);
  
  const version = packageInfo?.version || '1.0.0';
  const author = packageInfo?.author || 'Developer';
  const license = packageInfo?.license || 'MIT';
  
  let readme = `# ${projectName}\n\n`;
  readme += `${description}\n\n`;
  
  // Badges
  readme += `![Version](https://img.shields.io/badge/version-${version}-blue.svg)\n`;
  readme += `![License](https://img.shields.io/badge/license-${license}-green.svg)\n\n`;
  
  // Table of Contents
  readme += `## Table of Contents\n\n`;
  readme += `- [Installation](#installation)\n`;
  readme += `- [Usage](#usage)\n`;
  readme += `- [Features](#features)\n`;
  readme += `- [API Reference](#api-reference)\n`;
  readme += `- [Contributing](#contributing)\n`;
  readme += `- [License](#license)\n\n`;
  
  // Installation
  readme += `## Installation\n\n`;
  const installCommands = generateInstallCommands(packageInfo, documentation);
  installCommands.forEach(cmd => {
    readme += `\`\`\`bash\n${cmd}\n\`\`\`\n\n`;
  });
  
  // Usage
  readme += `## Usage\n\n`;
  const usageCommands = generateUsageCommands(packageInfo, mainFile, documentation);
  usageCommands.forEach(cmd => {
    readme += `\`\`\`bash\n${cmd}\n\`\`\`\n\n`;
  });
  
  // Features
  readme += `## Features\n\n`;
  if (documentation.files.length > 0) {
    const languages = Object.keys(documentation.summary.languages || {});
    readme += `- **Multi-language support**: ${languages.join(', ')}\n`;
    readme += `- **${documentation.summary.totalFiles} source files**\n`;
    readme += `- **${documentation.summary.totalDirectories} directories**\n`;
    
    // Add intelligent feature detection
    const features = detectProjectFeatures(documentation);
    features.forEach(feature => {
      readme += `- **${feature}\n`;
    });
  }
  readme += `- Modern architecture\n`;
  readme += `- Easy to use\n\n`;
  
  // Code Analysis
  readme += `## Code Analysis\n\n`;
  
  // Analyze the codebase
  const codeAnalysis = analyzeCodebase(documentation);
  if (codeAnalysis.languages.length > 0) {
    readme += `### Languages & Technologies\n\n`;
    codeAnalysis.languages.forEach(lang => {
      readme += `- **${lang.name}**: ${lang.description}\n`;
    });
    readme += `\n`;
  }
  
  if (codeAnalysis.patterns.length > 0) {
    readme += `### Design Patterns\n\n`;
    codeAnalysis.patterns.forEach(pattern => {
      readme += `- **${pattern.name}**: ${pattern.description}\n`;
    });
    readme += `\n`;
  }
  
  // API Reference
  if (documentation.files.some(f => f.functions && f.functions.length > 0)) {
    readme += `## API Reference\n\n`;
    readme += `### Functions\n\n`;
    
    const allFunctions = [];
    documentation.files.forEach(file => {
      if (file.functions) {
        file.functions.forEach(func => {
          allFunctions.push({ name: func, file: file.path });
        });
      }
    });
    
    // Show first 10 functions
    allFunctions.slice(0, 10).forEach(func => {
      readme += `- \`${func.name}\` - Defined in \`${func.file}\`\n`;
    });
    
    if (allFunctions.length > 10) {
      readme += `- ... and ${allFunctions.length - 10} more functions\n`;
    }
    readme += `\n`;
  }
  
  // Project Structure
  readme += `## Project Structure\n\n`;
  
  // Add intelligent structure description
  const structureDescription = generateStructureDescription(documentation.structure);
  if (structureDescription) {
    readme += `${structureDescription}\n\n`;
  }
  
  readme += `\`\`\`\n`;
  const structureLines = [];
  
  function addStructureLines(structure, prefix = '') {
    Object.entries(structure).forEach(([name, info]) => {
      if (info.type === 'directory') {
        structureLines.push(`${prefix}📁 ${name}/`);
        if (info.children) {
          addStructureLines(info.children, prefix + '  ');
        }
      } else {
        structureLines.push(`${prefix}📄 ${name}`);
      }
    });
  }
  
  addStructureLines(documentation.structure);
  readme += structureLines.slice(0, 20).join('\n');
  if (structureLines.length > 20) {
    readme += `\n... and ${structureLines.length - 20} more files`;
  }
  readme += `\n\`\`\`\n\n`;
  
  // Contributing
  readme += `## Contributing\n\n`;
  readme += `1. Fork the project\n`;
  readme += `2. Create your feature branch (\`git checkout -b feature/AmazingFeature\`)\n`;
  readme += `3. Commit your changes (\`git commit -m 'Add some AmazingFeature'\`)\n`;
  readme += `4. Push to the branch (\`git push origin feature/AmazingFeature\`)\n`;
  readme += `5. Open a Pull Request\n\n`;
  
  // License
  readme += `## License\n\n`;
  readme += `This project is licensed under the ${license} License - see the [LICENSE](LICENSE) file for details.\n\n`;
  
  // Footer
  readme += `---\n`;
  readme += `Generated with ❤️ by GitGen\n`;
  
  return readme;
}

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GitGen server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to use the application`);
});