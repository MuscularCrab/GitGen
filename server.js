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

// Debug endpoint to inspect all projects in memory
app.get('/api/debug/projects', (req, res) => {
  console.log('Debug projects endpoint called');
  
  const allProjects = Array.from(projects.entries()).map(([id, project]) => ({
    id,
    project: {
      id: project.id,
      projectName: project.projectName,
      repoUrl: project.repoUrl,
      status: project.status,
      hasDocumentation: !!project.documentation,
      hasProgress: !!project.progress,
      createdAt: project.createdAt,
      completedAt: project.completedAt,
      error: project.error
    }
  }));
  
  res.json({
    totalProjects: projects.size,
    projects: allProjects,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to create a project and immediately check its state
app.post('/api/test-create-project', async (req, res) => {
  console.log('Test create project endpoint called');
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
      status: 'processing',
      createdAt: new Date().toISOString(),
      documentation: null,
      error: null
    };
    
    // Store the project
    projects.set(projectId, project);
    
    // Immediately retrieve and check the stored project
    const storedProject = projects.get(projectId);
    console.log('Project immediately after storage:', storedProject);
    
    // Check if the project is valid
    const isValid = storedProject && 
      storedProject.id && 
      typeof storedProject.id === 'string' &&
      storedProject.repoUrl && 
      typeof storedProject.repoUrl === 'string' &&
      storedProject.projectName && 
      typeof storedProject.projectName === 'string';
    
    res.json({ 
      projectId, 
      status: 'created',
      project: storedProject,
      isValid,
      totalProjects: projects.size,
      validationDetails: {
        hasProject: !!storedProject,
        hasId: !!storedProject?.id,
        idType: typeof storedProject?.id,
        hasRepoUrl: !!storedProject?.repoUrl,
        repoUrlType: typeof storedProject?.repoUrl,
        hasProjectName: !!storedProject?.projectName,
        projectNameType: typeof storedProject?.projectName
      }
    });
    
  } catch (error) {
    console.error('Error in test project creation:', error);
    res.status(500).json({ error: 'Failed to create test project' });
  }
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
      mode: mode || 'v2' // Store the selected mode
    };
    
    // Validate project structure
    if (!project.id || !project.repoUrl || !project.projectName) {
      console.error('Invalid project structure:', project);
      return res.status(500).json({ error: 'Invalid project structure' });
    }

    projects.set(projectId, project);
    
    console.log('Project created and stored:', { 
      projectId, 
      projectName, 
      repoUrl, 
      mode,
      totalProjects: projects.size 
    });
    
    // Verify the project was stored correctly
    const storedProject = projects.get(projectId);
    console.log('Verification - stored project:', { 
      id: storedProject?.id, 
      projectName: storedProject?.projectName, 
      repoUrl: storedProject?.repoUrl, 
      status: storedProject?.status,
      mode: storedProject?.mode
    });

    // Process repository asynchronously with selected mode
    processRepository(projectId, repoUrl, mode);

    res.json({ projectId, status: 'processing', mode });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get project status
app.get('/api/projects/:projectId', (req, res) => {
  const { projectId } = req.params;
  console.log('Getting project:', projectId);
  
  const project = projects.get(projectId);
  
  if (!project) {
    console.log('Project not found:', projectId);
    return res.status(404).json({ error: 'Project not found' });
  }
  
  console.log('Returning project:', { 
    id: project.id, 
    projectName: project.projectName, 
    repoUrl: project.repoUrl, 
    status: project.status 
  });
  
  res.json(project);
});

// Get all projects
app.get('/api/projects', (req, res) => {
  console.log('Getting all projects. Total projects in memory:', projects.size);
  
  const projectList = Array.from(projects.values()).map(project => {
    // Validate project data before returning
    if (!project || !project.id || !project.repoUrl || !project.projectName) {
      console.error('Invalid project data found:', project);
      return null;
    }
    
    console.log('Processing project:', { 
      id: project.id, 
      projectName: project.projectName, 
      repoUrl: project.repoUrl, 
      status: project.status 
    });
    
    return {
      id: project.id,
      projectName: project.projectName,
      repoUrl: project.repoUrl,
      description: project.description || '',
      status: project.status || 'unknown',
      createdAt: project.createdAt || new Date().toISOString(),
      completedAt: project.completedAt || null,
      documentation: project.documentation || null
    };
  }).filter(Boolean); // Remove any null entries
  
  console.log('Returning projects:', projectList);
  res.json(projectList);
});

// Get project progress
app.get('/api/projects/:projectId/progress', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  console.log(`Progress request for project ${projectId}:`, {
    projectExists: !!project,
    projectStatus: project?.status,
    projectProgress: project?.progress
  });
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  if (!project.progress) {
    return res.json({
      currentStep: 'unknown',
      step: 0,
      totalSteps: 6,
      message: 'Progress not available',
      percentage: 0,
      estimatedTime: null,
      status: project.status || 'unknown'
    });
  }
  
  // Calculate percentage and ETA
  const percentage = Math.round((project.progress.step / project.progress.totalSteps) * 100);
  let estimatedTime = null;
  
  if (project.progress.startTime && project.progress.step > 0) {
    const elapsed = Date.now() - project.progress.startTime;
    const avgTimePerStep = elapsed / project.progress.step;
    const remainingSteps = project.progress.totalSteps - project.progress.step;
    
    // Use a more conservative estimate and cap the ETA to prevent runaway values
    const rawETA = Math.round((avgTimePerStep * remainingSteps) / 1000);
    
    // Cap ETA at reasonable values and use rolling average if available
    if (project.progress.lastETA && project.progress.step > 1) {
      // Use rolling average with previous ETA to smooth out fluctuations
      const smoothingFactor = 0.7; // 70% weight to previous, 30% to current
      estimatedTime = Math.round(
        (project.progress.lastETA * smoothingFactor) + (rawETA * (1 - smoothingFactor))
      );
    } else {
      estimatedTime = rawETA;
    }
    
    // Cap ETA at reasonable maximum values
    if (estimatedTime > 300) estimatedTime = 300; // Max 5 minutes
    if (estimatedTime < 0) estimatedTime = 0;
    
    // Store current ETA for next calculation
    project.progress.lastETA = estimatedTime;
  }
  
  const response = {
    ...project.progress,
    percentage,
    estimatedTime,
    status: project.status || 'processing'
  };
  
  console.log(`Progress response for project ${projectId}:`, response);
  
  res.json(response);
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

// Get available README generation modes
app.get('/api/readme-modes', (req, res) => {
  console.log('README modes endpoint called');
  try {
    const modes = {
      v2: {
        name: 'v2 - Beginner-Friendly',
        description: 'Simple, focused README generation with essential sections. Perfect for quick documentation and beginner-friendly projects.',
        features: [
          'Clear title and description',
          'Installation instructions',
          'Usage examples',
          'Features section',
          'Contributing guidelines',
          'License information'
        ],
        recommended: true,
        default: true
      },
      v1: {
        name: 'v1 - Comprehensive',
        description: 'Detailed, comprehensive README generation with advanced sections. Ideal for complex projects requiring extensive documentation.',
        features: [
          'All v2 features plus:',
          'Detailed code analysis',
          'API reference',
          'Project structure',
          'Testing documentation',
          'Deployment guides',
          'Troubleshooting',
          'Performance considerations'
        ],
        recommended: false,
        default: false
      }
    };

    res.json({
      modes,
      currentDefault: 'v2',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting README modes:', error);
    res.status(500).json({ error: 'Failed to get README modes' });
  }
});

// Debug endpoint to show project mode information
app.get('/api/debug/project/:projectId/mode', (req, res) => {
  const { projectId } = req.params;
  console.log(`Debug mode endpoint called for project: ${projectId}`);
  
  try {
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const modeInfo = {
      projectId: project.id,
      projectName: project.projectName,
      repoUrl: project.repoUrl,
      status: project.status,
      mode: project.mode || 'v2',
      modeDescription: project.mode === 'v1' ? 'Comprehensive (v1)' : 'Beginner-Friendly (v2)',
      createdAt: project.createdAt,
      completedAt: project.completedAt,
      hasDocumentation: !!project.documentation,
      hasProgress: !!project.progress
    };
    
    res.json(modeInfo);
  } catch (error) {
    console.error('Error getting project mode info:', error);
    res.status(500).json({ error: 'Failed to get project mode information' });
  }
});

// Process repository and generate documentation
async function processRepository(projectId, repoUrl, mode = 'v2') {
  const project = projects.get(projectId);
  if (!project) {
    console.error(`Project ${projectId} not found when starting processing`);
    return;
  }

  console.log(`Starting to process repository: ${repoUrl} for project: ${projectId} (${mode.toUpperCase()})`);
  console.log('Project data at start:', { 
    id: project.id, 
    projectName: project.projectName, 
    repoUrl: project.repoUrl, 
    status: project.status 
  });

  // Verify project data integrity before processing
  if (!project.id || !project.repoUrl || !project.projectName) {
    console.error('Project data corrupted before processing:', project);
    return;
  }

  try {
    // Initialize progress tracking
    project.progress = {
      currentStep: 'initializing',
      step: 0,
      totalSteps: 6,
      message: 'Initializing repository processing...',
      startTime: Date.now(),
      estimatedTime: null
    };

    const tempDir = `temp/${projectId}`;
    console.log(`Creating temp directory: ${tempDir}`);
    
    // Step 1: Create temp directory
    project.progress.currentStep = 'creating_temp';
    project.progress.step = 1;
    project.progress.message = 'Creating temporary directory...';
    await fs.mkdir(tempDir, { recursive: true });

    // Step 2: Clone repository
    project.progress.currentStep = 'cloning';
    project.progress.step = 2;
    project.progress.message = 'Cloning repository...';
    console.log(`Cloning repository: ${repoUrl}`);
    const git = simpleGit();
    
    // Add timeout to git clone operation
    const clonePromise = git.clone(repoUrl, tempDir);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Git clone timeout after 5 minutes')), 300000)
    );
    
    try {
      await Promise.race([clonePromise, timeoutPromise]);
      console.log(`Repository cloned successfully to: ${tempDir}`);
    } catch (cloneError) {
      console.error(`Git clone failed for ${repoUrl}:`, cloneError);
      throw new Error(`Failed to clone repository: ${cloneError.message}`);
    }

    // Step 3: Analyze repository structure
    project.progress.currentStep = 'analyzing';
    project.progress.step = 3;
    project.progress.message = 'Analyzing repository structure...';
    console.log(`Analyzing repository structure for: ${tempDir}`);

    // Step 4: Generate documentation
    project.progress.currentStep = 'generating';
    project.progress.step = 4;
    project.progress.message = 'Generating documentation...';
    console.log(`Generating documentation for: ${tempDir}`);
    const documentation = await generateDocumentation(tempDir, project, mode);
    
    // Step 5: Generate AI README
    project.progress.currentStep = 'ai_generation';
    project.progress.step = 5;
    project.progress.message = `Generating AI-powered README (${mode.toUpperCase()})...`;
    console.log(`Generating AI README for: ${tempDir} (${mode.toUpperCase()})`);

    // Step 6: Finalizing
    project.progress.currentStep = 'finalizing';
    project.progress.step = 6;
    project.progress.message = 'Finalizing documentation...';
    
    // Verify project data integrity before updating
    const currentProject = projects.get(projectId);
    if (!currentProject || !currentProject.id || !currentProject.repoUrl || !currentProject.projectName) {
      console.error('Project data corrupted during processing:', currentProject);
      return;
    }
    
    // Update project
    currentProject.status = 'completed';
    currentProject.documentation = documentation;
    currentProject.completedAt = new Date().toISOString();
    
    // Calculate total time and update progress
    const totalTime = Date.now() - currentProject.progress.startTime;
    currentProject.progress.estimatedTime = Math.round(totalTime / 1000);
    currentProject.progress.message = 'Documentation generation completed!';
    
    console.log(`Project ${projectId} completed successfully in ${currentProject.progress.estimatedTime}s (${mode.toUpperCase()})`);
    console.log('Final project data:', {
      id: currentProject.id,
      projectName: currentProject.projectName,
      repoUrl: currentProject.repoUrl,
      status: currentProject.status,
      hasDocumentation: !!currentProject.documentation
    });
    
    // Cleanup
    console.log(`Cleaning up temp directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    
  } catch (error) {
    console.error(`Error processing repository for project ${projectId}:`, error);
    
    // Get the current project state
    const currentProject = projects.get(projectId);
    if (currentProject) {
      currentProject.status = 'failed';
      currentProject.error = error.message;
      if (currentProject.progress) {
        currentProject.progress = {
          ...currentProject.progress,
          currentStep: 'failed',
          message: `Failed: ${error.message}`
        };
      }
      console.log(`Project ${projectId} failed with error: ${error.message}`);
      console.log('Failed project data:', {
        id: currentProject.id,
        projectName: currentProject.projectName,
        repoUrl: currentProject.repoUrl,
        status: currentProject.status,
        error: currentProject.error
      });
    } else {
      console.error(`Project ${projectId} not found after error occurred`);
    }
  }
}

// Generate documentation from repository
async function generateDocumentation(repoPath, project = null, mode = 'v2') {
  const documentation = {
    readme: null,
    files: [],
    structure: {},
    summary: {},
    generatedReadme: null
  };

  try {
    // Read existing README files
    if (project?.progress) {
      project.progress.message = 'Reading existing README files...';
    }
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
    if (project?.progress) {
      project.progress.message = 'Analyzing repository structure...';
    }
    documentation.structure = await analyzeRepositoryStructure(repoPath);
    
    // Generate file summaries
    if (project?.progress) {
      project.progress.message = 'Generating file summaries...';
    }
    documentation.files = await generateFileSummaries(repoPath);
    
    // Generate overall summary
    if (project?.progress) {
      project.progress.message = 'Generating project summary...';
    }
    documentation.summary = generateSummary(documentation);
    
    // Generate a new README based on the analysis with selected mode
    if (project?.progress) {
      project.progress.message = `Generating AI-powered README (${mode.toUpperCase()})...`;
    }
    documentation.generatedReadme = await generateNewReadme(repoPath, documentation, mode);
    
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
async function generateNewReadme(repoPath, documentation, mode = 'v2') {
  try {
    console.log(`Generating new README for repository (${mode.toUpperCase()})...`);
    
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

    // Generate README content with selected mode
    const readmeContent = await generateReadmeContent(documentation, packageInfo, mainFile, mode);
    
    console.log(`README generation completed (${mode.toUpperCase()})`);
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
async function generateReadmeContent(documentation, packageInfo, mainFile, mode = 'v2') {
  const projectName = packageInfo?.name || 'Project';
  
  // Try AI generation first, fallback to template-based generation
  if (geminiAI) {
    try {
      console.log(`🤖 Using AI to generate README (${mode.toUpperCase()})...`);
      const aiReadme = await generateAIReadme(documentation, packageInfo, mainFile, mode);
      if (aiReadme) {
        console.log(`✅ AI README generation successful (${mode.toUpperCase()})`);
        return aiReadme;
      }
    } catch (error) {
      console.error(`❌ AI generation failed (${mode.toUpperCase()}), falling back to template:`, error.message);
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
  let hasGraphQL = false;
  let hasWebSocket = false;
  let hasAuthentication = false;
  let hasCaching = false;
  let hasMonitoring = false;
  let hasLogging = false;
  let hasErrorHandling = false;
  let hasValidation = false;
  let hasRateLimiting = false;
  let hasCompression = false;
  let hasCORS = false;
  let hasHelmet = false;
  let hasMorgan = false;
  let hasJest = false;
  let hasMocha = false;
  let hasVitest = false;
  let hasCypress = false;
  let hasPlaywright = false;
  let hasTestingLibrary = false;
  let hasChai = false;
  let hasSinon = false;
  let hasSupertest = false;
  let hasESLint = false;
  let hasPrettier = false;
  let hasHusky = false;
  let hasLintStaged = false;
  
  documentation.files.forEach(file => {
    const content = file.raw || '';
    const path = file.path.toLowerCase();
    
    // Framework detection
    if (content.includes('express') || content.includes('app.use') || content.includes('app.listen')) {
      hasExpress = true;
    }
    if (content.includes('react') || content.includes('jsx') || content.includes('useState') || content.includes('useEffect')) {
      hasReact = true;
    }
    if (content.includes('vue') || content.includes('createApp') || content.includes('ref(') || content.includes('computed(')) {
      hasVue = true;
    }
    if (content.includes('angular') || content.includes('@Component') || content.includes('@Injectable')) {
      hasAngular = true;
    }
    
    // Technology detection
    if (content.includes('database') || content.includes('mongoose') || content.includes('sequelize') || content.includes('prisma')) {
      hasDatabase = true;
    }
    if (path.includes('test') || path.includes('spec') || content.includes('jest') || content.includes('mocha') || content.includes('vitest')) {
      hasTesting = true;
    }
    if (path.includes('dockerfile') || path.includes('docker-compose') || content.includes('docker')) {
      hasDocker = true;
    }
    if (path.includes('.github') || path.includes('travis') || path.includes('circle') || content.includes('ci/cd')) {
      hasCI = true;
    }
    if (content.includes('eslint') || content.includes('prettier') || content.includes('stylelint')) {
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
    
    // Advanced feature detection
    if (content.includes('graphql') || content.includes('gql') || content.includes('GraphQL')) {
      hasGraphQL = true;
    }
    if (content.includes('websocket') || content.includes('socket.io') || content.includes('ws')) {
      hasWebSocket = true;
    }
    if (content.includes('jwt') || content.includes('passport') || content.includes('auth') || content.includes('login')) {
      hasAuthentication = true;
    }
    if (content.includes('redis') || content.includes('cache') || content.includes('memcached')) {
      hasCaching = true;
    }
    if (content.includes('monitoring') || content.includes('metrics') || content.includes('prometheus')) {
      hasMonitoring = true;
    }
    if (content.includes('winston') || content.includes('pino') || content.includes('log4js')) {
      hasLogging = true;
    }
    if (content.includes('try-catch') || content.includes('error handling') || content.includes('throw new Error')) {
      hasErrorHandling = true;
    }
    if (content.includes('joi') || content.includes('yup') || content.includes('zod') || content.includes('validation')) {
      hasValidation = true;
    }
    if (content.includes('rate-limit') || content.includes('throttle') || content.includes('limiter')) {
      hasRateLimiting = true;
    }
    if (content.includes('compression') || content.includes('gzip') || content.includes('brotli')) {
      hasCompression = true;
    }
    if (content.includes('cors') || content.includes('cross-origin')) {
      hasCORS = true;
    }
    if (content.includes('helmet') || content.includes('security headers')) {
      hasHelmet = true;
    }
    if (content.includes('morgan') || content.includes('http logger')) {
      hasMorgan = true;
    }
    if (content.includes('jest') || content.includes('@testing-library')) {
      hasJest = true;
    }
    if (content.includes('mocha') || content.includes('chai') || content.includes('sinon')) {
      hasMocha = true;
    }
    if (content.includes('eslint') || content.includes('eslintrc')) {
      hasESLint = true;
    }
    if (content.includes('prettier') || content.includes('prettierrc')) {
      hasPrettier = true;
    }
    if (content.includes('husky') || content.includes('pre-commit')) {
      hasHusky = true;
    }
    if (content.includes('lint-staged') || content.includes('pre-commit hook')) {
      hasLintStaged = true;
    }
    if (content.includes('vitest') || content.includes('vitest.config')) {
      hasVitest = true;
    }
    if (content.includes('cypress') || content.includes('cypress.config')) {
      hasCypress = true;
    }
    if (content.includes('playwright') || content.includes('playwright.config')) {
      hasPlaywright = true;
    }
    if (content.includes('@testing-library/react') || content.includes('@testing-library/vue') || content.includes('@testing-library/angular')) {
      hasTestingLibrary = true;
    }
    if (content.includes('chai') || content.includes('expect(') || content.includes('assert(')) {
      hasChai = true;
    }
    if (content.includes('sinon') || content.includes('stub(') || content.includes('mock(')) {
      hasSinon = true;
    }
    if (content.includes('supertest') || content.includes('request(')) {
      hasSupertest = true;
    }
  });
  
  // Add detected features with descriptions
  if (hasExpress) features.push('Express.js backend framework with middleware support');
  if (hasReact) features.push('React frontend with modern hooks and state management');
  if (hasVue) features.push('Vue.js progressive framework with composition API');
  if (hasAngular) features.push('Angular enterprise framework with TypeScript');
  if (hasDatabase) features.push('Database integration with ORM/ODM support');
  if (hasTesting) features.push('Comprehensive testing suite with modern tools');
  if (hasDocker) features.push('Docker containerization for easy deployment');
  if (hasCI) features.push('Continuous Integration/Deployment pipeline');
  if (hasLinting) features.push('Code quality tools and formatting');
  if (hasTypeScript) features.push('TypeScript for type safety and better DX');
  if (hasPython) features.push('Python backend with extensive libraries');
  if (hasJava) features.push('Java enterprise-grade backend');
  if (hasGraphQL) features.push('GraphQL API with schema-first design');
  if (hasWebSocket) features.push('Real-time communication with WebSockets');
  if (hasAuthentication) features.push('Secure authentication and authorization');
  if (hasCaching) features.push('Performance optimization with caching');
  if (hasMonitoring) features.push('Application monitoring and metrics');
  if (hasLogging) features.push('Structured logging for debugging');
  if (hasErrorHandling) features.push('Robust error handling and recovery');
  if (hasValidation) features.push('Input validation and sanitization');
  if (hasRateLimiting) features.push('API rate limiting and protection');
  if (hasCompression) features.push('Response compression for performance');
  if (hasCORS) features.push('Cross-origin resource sharing support');
  if (hasHelmet) features.push('Security headers and protection');
  if (hasMorgan) features.push('HTTP request logging middleware');
  if (hasJest) features.push('Jest testing framework with coverage');
  if (hasMocha) features.push('Mocha testing framework with assertions');
  if (hasESLint) features.push('ESLint for code quality enforcement');
  if (hasPrettier) features.push('Prettier for consistent code formatting');
  if (hasHusky) features.push('Git hooks for pre-commit validation');
  if (hasLintStaged) features.push('Lint-staged for efficient code checking');
  if (hasVitest) features.push('Vitest fast unit testing framework powered by Vite');
  if (hasCypress) features.push('Cypress end-to-end testing for modern web apps');
  if (hasPlaywright) features.push('Playwright reliable web testing and automation');
  if (hasTestingLibrary) features.push('Testing Library for component testing');
  if (hasChai) features.push('Chai assertion library for expressive testing');
  if (hasSinon) features.push('Sinon for mocking, stubbing and spying');
  if (hasSupertest) features.push('Supertest for API testing and assertions');
  if (hasESLint) features.push('ESLint for code quality enforcement');
  
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
async function generateAIReadme(documentation, packageInfo, mainFile, mode = 'v2') {
  if (!geminiAI) {
    throw new Error('Gemini AI not initialized');
  }

  try {
    const model = geminiAI.getGenerativeModel({ model: AI_CONFIG.model });
    
    // Prepare the prompt based on selected mode
    let prompt;
    if (mode === 'v1') {
      prompt = buildAIPrompt(documentation, packageInfo, mainFile);
      console.log('🤖 Using AI v1 (comprehensive) prompt...');
    } else {
      prompt = buildAIPromptV2(documentation, packageInfo, mainFile);
      console.log('🤖 Using AI v2 (beginner-friendly) prompt...');
    }
    
    console.log(`   Model: ${AI_CONFIG.model}`);
    console.log(`   Mode: ${mode.toUpperCase()}`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiGeneratedReadme = response.text();
    
    if (!aiGeneratedReadme || aiGeneratedReadme.trim().length < 100) {
      throw new Error('AI generated content too short or empty');
    }
    
    console.log(`✅ AI generated README successfully (${mode.toUpperCase()})`);
    return aiGeneratedReadme;
    
  } catch (error) {
    console.error(`❌ AI generation error (${mode.toUpperCase()}):`, error);
    
    // Handle specific Gemini API errors
    if (error.message.includes('404 Not Found') || error.message.includes('models/')) {
      console.error('   This model may not be available. Try updating GEMINI_MODEL in your .env file.');
      console.error('   Available models: gemini-1.5-flash, gemini-1.5-pro, gemini-pro');
    }
    
    throw error;
  }
}

// Build comprehensive AI prompt for README generation (v1 - comprehensive)
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
  
  // Get testing framework information for better AI context
  const testingInfo = detectTestingFramework(documentation, packageInfo);
  
  const prompt = `You are an expert software developer and technical writer specializing in creating professional, comprehensive README.md files for GitHub repositories. Your goal is to create READMEs that match the quality and comprehensiveness of top-tier open source projects.

Generate a comprehensive, professional README.md file for a software project based on the following analysis:

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

TESTING FRAMEWORK ANALYSIS:
- Primary Framework: ${testingInfo.framework || 'Standard Testing'}
- Framework Description: ${testingInfo.description || 'Comprehensive testing capabilities'}
- Framework Version: ${testingInfo.version || 'Latest'}
- Coverage Tool: ${testingInfo.coverage || 'Standard coverage'}
- Test Files: ${testingInfo.testFiles.length} test files detected
- Test Scripts: ${testingInfo.testScripts.length} test scripts available

CODE SAMPLES:
${codeSnippets}

REQUIREMENTS - Create a README that is:

1. **VISUALLY APPEALING**: Use emojis, badges, and proper formatting to make it engaging
2. **COMPREHENSIVE**: Include all standard sections plus advanced ones like troubleshooting, deployment, etc.
3. **PROFESSIONAL**: Match the quality of top GitHub repositories (React, Vue, Express, etc.)
4. **USER-FRIENDLY**: Clear installation steps, usage examples, and configuration
5. **DEVELOPER-FOCUSED**: Include API documentation, architecture details, and contribution guidelines

MANDATORY SECTIONS TO INCLUDE:

**Header & Badges:**
- Project title with clear description
- Multiple badges (version, license, build status, coverage, etc.)
- Quick start section with immediate value

**Core Sections:**
- 🚀 Quick Start (get running in 2-3 commands)
- 📋 Table of Contents (comprehensive navigation)
- ✨ Features (detailed feature list with emojis)
- 📦 Installation (prerequisites + step-by-step)
- 🎯 Usage (basic + advanced examples)
- 🔍 Code Analysis (languages, patterns, architecture)
- 📚 API Reference (functions, endpoints, examples)
- 🏗️ Project Structure (visual file tree)
- 🤝 Contributing (detailed contribution guide)
- 🧪 Testing (comprehensive testing documentation)
- 🚀 Deployment (production + Docker)
- 🔧 Troubleshooting (common issues + solutions)
- 📄 License (clear licensing information)
- 💬 Support (community + contact info)

**Advanced Features:**
- Configuration examples with .env files
- Docker deployment instructions
- CI/CD setup suggestions
- Performance considerations
- Security best practices
- Browser compatibility (if applicable)
- Mobile considerations (if applicable)

**Testing Section Requirements (🧪 Testing):**
The testing section must be comprehensive and include:
- **Testing Framework Details**: Specific framework name, version, and description
- **Test Commands**: All available test scripts from package.json (test, test:watch, test:coverage, etc.)
- **Code Coverage Information**: Current coverage metrics, coverage goals, and coverage tools used
- **Test Structure**: Organization of test files (unit, integration, e2e tests)
- **Testing Best Practices**: Guidelines for writing and running tests
- **Test Configuration**: Environment variables and configuration options
- **Continuous Integration**: How tests are run in CI/CD pipelines
- **Debugging Tests**: Commands for troubleshooting test issues
- **Test Examples**: Sample test code snippets if applicable

**Specific Testing Requirements:**
Based on the detected testing framework (${testingInfo.framework}), ensure the testing section includes:
- **Framework-specific commands** and configuration
- **Coverage reporting** using ${testingInfo.coverage || 'standard coverage tools'}
- **Test organization** based on the ${testingInfo.testFiles.length} detected test files
- **Available test scripts** from package.json (${testingInfo.testScripts.length} found)
- **Testing patterns** and best practices for the detected framework
- **Integration with CI/CD** pipelines
- **Debugging and troubleshooting** specific to the testing setup

**Formatting Requirements:**
- Use emojis for section headers (🚀, 📦, 🎯, etc.)
- Include code blocks with proper syntax highlighting
- Use tables for structured information
- Add badges and shields for visual appeal
- Include proper anchor links in table of contents
- Use bold text for important information
- Include practical examples and use cases

**Tone & Style:**
- Professional yet approachable
- Clear and concise language
- Actionable instructions
- Encouraging for contributors
- Helpful for new users
- Comprehensive for advanced users

The README should be production-ready and immediately usable. It should make developers want to use, contribute to, and star the project. Focus on being helpful, comprehensive, and professional.

Generate only the README content in Markdown format, starting with the title. Make it at least 3-4 times more comprehensive than a basic README.`;

  return prompt;
}

// Build simple, focused AI prompt for README generation (v2 - beginner-friendly)
function buildAIPromptV2(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  const description = packageInfo?.description || '';
  
  // Extract key information for the AI
  const languages = Object.keys(documentation.summary.languages || {});
  const totalFiles = documentation.summary.totalFiles || 0;
  const totalDirs = documentation.summary.totalDirectories || 0;
  
  // Get file tree structure
  const fileTree = generateFileTree(documentation.structure);
  
  // Get key files content
  const keyFiles = documentation.files
    .filter(f => f.raw && f.raw.length > 50)
    .slice(0, 3)
    .map(f => `File: ${f.path}\nContent: ${f.raw.substring(0, 200)}...`)
    .join('\n\n');
  
  // Get dependencies
  const dependencies = [];
  if (packageInfo) {
    if (packageInfo.dependencies) {
      Object.entries(packageInfo.dependencies).forEach(([name, version]) => {
        dependencies.push(`${name} ${version}`);
      });
    }
    if (packageInfo.devDependencies) {
      Object.entries(packageInfo.devDependencies).forEach(([name, version]) => {
        dependencies.push(`${name} ${version} (dev)`);
      });
    }
  }
  
  // Check for existing docs
  const existingDocs = documentation.readme ? 'README.md (existing)' : 'No existing documentation';
  
  const prompt = `You are GitGen, an AI documentation generator. 
Your task is to generate a professional, beginner-friendly, and well-structured README.md file for the provided repository. 
Follow GitHub README best practices, use clean Markdown, and make the output production-ready.

Repository Name: ${projectName}
Description: ${description}

File Tree:
${fileTree}

Key Files and Contents (summarized or full text if small):
${keyFiles}

Dependencies (from package.json, requirements.txt, etc.):
${dependencies.join(', ') || 'No dependencies detected'}

Existing Docs (if any):
${existingDocs}

---

🛠️ Instructions for README generation:
1. Start with a clear title and short project description.
2. Add badges if relevant (build status, license, etc.).
3. Create an Installation section with setup instructions based on dependencies.
4. Add a Usage section with code snippets or command examples.
5. If the project has services, configs, or scripts, document how to run them.
6. Add a Features section if possible (infer from files and dependencies).
7. Add a Contributing section if not already present.
8. Add a License section (use LICENSE file if available).
9. Format everything properly in Markdown with headings, lists, and code blocks.

If project purpose is unclear, infer from context (file names, dependencies, comments) and state assumptions.
Keep the tone concise, helpful, and professional.

Generate only the README content in Markdown format, starting with the title.`;

  return prompt;
}

// Generate file tree for v2 prompt
function generateFileTree(structure, prefix = '') {
  const lines = [];
  
  function addStructureLines(structure, prefix = '') {
    Object.entries(structure).forEach(([name, info]) => {
      if (info.type === 'directory') {
        lines.push(`${prefix}- ${name}/`);
        if (info.children) {
          addStructureLines(info.children, prefix + '  ');
        }
      } else {
        lines.push(`${prefix}- ${name}`);
      }
    });
  }
  
  addStructureLines(structure, prefix);
  return lines.slice(0, 50).join('\n'); // Limit to first 50 items
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
  
  // Add comprehensive badges
  readme += `![Version](https://img.shields.io/badge/version-${version}-blue.svg)\n`;
  readme += `![License](https://img.shields.io/badge/license-${license}-green.svg)\n`;
  readme += `![Maintenance](https://img.shields.io/badge/maintained-yes-green.svg)\n`;
  readme += `![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)\n`;
  readme += `![Issues](https://img.shields.io/badge/issues-welcome-brightgreen.svg)\n\n`;
  
  // Project description
  readme += `${description}\n\n`;
  
  // Quick start section
  readme += `## 🚀 Quick Start\n\n`;
  readme += `Get up and running in minutes:\n\n`;
  const installCommands = generateInstallCommands(packageInfo, documentation);
  installCommands.forEach(cmd => {
    readme += `\`\`\`bash\n${cmd}\n\`\`\`\n\n`;
  });
  
  // Table of Contents
  readme += `## 📋 Table of Contents\n\n`;
  readme += `- [Features](#-features)\n`;
  readme += `- [Installation](#-installation)\n`;
  readme += `- [Usage](#-usage)\n`;
  readme += `- [API Reference](#-api-reference)\n`;
  readme += `- [Architecture](#-architecture)\n`;
  readme += `- [Contributing](#-contributing)\n`;
  readme += `- [Testing](#-testing)\n`;
  readme += `- [Deployment](#-deployment)\n`;
  readme += `- [Troubleshooting](#-troubleshooting)\n`;
  readme += `- [License](#-license)\n`;
  readme += `- [Support](#-support)\n\n`;
  
  // Features section
  readme += `## ✨ Features\n\n`;
  if (documentation.files.length > 0) {
    const languages = Object.keys(documentation.summary.languages || {});
    readme += `- **Multi-language support**: ${languages.join(', ')}\n`;
    readme += `- **${documentation.summary.totalFiles} source files** with comprehensive analysis\n`;
    readme += `- **${documentation.summary.totalDirectories} organized directories**\n`;
    
    // Add intelligent feature detection
    const features = detectProjectFeatures(documentation);
    features.forEach(feature => {
      readme += `- **${feature}**\n`;
    });
  }
  readme += `- **Modern architecture** with best practices\n`;
  readme += `- **Easy to use** with minimal configuration\n`;
  readme += `- **Well documented** with comprehensive examples\n`;
  readme += `- **Production ready** with error handling and logging\n\n`;
  
  // Installation section
  readme += `## 📦 Installation\n\n`;
  readme += `### Prerequisites\n\n`;
  readme += `- Node.js ${packageInfo?.engines?.node || '14.0.0'} or higher\n`;
  readme += `- npm or yarn package manager\n`;
  readme += `- Git for version control\n\n`;
  
  readme += `### Step-by-step Installation\n\n`;
  installCommands.forEach((cmd, index) => {
    readme += `${index + 1}. **${cmd.split('\n')[0]}**\n`;
    readme += `   \`\`\`bash\n${cmd}\n   \`\`\`\n\n`;
  });
  
  // Usage section
  readme += `## 🎯 Usage\n\n`;
  readme += `### Basic Usage\n\n`;
  const usageCommands = generateUsageCommands(packageInfo, mainFile, documentation);
  usageCommands.forEach((cmd, index) => {
    readme += `${index + 1}. **${cmd.split('\n')[0]}**\n`;
    readme += `   \`\`\`bash\n${cmd}\n   \`\`\`\n\n`;
  });
  
  // Add configuration section
  readme += `### Configuration\n\n`;
  readme += `Create a \`.env\` file in your project root:\n\n`;
  readme += `\`\`\`env\n# Environment variables\nNODE_ENV=development\nPORT=3000\nAPI_KEY=your_api_key_here\n\`\`\`\n\n`;
  
  // Code Analysis section
  readme += `## 🔍 Code Analysis\n\n`;
  
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
    readme += `### Design Patterns & Architecture\n\n`;
    codeAnalysis.patterns.forEach(pattern => {
      readme += `- **${pattern.name}**: ${pattern.description}\n`;
    });
    readme += `\n`;
  }
  
  // API Reference section
  if (documentation.files.some(f => f.functions && f.functions.length > 0)) {
    readme += `## 📚 API Reference\n\n`;
    readme += `### Core Functions\n\n`;
    
    const allFunctions = [];
    documentation.files.forEach(file => {
      if (file.functions) {
        file.functions.forEach(func => {
          allFunctions.push({ name: func, file: file.path });
        });
      }
    });
    
    // Show first 15 functions with more detail
    allFunctions.slice(0, 15).forEach(func => {
      readme += `- \`${func.name}\` - Defined in \`${func.file}\`\n`;
    });
    
    if (allFunctions.length > 15) {
      readme += `- ... and ${allFunctions.length - 15} more functions\n`;
    }
    readme += `\n`;
    
    readme += `### API Endpoints\n\n`;
    readme += `| Method | Endpoint | Description |\n`;
    readme += `|--------|-----------|-------------|\n`;
    readme += `| GET | \`/api/health\` | Health check endpoint |\n`;
    readme += `| GET | \`/api/projects\` | List all projects |\n`;
    readme += `| POST | \`/api/projects\` | Create new project |\n`;
    readme += `| GET | \`/api/projects/:id\` | Get project details |\n\n`;
  }
  
  // Project Structure section
  readme += `## 🏗️ Project Structure\n\n`;
  
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
  readme += structureLines.slice(0, 30).join('\n');
  if (structureLines.length > 30) {
    readme += `\n... and ${structureLines.length - 30} more files`;
  }
  readme += `\n\`\`\`\n\n`;
  
  // Contributing section
  readme += `## 🤝 Contributing\n\n`;
  readme += `We welcome contributions! Please read our contributing guidelines.\n\n`;
  readme += `### How to Contribute\n\n`;
  readme += `1. **Fork the project**\n`;
  readme += `2. **Create your feature branch** (\`git checkout -b feature/AmazingFeature\`)\n`;
  readme += `3. **Commit your changes** (\`git commit -m 'Add some AmazingFeature'\`)\n`;
  readme += `4. **Push to the branch** (\`git push origin feature/AmazingFeature\`)\n`;
  readme += `5. **Open a Pull Request**\n\n`;
  
  readme += `### Development Setup\n\n`;
  readme += `\`\`\`bash\n# Clone the repository\ngit clone https://github.com/username/${projectName}.git\ncd ${projectName}\n\n# Install dependencies\nnpm install\n\n# Run tests\nnpm test\n\n# Start development server\nnpm run dev\n\`\`\`\n\n`;
  
  // Testing section
  readme += `## 🧪 Testing\n\n`;
  
  // Enhanced testing framework detection
  const testingInfo = detectTestingFramework(documentation, packageInfo);
  
  readme += `### Testing Framework\n\n`;
  if (testingInfo.framework) {
    readme += `This project uses **${testingInfo.framework}** as the primary testing framework.\n\n`;
    
    if (testingInfo.description) {
      readme += `${testingInfo.description}\n\n`;
    }
    
    if (testingInfo.version) {
      readme += `**Version**: ${testingInfo.version}\n\n`;
    }
  } else {
    readme += `This project includes comprehensive testing capabilities.\n\n`;
  }
  
  readme += `### Running Tests\n\n`;
  
  // Enhanced test commands based on package.json scripts
  if (packageInfo && packageInfo.scripts) {
    const testScripts = Object.entries(packageInfo.scripts)
      .filter(([key, value]) => key.includes('test') || key.includes('spec'))
      .map(([key, value]) => ({ key, value }));
    
    if (testScripts.length > 0) {
      testScripts.forEach(({ key, value }) => {
        readme += `**${key}**:\n`;
        readme += `\`\`\`bash\n${value}\n\`\`\`\n\n`;
      });
    } else {
      readme += `\`\`\`bash\n# Run all tests\nnpm test\n\n# Run tests in watch mode\nnpm run test:watch\n\n# Run tests with coverage\nnpm run test:coverage\n\`\`\`\n\n`;
    }
  } else {
    readme += `\`\`\`bash\n# Run all tests\nnpm test\n\n# Run tests in watch mode\nnpm run test:watch\n\n# Run tests with coverage\nnpm run test:coverage\n\`\`\`\n\n`;
  }
  
  // Test coverage information
  readme += `### Test Coverage\n\n`;
  readme += `We maintain high test coverage to ensure code quality and reliability.\n\n`;
  
  if (testingInfo.coverage) {
    readme += `**Current Coverage**: ${testingInfo.coverage}\n\n`;
  }
  
  readme += `**Coverage Goals**:\n`;
  readme += `- **Statements**: >90%\n`;
  readme += `- **Branches**: >85%\n`;
  readme += `- **Functions**: >90%\n`;
  readme += `- **Lines**: >90%\n\n`;
  
  // Test structure and organization
  if (testingInfo.testFiles && testingInfo.testFiles.length > 0) {
    readme += `### Test Structure\n\n`;
    readme += `Tests are organized in the following structure:\n\n`;
    testingInfo.testFiles.forEach(testFile => {
      readme += `- \`${testFile}\` - ${testFile.includes('unit') ? 'Unit tests' : testFile.includes('integration') ? 'Integration tests' : testFile.includes('e2e') ? 'End-to-end tests' : 'Test file'}\n`;
    });
    readme += `\n`;
  }
  
  // Testing best practices
  readme += `### Testing Best Practices\n\n`;
  readme += `- **Unit Tests**: Test individual functions and components in isolation\n`;
  readme += `- **Integration Tests**: Test how different parts work together\n`;
  readme += `- **End-to-End Tests**: Test complete user workflows\n`;
  readme += `- **Mocking**: Use mocks for external dependencies and API calls\n`;
  readme += `- **Test Data**: Use fixtures and factories for consistent test data\n`;
  readme += `- **Assertions**: Use descriptive assertions that clearly show what failed\n\n`;
  
  // Test configuration
  readme += `### Test Configuration\n\n`;
  readme += `Tests can be configured using environment variables:\n\n`;
  readme += `\`\`\`env\n# Test environment\nNODE_ENV=test\nTEST_TIMEOUT=10000\nCOVERAGE_THRESHOLD=90\n\`\`\`\n\n`;
  
  // Continuous Integration testing
  readme += `### Continuous Integration\n\n`;
  readme += `All tests are automatically run on every pull request and commit:\n\n`;
  readme += `- **Pre-commit**: Linting and unit tests\n`;
  readme += `- **Pull Request**: Full test suite with coverage\n`;
  readme += `- **Main Branch**: Integration and end-to-end tests\n\n`;
  
  // Debugging tests
  readme += `### Debugging Tests\n\n`;
  readme += `\`\`\`bash\n# Run tests with verbose output\nnpm test -- --verbose\n\n# Run specific test file\nnpm test -- --testPathPattern=user.test.js\n\n# Run tests with debugging\nnpm test -- --inspect-brk\n\`\`\`\n\n`;
  
  // Deployment section
  readme += `## 🚀 Deployment\n\n`;
  readme += `### Production Build\n\n`;
  readme += `\`\`\`bash\n# Build for production\nnpm run build\n\n# Start production server\nnpm start\n\`\`\`\n\n`;
  
  readme += `### Docker Deployment\n\n`;
  readme += `\`\`\`bash\n# Build Docker image\ndocker build -t ${projectName} .\n\n# Run container\ndocker run -p 3000:3000 ${projectName}\n\`\`\`\n\n`;
  
  // Troubleshooting section
  readme += `## 🔧 Troubleshooting\n\n`;
  readme += `### Common Issues\n\n`;
  readme += `| Issue | Solution |\n`;
  readme += `|-------|----------|\n`;
  readme += `| Port already in use | Change PORT in .env file |\n`;
  readme += `| Module not found | Run \`npm install\` |\n`;
  readme += `| Build fails | Check Node.js version compatibility |\n\n`;
  
  readme += `### Getting Help\n\n`;
  readme += `- Check the [Issues](../../issues) page for known problems\n`;
  readme += `- Create a new issue with detailed error information\n`;
  readme += `- Join our community discussions\n\n`;
  
  // License section
  readme += `## 📄 License\n\n`;
  readme += `This project is licensed under the ${license} License - see the [LICENSE](LICENSE) file for details.\n\n`;
  
  // Support section
  readme += `## 💬 Support\n\n`;
  readme += `### Community\n\n`;
  readme += `- **Discussions**: [GitHub Discussions](../../discussions)\n`;
  readme += `- **Issues**: [GitHub Issues](../../issues)\n`;
  readme += `- **Wiki**: [Project Wiki](../../wiki)\n\n`;
  
  readme += `### Contact\n\n`;
  readme += `- **Email**: support@${projectName}.com\n`;
  readme += `- **Twitter**: [@${projectName}](https://twitter.com/${projectName})\n`;
  readme += `- **Discord**: [Join our server](https://discord.gg/${projectName})\n\n`;
  
  // Footer
  readme += `---\n\n`;
  readme += `<div align="center">\n\n`;
  readme += `**Made with ❤️ by the ${projectName} team**\n\n`;
  readme += `[![GitHub stars](https://img.shields.io/github/stars/username/${projectName}.svg?style=social&label=Star)](https://github.com/username/${projectName})\n`;
  readme += `[![GitHub forks](https://img.shields.io/github/forks/username/${projectName}.svg?style=social&label=Fork)](https://github.com/username/${projectName})\n`;
  readme += `[![GitHub watchers](https://img.shields.io/github/watchers/username/${projectName}.svg?style=social&label=Watch)](https://github.com/username/${projectName})\n\n`;
  readme += `</div>\n`;
  
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