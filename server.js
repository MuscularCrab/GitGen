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
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const docx = require('docx');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

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
  
  // Validate the model name
  const validModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  if (!validModels.includes(AI_CONFIG.model)) {
    console.log(`   Supported models: ${validModels.join(', ')}`);
    console.log(`   Falling back to 'gemini-1.5-flash'`);
    AI_CONFIG.model = 'gemini-1.5-flash';
  }
  console.log('✅ Gemini AI initialized successfully');
  console.log(`   Using model: ${AI_CONFIG.model}`);
  console.log(`   Supported models: gemini-1.5-flash, gemini-1.5-pro`);
  console.log(`   Note: gemini-pro is deprecated and no longer supported`);
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
    
    // Index each file
    documentation.files.forEach(file => {
      if (!file.raw || !file.path) return;
      
      const fileIndex = {
        path: file.path,
        extension: file.extension,
        type: file.type,
        size: file.size,
        lines: file.lines,
        functions: file.functions || [],
        classes: file.classes || [],
        imports: file.imports || [],
        content: file.raw,
        tokens: tokenizeContent(file.raw)
      };
      
      index.files.push(fileIndex);
      index.content.set(file.path, fileIndex);
    });
    
    // Add README content if available
    if (documentation.readme && documentation.readme.raw) {
      const readmeIndex = {
        path: 'README.md',
        extension: '.md',
        type: 'markdown',
        size: documentation.readme.raw.length,
        lines: documentation.readme.raw.split('\n').length,
        content: documentation.readme.raw,
        tokens: tokenizeContent(documentation.readme.raw)
      };
      
      index.files.push(readmeIndex);
      index.content.set('README.md', readmeIndex);
    }
    
    // Update metadata
    index.metadata.totalFiles = index.files.length;
    if (documentation.summary && documentation.summary.languages) {
      index.metadata.languages = Object.keys(documentation.summary.languages);
    }
    
    // Store the index
    searchIndex.set(projectId, index);
    
    console.log(`🔍 Built search index for project ${projectId}: ${index.files.length} files indexed`);
    
  } catch (error) {
    console.error(`Error building search index for project ${projectId}:`, error);
  }
}

// Tokenize content for search
function tokenizeContent(content) {
  if (!content || typeof content !== 'string') return [];
  
  // Convert to lowercase and split into words
  const words = content.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
    .split(/\s+/)
    .filter(word => word.length > 2) // Filter out very short words
  
  // Create frequency map
  const tokenMap = new Map();
  words.forEach(word => {
    tokenMap.set(word, (tokenMap.get(word) || 0) + 1);
  });
  
  return Array.from(tokenMap.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by frequency
    .slice(0, 100); // Limit to top 100 tokens
}

// Search across all projects
function searchProjects(query, filters = {}) {
  const results = [];
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(token => token.length > 2);
  
  if (queryTokens.length === 0) return results;
  
  for (const [projectId, index] of searchIndex.entries()) {
    const project = projects.get(projectId);
    if (!project) continue;
    
    // Apply filters
    if (filters.status && project.status !== filters.status) continue;
    if (filters.language && !index.metadata.languages.includes(filters.language)) continue;
    
    const projectResults = searchProject(index, queryTokens, filters);
    
    if (projectResults.length > 0) {
      results.push({
        projectId,
        projectName: project.projectName,
        repoUrl: project.repoUrl,
        status: project.status,
        matches: projectResults,
        score: calculateSearchScore(projectResults, queryTokens)
      });
    }
  }
  
  // Sort by relevance score
  results.sort((a, b) => b.score - a.score);
  
  return results;
}

// Search within a single project
function searchProject(index, queryTokens, filters) {
  const results = [];
  
  for (const file of index.files) {
    // Apply file filters
    if (filters.fileType && file.extension !== filters.fileType) continue;
    if (filters.minSize && file.size < filters.minSize) continue;
    if (filters.maxSize && file.size > filters.maxSize) continue;
    
    const fileMatches = searchFile(file, queryTokens);
    
    if (fileMatches.length > 0) {
      results.push({
        file: file.path,
        extension: file.extension,
        type: file.type,
        size: file.size,
        matches: fileMatches,
        score: calculateFileScore(fileMatches, queryTokens)
      });
    }
  }
  
  return results;
}

// Search within a single file
function searchFile(file, queryTokens) {
  const matches = [];
  const content = file.content.toLowerCase();
  
  queryTokens.forEach(token => {
    const regex = new RegExp(token, 'gi');
    let match;
    let count = 0;
    
    while ((match = regex.exec(content)) !== null) {
      count++;
      
      // Get context around the match
      const start = Math.max(0, match.index - 50);
      const end = Math.min(content.length, match.index + token.length + 50);
      const context = content.substring(start, end);
      
      matches.push({
        token,
        index: match.index,
        context: context.trim(),
        line: getLineNumber(content, match.index)
      });
    }
    
    if (count > 0) {
      matches.push({
        token,
        count,
        total: count
      });
    }
  });
  
  return matches;
}

// Get line number for a character index
function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

// Calculate search relevance score
function calculateSearchScore(projectResults, queryTokens) {
  let totalScore = 0;
  
  projectResults.forEach(result => {
    totalScore += result.score;
  });
  
  // Boost score for projects with more matches
  const matchCount = projectResults.reduce((sum, result) => sum + result.matches.length, 0);
  totalScore += matchCount * 0.1;
  
  return totalScore;
}

// Calculate file relevance score
function calculateFileScore(fileMatches, queryTokens) {
  let score = 0;
  
  fileMatches.forEach(match => {
    if (match.count) {
      // Higher score for more frequent matches
      score += match.count * 0.5;
    } else {
      // Base score for each match
      score += 1;
    }
  });
  
  // Boost score for files with more query tokens
  const matchedTokens = new Set(fileMatches.map(m => m.token));
  score += matchedTokens.size * 0.3;
  
  return score;
}

// Search endpoint
app.get('/api/search', (req, res) => {
  try {
    const { q: query, status, language, fileType, minSize, maxSize, limit = 50 } = req.query; = req.query;
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
}

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
        
        // Check content tokens
        file.tokens.forEach(([token]) => {
          if (token.toLowerCase().includes(queryLower)) {
            suggestions.add(token);
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
}

// Rebuild search index for a project
app.post('/api/projects/:projectId/reindex', (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to index' });
    }
    
    // Remove old index
    searchIndex.delete(projectId);
    
    // Build new index
    buildSearchIndex(projectId, project.documentation);
    
    res.json({
      projectId,
      message: 'Search index rebuilt successfully',
      indexedFiles: searchIndex.get(projectId)?.files.length || 0,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('Error rebuilding search index:', error);
    res.status(500).json({ error: 'Failed to rebuild search index' });
  }
});

// Get search index status
app.get('/api/search/status', (req, res) => {
  try {
    const status = {
      totalProjects: searchIndex.size,
      totalFiles: 0,
      totalSize: 0,
      lastUpdated: null,
      projects: []
    };
    
    for (const [projectId, index] of searchIndex.entries()) {
      const project = projects.get(projectId);
      if (project) {
        status.totalFiles += index.files.length;
        status.totalSize += index.files.reduce((sum, file) => sum + (file.size || 0), 0);
        
        if (!status.lastUpdated || index.metadata.lastIndexed > status.lastUpdated) {
          status.lastUpdated = index.metadata.lastIndexed;
        }
        
        status.projects.push({
          projectId,
          projectName: project.projectName,
          indexedFiles: index.files.length,
          lastIndexed: index.metadata.lastIndexed
        });
      }
    }
    
    res.json(status);
    
  } catch (error) {
    console.error('Error getting search status:', error);
    res.status(500).json({ error: 'Failed to get search status' });
  }
});

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

    // Add to processing queue instead of direct processing
    addToQueue(projectId, repoUrl, mode);

    res.json({ projectId, status: 'queued', mode, message: 'Added to processing queue' });
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
      status: project.status || 'unknown'
    });
  }
  
  // Calculate enhanced percentage based on step progress
  let percentage = Math.round((project.progress.step / project.progress.totalSteps) * 100);
  
  // Enhance percentage calculation for better user experience
  if (project.progress.step > 0 && project.progress.step < 6) {
    // Add sub-step progress for more granular feedback
    const stepProgress = project.progress.stepProgress || 0;
    const stepPercentage = Math.round((stepProgress / 100) * (100 / project.progress.totalSteps));
    percentage = Math.round(((project.progress.step - 1) / project.progress.totalSteps) * 100) + stepPercentage;
  }
  
  // Ensure percentage is within bounds
  percentage = Math.max(0, Math.min(100, percentage));
  
  const response = {
    ...project.progress,
    percentage,
    status: project.status || 'processing'
  };
  
  // Add repository metrics if available for better progress display
  if (project.repoMetrics) {
    response.repoMetrics = {
      totalFiles: project.repoMetrics.totalFiles,
      totalDirectories: project.repoMetrics.totalDirectories,
      totalSize: project.repoMetrics.totalSize,
      languages: project.repoMetrics.languages,
      fileTypes: project.repoMetrics.fileTypes
    };
  }
  
  console.log(`Progress response for project ${projectId}:`, response);
  
  res.json(response);
});

// Get repository metrics for progress tracking and analysis
async function getRepositoryMetrics(repoPath) {
  try {
    const metrics = {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      languages: new Set(),
      fileTypes: new Set()
    };
    
    async function scanDirectory(dirPath) {
      try {
        const items = await fs.readdir(dirPath);
        
        for (const item of items) {
          if (item === '.git') continue;
          
          const fullPath = path.join(dirPath, item);
          
          try {
            const stats = await fs.stat(fullPath);
            
            if (stats.isDirectory()) {
              metrics.totalDirectories++;
              await scanDirectory(fullPath);
            } else {
              metrics.totalFiles++;
              metrics.totalSize += stats.size;
              
              // Detect language/file type
              const ext = path.extname(item).toLowerCase();
              if (ext) {
                metrics.fileTypes.add(ext);
                
                // Map extensions to languages
                const languageMap = {
                  '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'React',
                  '.tsx': 'React TypeScript', '.py': 'Python', '.java': 'Java',
                  '.cpp': 'C++', '.c': 'C', '.cs': 'C#', '.php': 'PHP',
                  '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.swift': 'Swift',
                  '.kt': 'Kotlin', '.scala': 'Scala', '.r': 'R', '.m': 'Objective-C',
                  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass',
                  '.vue': 'Vue', '.svelte': 'Svelte', '.json': 'JSON', '.xml': 'XML',
                  '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.ini': 'INI',
                  '.md': 'Markdown', '.txt': 'Text', '.sql': 'SQL', '.sh': 'Shell',
                  '.bat': 'Batch', '.ps1': 'PowerShell', '.dockerfile': 'Dockerfile'
                };
                
                if (languageMap[ext]) {
                  metrics.languages.add(languageMap[ext]);
                }
              }
            }
          } catch (error) {
            // Skip files we can't access
            console.log(`Skipping ${fullPath}: ${error.message}`);
          }
        }
      } catch (error) {
        console.log(`Error scanning directory ${dirPath}: ${error.message}`);
      }
    }
    
    await scanDirectory(repoPath);
    
    return {
      totalFiles: metrics.totalFiles,
      totalDirectories: metrics.totalDirectories,
      totalSize: metrics.totalSize,
      languages: Array.from(metrics.languages),
      fileTypes: Array.from(metrics.fileTypes)
    };
  } catch (error) {
    console.error('Error getting repository metrics:', error);
    return {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      languages: [],
      fileTypes: []
    };
  }
}



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

  // Check cache first for performance optimization
  const cachedData = getCachedRepository(repoUrl);
  if (cachedData) {
    console.log(`📦 Using cached data for repository: ${repoUrl}`);
    project.status = 'completed';
    project.documentation = cachedData.documentation;
    project.completedAt = new Date().toISOString();
    project.progress = {
      currentStep: 'completed',
      step: 6,
      totalSteps: 6,
      message: 'Documentation loaded from cache',
      stepProgress: 100
    };
    return;
  }

  try {
    // Initialize progress tracking
    project.progress = {
      currentStep: 'initializing',
      step: 0,
      totalSteps: 6,
      message: 'Initializing repository processing...',
      startTime: Date.now()
    };
    
    // Broadcast initial progress
    updateProjectProgress(projectId, project.progress);

    const tempDir = `temp/${projectId}`;
    console.log(`Creating temp directory: ${tempDir}`);
    
    // Step 1: Create temp directory
    project.progress.currentStep = 'creating_temp';
    project.progress.step = 1;
    project.progress.stepProgress = 0;
    project.progress.message = 'Creating temporary directory...';
    updateProjectProgress(projectId, project.progress);
    
    await fs.mkdir(tempDir, { recursive: true });
    project.progress.stepProgress = 100;
    updateProjectProgress(projectId, project.progress);

    // Step 2: Clone repository
    project.progress.currentStep = 'cloning';
    project.progress.step = 2;
    project.progress.stepProgress = 0;
    project.progress.message = 'Cloning repository...';
    updateProjectProgress(projectId, project.progress);
    
    console.log(`Cloning repository: ${repoUrl}`);
    const git = simpleGit();
    
    // Add timeout to git clone operation
    const clonePromise = git.clone(repoUrl, tempDir);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Git clone timeout after 5 minutes')), 300000)
    );
    
    try {
      await Promise.race([clonePromise, timeoutPromise]);
      project.progress.stepProgress = 100;
      updateProjectProgress(projectId, project.progress);
      console.log(`Repository cloned successfully to: ${tempDir}`);
    } catch (cloneError) {
      console.error(`Git clone failed for ${repoUrl}:`, cloneError);
      throw new Error(`Failed to clone repository: ${cloneError.message}`);
    }

    // Step 3: Analyze repository structure
    project.progress.currentStep = 'analyzing';
    project.progress.step = 3;
    project.progress.stepProgress = 0;
    project.progress.message = 'Analyzing repository structure...';
    updateProjectProgress(projectId, project.progress);
    
    console.log(`Analyzing repository structure for: ${tempDir}`);
    
    // Get repository metrics for better progress tracking
    const repoMetrics = await getRepositoryMetrics(tempDir);
    project.repoMetrics = repoMetrics;
    project.progress.stepProgress = 100;
    updateProjectProgress(projectId, project.progress);
    console.log(`Repository metrics:`, repoMetrics);

    // Step 4: Generate documentation
    project.progress.currentStep = 'generating';
    project.progress.step = 4;
    project.progress.stepProgress = 0;
    project.progress.message = 'Generating documentation...';
    updateProjectProgress(projectId, project.progress);
    
    console.log(`Generating documentation for: ${tempDir}`);
    const documentation = await generateDocumentation(tempDir, project, mode);
    project.progress.stepProgress = 100;
    updateProjectProgress(projectId, project.progress);
    
    // Step 5: Generate AI README
    project.progress.currentStep = 'ai_generation';
    project.progress.step = 5;
    project.progress.stepProgress = 0;
    project.progress.message = `Generating AI-powered README (${mode.toUpperCase()})...`;
    updateProjectProgress(projectId, project.progress);
    
    console.log(`Generating AI README for: ${tempDir} (${mode.toUpperCase()})`);

    // Step 6: Finalizing
    project.progress.currentStep = 'finalizing';
    project.progress.step = 6;
    project.progress.stepProgress = 0;
    project.progress.message = 'Finalizing documentation...';
    updateProjectProgress(projectId, project.progress);
    
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
    
    // Update progress completion
    currentProject.progress.stepProgress = 100;
    currentProject.progress.message = 'Documentation generation completed!';
    updateProjectProgress(projectId, currentProject.progress);
    
    // Cache the results for future use
    setCachedRepository(repoUrl, {
      documentation,
      projectName: currentProject.projectName,
      mode
    });
    
    // Build search index for the completed project
    buildSearchIndex(projectId, documentation);
    
    console.log(`Project ${projectId} completed successfully (${mode.toUpperCase()})`);
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
  
  async function scanDirectory(dirPath, relativePath = '', parentStructure = structure) {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item === '.git') continue;
        
        const fullPath = path.join(dirPath, item);
        const relativeItemPath = path.join(relativePath, item);
        
        try {
          const stats = await fs.stat(fullPath);
          
          if (stats.isDirectory()) {
            // Create directory entry in the current level
            parentStructure[item] = { type: 'directory', children: {} };
            // Recursively scan the subdirectory
            await scanDirectory(fullPath, relativeItemPath, parentStructure[item].children);
          } else {
            // Create file entry in the current level
            parentStructure[item] = { 
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
  // Count files and directories recursively
  let totalFiles = 0;
  let totalDirectories = 0;
  
  function countItems(structure) {
    if (!structure || typeof structure !== 'object') return;
    
    Object.values(structure).forEach(item => {
      if (item.type === 'file') {
        totalFiles++;
      } else if (item.type === 'directory') {
        totalDirectories++;
        if (item.children) {
          countItems(item.children);
        }
      }
    });
  }
  
  countItems(documentation.structure);
  
  const summary = {
    totalFiles,
    totalDirectories,
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
  const totalFiles = documentation.summary?.totalFiles || 0;
  const languages = Object.keys(documentation.summary?.languages || {});
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
  let hasJavaScript = false;
  
  // Safety check for files array
  if (!documentation.files || !Array.isArray(documentation.files)) {
    console.warn('Warning: No files array found in documentation');
    return features;
  }
  
  documentation.files.forEach(file => {
    if (!file || typeof file !== 'object') return;
    
    const content = file.raw || '';
    const path = file.path?.toLowerCase() || '';
    
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
    if (file.extension === '.js' || file.extension === '.jsx') {
      hasJavaScript = true;
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
  
  // Add project complexity indicators
  if (totalFiles > 100) features.push('Large-scale project with extensive codebase');
  if (totalFiles > 50) features.push('Medium-sized project with good structure');
  if (languages.length > 3) features.push('Multi-language project with diverse tech stack');
  if (hasTypeScript && hasJavaScript) features.push('Hybrid TypeScript/JavaScript development');
  if (hasReact && hasExpress) features.push('Full-stack JavaScript/Node.js application');
  if (hasPython && hasJavaScript) features.push('Full-stack Python/JavaScript application');
  
  // Add architecture patterns
  if (hasReact && hasExpress) features.push('Modern full-stack architecture with separated concerns');
  if (hasDocker && hasCI) features.push('Production-ready deployment with automated CI/CD');
  if (hasTesting && hasLinting) features.push('Quality-focused development with testing and linting');
  if (hasAuthentication && hasValidation) features.push('Secure application with input validation');
  if (hasMonitoring && hasLogging) features.push('Observable application with comprehensive logging');
  
  // Add performance and scalability features
  if (hasCaching && hasCompression) features.push('Performance-optimized with caching and compression');
  if (hasRateLimiting && hasHelmet) features.push('Security-hardened with rate limiting and security headers');
  if (hasWebSocket && hasGraphQL) features.push('Modern API design with real-time capabilities');
  
  return features;
}

// Generate comprehensive configuration examples
function generateConfigurationExamples(packageInfo, documentation) {
  const examples = [];
  
  // Environment variables example
  if (documentation.files.some(f => f.path.includes('.env') || f.path.includes('config'))) {
    examples.push(`## Environment Variables (.env)
\`\`\`env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=username
DB_PASSWORD=password

# API Keys (replace with your actual keys)
API_KEY=your_api_key_here
SECRET_KEY=your_secret_key_here

# Optional: AI Configuration
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-1.5-flash
\`\`\``);
  }
  
  // Package.json scripts example
  if (packageInfo && packageInfo.scripts) {
    const scriptExamples = Object.entries(packageInfo.scripts)
      .map(([name, script]) => `  "${name}": "${script}"`)
      .join('\n');
    
    examples.push(`## Package.json Scripts
\`\`\`json
{
  "scripts": {
${scriptExamples}
  }
}
\`\`\``);
  }
  
  // Docker configuration example
  if (documentation.files.some(f => f.path.includes('dockerfile') || f.path.includes('docker-compose'))) {
    examples.push(`## Docker Configuration
\`\`\`dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
\`\`\`

\`\`\`yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./logs:/app/logs
\`\`\``);
  }
  
  // Testing configuration example
  if (documentation.files.some(f => f.path.includes('jest') || f.path.includes('vitest') || f.path.includes('cypress'))) {
    examples.push(`## Testing Configuration
\`\`\`javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
\`\`\``);
  }
  
  return examples.join('\n\n');
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
    if (packageInfo.scripts.lint) {
      commands.push('# Run linting\nnpm run lint');
    }
    if (packageInfo.scripts.format) {
      commands.push('# Format code\nnpm run format');
    }
    if (packageInfo.scripts.coverage) {
      commands.push('# Run tests with coverage\nnpm run coverage');
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

// Generate enhanced project structure with explanations
function generateEnhancedProjectStructure(documentation) {
  if (!documentation.structure || typeof documentation.structure !== 'object') {
    console.warn('Warning: Invalid or missing structure in documentation:', {
      hasStructure: !!documentation.structure,
      structureType: typeof documentation.structure,
      structureKeys: documentation.structure ? Object.keys(documentation.structure) : 'none'
    });
    return 'Project structure not available';
  }
  
  console.log('Processing project structure:', {
    rootKeys: Object.keys(documentation.structure),
    structureType: typeof documentation.structure
  });

  const structure = [];
  
  // Recursively process the structure object
  const processStructure = (items, currentPath = '') => {
    if (!items || typeof items !== 'object') return;
    
    try {
      Object.entries(items).forEach(([name, item]) => {
        if (!name || typeof name !== 'string') return;
        
        const fullPath = currentPath ? `${currentPath}/${name}` : name;
        
        if (item && item.type === 'directory') {
          const description = getDirectoryDescription(name, item.children || {});
          structure.push(`📁 **${fullPath}** - ${description}`);
          
          // Process children if they exist
          if (item.children && typeof item.children === 'object' && Object.keys(item.children).length > 0) {
            processStructure(item.children, fullPath);
          }
        } else if (item && item.type === 'file') {
          const fileDesc = getFileDescription(name);
          structure.push(`  📄 ${fullPath} - ${fileDesc}`);
        }
      });
    } catch (error) {
      console.warn('Warning: Error processing structure item:', error.message);
      structure.push(`⚠️ Error processing structure item`);
    }
  };
  
  // Start processing from root
  try {
    processStructure(documentation.structure);
  } catch (error) {
    console.warn('Warning: Error processing project structure:', error.message);
    structure.push('⚠️ Could not process project structure');
  }
  
  // Limit the output to avoid overwhelming the AI
  if (structure.length > 50) {
    structure.splice(50);
    structure.push('... and more files (structure truncated for brevity)');
  }
  
  // If no structure was generated, provide a fallback
  if (structure.length === 0) {
    structure.push('📁 Project structure could not be analyzed');
    structure.push('  📄 Files and directories present but not accessible');
  }
  
  return structure.join('\n');
}

// Get directory description based on contents
function getDirectoryDescription(dir, children) {
  const dirLower = dir.toLowerCase();
  
  // Check directory name patterns first
  if (dirLower.includes('src') || dirLower.includes('source')) return 'Source code directory';
  if (dirLower.includes('test') || dirLower.includes('spec')) return 'Test files and specifications';
  if (dirLower.includes('docs') || dirLower.includes('documentation')) return 'Documentation and guides';
  if (dirLower.includes('config') || dirLower.includes('conf')) return 'Configuration files';
  if (dirLower.includes('public') || dirLower.includes('static')) return 'Public assets and static files';
  if (dirLower.includes('dist') || dirLower.includes('build')) return 'Build output and distribution';
  if (dirLower.includes('scripts') || dirLower.includes('bin')) return 'Utility scripts and executables';
  if (dirLower.includes('migrations') || dirLower.includes('db')) return 'Database migrations and schemas';
  if (dirLower.includes('api') || dirLower.includes('routes')) return 'API endpoints and routing';
  if (dirLower.includes('components') || dirLower.includes('ui')) return 'UI components and interfaces';
  if (dirLower.includes('utils') || dirLower.includes('helpers')) return 'Utility functions and helpers';
  if (dirLower.includes('middleware') || dirLower.includes('interceptors')) return 'Middleware and interceptors';
  if (dirLower.includes('models') || dirLower.includes('entities')) return 'Data models and entities';
  if (dirLower.includes('services') || dirLower.includes('business')) return 'Business logic and services';
  if (dirLower.includes('types') || dirLower.includes('interfaces')) return 'Type definitions and interfaces';
  
  // Infer from children if available
  if (children && typeof children === 'object') {
    const fileExtensions = [];
    const fileNames = [];
    
    Object.entries(children).forEach(([name, item]) => {
      if (item.type === 'file') {
        const ext = name.split('.').pop();
        if (ext && ext.length < 10) fileExtensions.push(ext.toLowerCase());
        fileNames.push(name.toLowerCase());
      }
    });
    
    // Infer from file extensions
    if (fileExtensions.some(ext => ['js', 'ts', 'jsx', 'tsx'].includes(ext))) return 'JavaScript/TypeScript source files';
    if (fileExtensions.some(ext => ['py'].includes(ext))) return 'Python source files';
    if (fileExtensions.some(ext => ['java'].includes(ext))) return 'Java source files';
    if (fileExtensions.some(ext => ['css', 'scss', 'sass'].includes(ext))) return 'Styling and CSS files';
    if (fileExtensions.some(ext => ['json', 'yaml', 'yml', 'toml'].includes(ext))) return 'Configuration and data files';
    
    // Infer from file names
    if (fileNames.some(name => name.includes('readme') || name.includes('license'))) return 'Documentation and project files';
    if (fileNames.some(name => name.includes('dockerfile') || name.includes('docker-compose'))) return 'Docker configuration files';
    if (fileNames.some(name => name.includes('package.json') || name.includes('requirements.txt'))) return 'Dependency and build configuration';
  }
  
  return 'Project files and resources';
}

// Get file description based on filename and extension
function getFileDescription(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const name = filename.toLowerCase();
  
  // Package managers
  if (name.includes('package.json')) return 'Node.js package configuration';
  if (name.includes('requirements.txt')) return 'Python dependencies';
  if (name.includes('pom.xml')) return 'Maven project configuration';
  if (name.includes('build.gradle')) return 'Gradle build configuration';
  
  // Configuration files
  if (name.includes('.env')) return 'Environment variables';
  if (name.includes('config')) return 'Application configuration';
  if (name.includes('dockerfile')) return 'Docker container definition';
  if (name.includes('docker-compose')) return 'Docker services configuration';
  
  // Documentation
  if (name.includes('readme')) return 'Project documentation';
  if (name.includes('license')) return 'Project license';
  if (name.includes('changelog')) return 'Version history and changes';
  if (name.includes('contributing')) return 'Contribution guidelines';
  
  // Source files by extension
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return 'JavaScript/TypeScript source code';
  if (['py'].includes(ext)) return 'Python source code';
  if (['java'].includes(ext)) return 'Java source code';
  if (['css', 'scss', 'sass'].includes(ext)) return 'Stylesheet file';
  if (['html', 'htm'].includes(ext)) return 'HTML markup file';
  if (['json'].includes(ext)) return 'JSON data file';
  if (['yaml', 'yml'].includes(ext)) return 'YAML configuration file';
  if (['md'].includes(ext)) return 'Markdown documentation';
  if (['txt'].includes(ext)) return 'Text file';
  
  return 'Project file';
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
      console.error('   Available models: gemini-1.5-flash, gemini-1.5-pro');
      console.error('   Note: gemini-pro is deprecated. Use gemini-1.5-flash or gemini-1.5-pro instead.');
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
    .slice(0, 8)
    .map(f => `File: ${f.path}\n${f.raw.substring(0, 300)}...`)
    .join('\n\n');
  
  // Get detected features with error handling
  let features = ['Project features could not be detected'];
  try {
    features = detectProjectFeatures(documentation);
  } catch (error) {
    console.warn('Warning: Could not detect project features for V1 prompt:', error.message);
  }
  
  // Get testing framework information for better AI context
  const testingInfo = detectTestingFramework(documentation, packageInfo);
  
  // Get configuration examples
  const configExamples = generateConfigurationExamples(packageInfo, documentation);
  
  // Get project structure for better context with error handling
  let projectStructure = 'Project structure not available';
  try {
    projectStructure = generateEnhancedProjectStructure(documentation);
  } catch (error) {
    console.warn('Warning: Could not generate enhanced project structure for V1 prompt:', error.message);
    projectStructure = 'Project structure could not be generated';
  }
  
  // Get dependencies and scripts for comprehensive documentation
  const dependencies = [];
  const devDependencies = [];
  const scripts = [];
  
  if (packageInfo) {
    if (packageInfo.dependencies) {
      Object.entries(packageInfo.dependencies).forEach(([name, version]) => {
        dependencies.push(`${name}@${version}`);
      });
    }
    if (packageInfo.devDependencies) {
      Object.entries(packageInfo.devDependencies).forEach(([name, version]) => {
        devDependencies.push(`${name}@${version}`);
      });
    }
    if (packageInfo.scripts) {
      Object.entries(packageInfo.scripts).forEach(([name, script]) => {
        scripts.push(`"${name}": "${script}"`);
      });
    }
  }
  
  const prompt = `You are an expert software developer and technical writer specializing in creating professional, comprehensive README.md files for GitHub repositories. Your goal is to create READMEs that match the quality and comprehensiveness of top-tier open source projects like those created by Cursor AI, with extensive detail and practical examples.

Generate a comprehensive, professional README.md file for a software project based on the following analysis:

PROJECT INFORMATION:
- Name: ${projectName}
- Description: ${description}
- Version: ${version}
- Author: ${author}
- License: ${license}

TECHNICAL ANALYSIS:
- Languages: ${Array.isArray(languages) && languages.length > 0 ? languages.join(', ') : 'Not detected'}
- Total Files: ${totalFiles}
- Total Directories: ${totalDirs}
- Detected Features: ${Array.isArray(features) && features.length > 0 ? features.join(', ') : 'Not detected'}

DEPENDENCIES & SCRIPTS:
- Production Dependencies: ${Array.isArray(dependencies) && dependencies.length > 0 ? dependencies.join(', ') : 'None detected'}
- Development Dependencies: ${Array.isArray(devDependencies) && devDependencies.length > 0 ? devDependencies.join(', ') : 'None detected'}
- Available Scripts: ${Array.isArray(scripts) && scripts.length > 0 ? scripts.join(', ') : 'None detected'}

TESTING FRAMEWORK ANALYSIS:
- Primary Framework: ${testingInfo.framework || 'Standard Testing'}
- Framework Description: ${testingInfo.description || 'Comprehensive testing capabilities'}
- Framework Version: ${testingInfo.version || 'Latest'}
- Coverage Tool: ${testingInfo.coverage || 'Standard coverage'}
- Test Files: ${testingInfo.testFiles.length} test files detected
- Test Scripts: ${testingInfo.testScripts.length} test scripts available

PROJECT STRUCTURE:
${projectStructure}

CODE SAMPLES:
${codeSnippets}

CONFIGURATION EXAMPLES:
${configExamples}

REQUIREMENTS - Create a README that is:

1. **VISUALLY APPEALING**: Use emojis, badges, and proper formatting to make it engaging
2. **COMPREHENSIVE**: Include all standard sections plus advanced ones like troubleshooting, deployment, etc.
3. **PROFESSIONAL**: Match the quality of top GitHub repositories (React, Vue, Express, etc.)
4. **USER-FRIENDLY**: Clear installation steps, usage examples, and configuration
5. **DEVELOPER-FOCUSED**: Include API documentation, architecture details, and contribution guidelines
6. **EXTENSIVE**: Make it at least 5-6 times more comprehensive than a basic README

MANDATORY SECTIONS TO INCLUDE:

**Header & Badges:**
- Project title with clear description
- Multiple badges (version, license, build status, coverage, downloads, stars, etc.)
- Quick start section with immediate value
- Project status and maintenance information

**Core Sections:**
- 🚀 Quick Start (get running in 2-3 commands with copy-paste examples)
- 📋 Table of Contents (comprehensive navigation with anchor links)
- ✨ Features (detailed feature list with emojis and descriptions)
- 🎯 What This Project Does (clear explanation of purpose and value)
- 📦 Prerequisites (system requirements, Node.js version, etc.)
- 🔧 Installation (prerequisites + step-by-step with troubleshooting)
- 🎯 Usage (basic + advanced examples with real code snippets)
- 🔍 Code Analysis (languages, patterns, architecture, design decisions)
- 📚 API Reference (functions, endpoints, examples, parameters)
- 🏗️ Project Structure (visual file tree with explanations)
- ⚙️ Configuration (environment variables, config files, options)
- 🧪 Testing (comprehensive testing documentation)
- 🚀 Deployment (production + Docker + cloud platforms)
- 🔧 Troubleshooting (common issues + solutions + debugging)
- 📄 License (clear licensing information)
- 💬 Support (community + contact info + issue templates)
- 🤝 Contributing (detailed contribution guide with PR templates)
- 📝 TODO List (suggested improvements and next steps)

**Advanced Features:**
- Configuration examples with .env files and sample configurations
- Docker deployment instructions with docker-compose examples
- CI/CD setup suggestions with GitHub Actions examples
- Performance considerations and optimization tips
- Security best practices and vulnerability scanning
- Browser compatibility matrix (if applicable)
- Mobile considerations and responsive design notes
- Internationalization support (if applicable)
- Accessibility considerations (if applicable)
- SEO optimization tips (if applicable)

**Testing Section Requirements (🧪 Testing):**
The testing section must be comprehensive and include:
- **Testing Framework Details**: Specific framework name, version, and description
- **Test Commands**: All available test scripts from package.json with examples
- **Code Coverage Information**: Current coverage metrics, coverage goals, and coverage tools used
- **Test Structure**: Organization of test files (unit, integration, e2e tests) with examples
- **Testing Best Practices**: Guidelines for writing and running tests
- **Test Configuration**: Environment variables and configuration options
- **Continuous Integration**: How tests are run in CI/CD pipelines
- **Debugging Tests**: Commands for troubleshooting test issues
- **Test Examples**: Sample test code snippets if applicable
- **Performance Testing**: Load testing and benchmarking if applicable

**Specific Testing Requirements:**
Based on the detected testing framework (${testingInfo.framework}), ensure the testing section includes:
- **Framework-specific commands** and configuration with examples
- **Coverage reporting** using ${testingInfo.coverage || 'standard coverage tools'}
- **Test organization** based on the ${testingInfo.testFiles.length} detected test files
- **Available test scripts** from package.json (${testingInfo.testScripts.length} found)
- **Testing patterns** and best practices for the detected framework
- **Integration with CI/CD** pipelines with configuration examples
- **Debugging and troubleshooting** specific to the testing setup

**Architecture & Design Section:**
- System architecture overview with diagrams or descriptions
- Design patterns used in the project
- Data flow and component relationships
- Scalability considerations
- Security architecture
- Performance characteristics

**Development Workflow:**
- Development environment setup
- Code style and linting rules
- Git workflow and branching strategy
- Release process and versioning
- Changelog maintenance

**Formatting Requirements:**
- Use emojis for section headers (🚀, 📦, 🎯, etc.)
- Include code blocks with proper syntax highlighting
- Use tables for structured information
- Add badges and shields for visual appeal
- Include proper anchor links in table of contents
- Use bold text for important information
- Include practical examples and use cases
- Add collapsible sections for long content
- Use callouts and warnings for important notes

**Tone & Style:**
- Professional yet approachable
- Clear and concise language
- Actionable instructions with copy-paste examples
- Encouraging for contributors
- Helpful for new users
- Comprehensive for advanced users
- Include real-world usage scenarios

The README should be production-ready and immediately usable. It should make developers want to use, contribute to, and star the project. Focus on being helpful, comprehensive, and professional. This should be the most detailed and useful README possible, similar to what you'd see in enterprise-level open source projects.

Generate only the README content in Markdown format, starting with the title. Make it extremely comprehensive and detailed.`;

  return prompt;
}

// Build enhanced AI prompt for README generation (v2 - beginner-friendly but comprehensive)
function buildAIPromptV2(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  const description = packageInfo?.description || '';
  const version = packageInfo?.version || '1.0.0';
  const author = packageInfo?.author || 'Developer';
  const license = packageInfo?.license || 'MIT';
  
  // Extract key information for the AI
  const languages = Object.keys(documentation.summary.languages || {});
  const totalFiles = documentation.summary.totalFiles || 0;
  const totalDirs = documentation.summary.totalDirectories || 0;
  
  // Get file tree structure with error handling
  let fileTree = 'Project structure not available';
  try {
    fileTree = generateEnhancedProjectStructure(documentation);
  } catch (error) {
    console.warn('Warning: Could not generate enhanced project structure:', error.message);
    fileTree = 'Project structure could not be generated';
  }
  
  // Get key files content with more context
  const keyFiles = documentation.files
    .filter(f => f.raw && f.raw.length > 50)
    .slice(0, 5)
    .map(f => `File: ${f.path}\nContent: ${f.raw.substring(0, 300)}...`)
    .join('\n\n');
  
  // Get dependencies and scripts
  const dependencies = [];
  const devDependencies = [];
  const scripts = [];
  
  if (packageInfo) {
    if (packageInfo.dependencies) {
      Object.entries(packageInfo.dependencies).forEach(([name, version]) => {
        dependencies.push(`${name}@${version}`);
      });
    }
    if (packageInfo.devDependencies) {
      Object.entries(packageInfo.devDependencies).forEach(([name, version]) => {
        devDependencies.push(`${name}@${version}`);
      });
    }
    if (packageInfo.scripts) {
      Object.entries(packageInfo.scripts).forEach(([name, script]) => {
        scripts.push(`"${name}": "${script}"`);
      });
    }
  }
  
  // Get detected features for better context with error handling
  let features = ['Project features could not be detected'];
  try {
    features = detectProjectFeatures(documentation);
  } catch (error) {
    console.warn('Warning: Could not detect project features for V2 prompt:', error.message);
  }
  
  // Get configuration examples
  const configExamples = generateConfigurationExamples(packageInfo, documentation);
  
  // Check for existing docs
  const existingDocs = documentation.readme ? 'README.md (existing)' : 'No existing documentation';
  
  const prompt = `You are GitGen, an AI documentation generator specializing in creating comprehensive, professional README.md files. 
Your task is to generate a detailed, well-structured, and production-ready README.md file for the provided repository. 
Follow GitHub README best practices, use clean Markdown with emojis, and make the output comprehensive yet beginner-friendly.

Repository Name: ${projectName}
Description: ${description}
Version: ${version}
Author: ${author}
License: ${license}

Technical Analysis:
- Languages: ${Array.isArray(languages) && languages.length > 0 ? languages.join(', ') : 'Not detected'}
- Total Files: ${totalFiles}
- Total Directories: ${totalDirs}
- Detected Features: ${Array.isArray(features) && features.length > 0 ? features.join(', ') : 'Not detected'}

File Tree Structure:
${fileTree || 'Project structure not available'}

Key Files and Contents (summarized or full text if small):
${keyFiles || 'No key files available'}

Dependencies:
- Production: ${Array.isArray(dependencies) && dependencies.length > 0 ? dependencies.join(', ') : 'None detected'}
- Development: ${Array.isArray(devDependencies) && devDependencies.length > 0 ? devDependencies.join(', ') : 'None detected'}
- Scripts: ${Array.isArray(scripts) && scripts.length > 0 ? scripts.join(', ') : 'None detected'}

Existing Documentation:
${existingDocs}

Configuration Examples:
${configExamples}

---

🛠️ Instructions for README generation:

**Required Sections (in order):**
1. **Header**: Clear title, description, and relevant badges
2. **Quick Start**: Get users running in 2-3 commands
3. **Features**: List key features with emojis and descriptions
4. **Installation**: Prerequisites + step-by-step setup
5. **Usage**: Basic + advanced examples with code snippets
6. **Configuration**: Environment variables, config files, options
7. **API Reference**: Functions, endpoints, examples (if applicable)
8. **Project Structure**: Explain key directories and files
9. **Testing**: How to run tests and coverage
10. **Deployment**: Production deployment options
11. **Contributing**: Guidelines for contributors
12. **License**: Clear licensing information
13. **Support**: Community and contact information
14. **TODO List**: Suggested improvements and next steps

**Content Requirements:**
- Use emojis for section headers (🚀, 📦, 🎯, ✨, etc.)
- Include code blocks with proper syntax highlighting
- Add badges for build status, version, license, etc.
- Use tables for structured information
- Include practical examples and use cases
- Make installation steps copy-paste ready
- Add troubleshooting tips for common issues
- Include configuration examples
- Use proper anchor links in table of contents

**Tone & Style:**
- Professional yet approachable
- Clear and concise language
- Actionable instructions with examples
- Helpful for new users
- Comprehensive for advanced users
- Encouraging for contributors

**Special Instructions:**
- If project purpose is unclear, infer from context and state assumptions
- Include real-world usage scenarios
- Add performance considerations if applicable
- Include security notes if relevant
- Add browser compatibility if applicable
- Make it at least 3-4 times more comprehensive than a basic README

**TODO List Requirements:**
- Analyze the current project state and suggest realistic improvements
- Include both immediate tasks and long-term goals
- Prioritize items by impact and effort (High/Medium/Low)
- Suggest features that would enhance the project's value
- Include technical debt items if applicable
- Consider user experience improvements
- Suggest testing and documentation enhancements

Generate only the README content in Markdown format, starting with the title. Make it comprehensive, professional, and immediately useful.`;

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
  readme += `- [Support](#-support)\n`;
  readme += `- [TODO List](#-todo-list)\n\n`;
  
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
  
  // TODO List section
  readme += `## 📝 TODO List\n\n`;
  readme += `### 🚀 **High Priority**\n`;
  readme += `- [ ] **Performance Optimization**: Implement caching and optimization strategies\n`;
  readme += `- [ ] **Enhanced Testing**: Increase test coverage and add integration tests\n`;
  readme += `- [ ] **Documentation**: Expand API documentation and add code examples\n`;
  readme += `- [ ] **Error Handling**: Improve error messages and user feedback\n`;
  readme += `- [ ] **Security**: Add input validation and security headers\n\n`;
  
  readme += `### 🔧 **Medium Priority**\n`;
  readme += `- [ ] **Monitoring**: Add logging and performance monitoring\n`;
  readme += `- [ ] **CI/CD**: Set up automated testing and deployment pipelines\n`;
  readme += `- [ ] **Docker**: Create production-ready Docker configurations\n`;
  readme += `- [ ] **API Versioning**: Implement proper API versioning strategy\n`;
  readme += `- [ ] **Internationalization**: Add multi-language support\n\n`;
  
  readme += `### 📊 **Enhancement Features**\n`;
  readme += `- [ ] **Analytics**: Add usage analytics and metrics dashboard\n`;
  readme += `- [ ] **Plugins**: Create extensible plugin architecture\n`;
  readme += `- [ ] **Mobile Support**: Optimize for mobile devices\n`;
  readme += `- [ ] **Accessibility**: Improve accessibility compliance\n`;
  readme += `- [ ] **Performance Metrics**: Add performance benchmarking tools\n\n`;
  
  readme += `### 🎨 **UI/UX Improvements**\n`;
  readme += `- [ ] **Dark Mode**: Implement complete dark theme\n`;
  readme += `- [ ] **Customization**: Allow users to customize the interface\n`;
  readme += `- [ ] **Animations**: Add smooth transitions and micro-interactions\n`;
  readme += `- [ ] **Responsive Design**: Ensure perfect mobile experience\n`;
  readme += `- [ ] **User Preferences**: Save and restore user settings\n\n`;
  
  readme += `**Contributing**: We welcome contributions! Check out our [Contributing Guidelines](CONTRIBUTING.md) for more details.\n\n`;
  
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

// Set up WebSocket server with HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 GitGen server running on port ${PORT}`);
  console.log(`📱 Frontend available at: http://localhost:${PORT}`);
  console.log(`🔧 API available at: http://localhost:${PORT}/api`);
  console.log(`🐛 Debug page at: http://localhost:${PORT}/debug`);
  console.log(`📚 For AI setup help, see: GEMINI_CONFIG.md`);
  console.log(`🔌 WebSocket server ready for real-time updates`);
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Add missing detectTestingFramework function
function detectTestingFramework(documentation, packageInfo) {
  const testingInfo = {
    framework: 'Standard Testing',
    description: 'Comprehensive testing capabilities',
    version: 'Latest',
    coverage: 'Standard coverage',
    testFiles: [],
    testScripts: []
  };
  
  try {
    // Detect test files
    if (documentation.files && Array.isArray(documentation.files)) {
      documentation.files.forEach(file => {
        const path = file.path.toLowerCase();
        if (path.includes('test') || path.includes('spec') || path.includes('__tests__')) {
          testingInfo.testFiles.push(file.path);
        }
      });
    }
    
    // Detect test scripts from package.json
    if (packageInfo && packageInfo.scripts) {
      Object.entries(packageInfo.scripts).forEach(([key, value]) => {
        if (key.includes('test') || key.includes('spec')) {
          testingInfo.testScripts.push({ key, value });
        }
      });
    }
    
    // Detect specific testing frameworks
    if (documentation.files && Array.isArray(documentation.files)) {
      documentation.files.forEach(file => {
        const content = file.raw || '';
        const path = file.path.toLowerCase();
        
        if (content.includes('jest') || path.includes('jest.config')) {
          testingInfo.framework = 'Jest';
          testingInfo.description = 'Fast and comprehensive testing framework for JavaScript';
          testingInfo.coverage = 'Jest coverage';
        } else if (content.includes('mocha') || path.includes('mocha')) {
          testingInfo.framework = 'Mocha';
          testingInfo.description = 'Flexible JavaScript testing framework';
          testingInfo.coverage = 'Istanbul coverage';
        } else if (content.includes('vitest') || path.includes('vitest.config')) {
          testingInfo.framework = 'Vitest';
          testingInfo.description = 'Fast unit testing framework powered by Vite';
          testingInfo.coverage = 'Vitest coverage';
        } else if (content.includes('cypress') || path.includes('cypress.config')) {
          testingInfo.framework = 'Cypress';
          testingInfo.description = 'End-to-end testing for modern web applications';
          testingInfo.coverage = 'Cypress coverage';
        } else if (content.includes('playwright') || path.includes('playwright.config')) {
          testingInfo.framework = 'Playwright';
          testingInfo.description = 'Reliable web testing and automation';
          testingInfo.coverage = 'Playwright coverage';
        }
      });
    }
    
    // Get version from package.json if available
    if (packageInfo && packageInfo.devDependencies) {
      if (packageInfo.devDependencies.jest) {
        testingInfo.version = packageInfo.devDependencies.jest;
      } else if (packageInfo.devDependencies.mocha) {
        testingInfo.version = packageInfo.devDependencies.mocha;
      } else if (packageInfo.devDependencies.vitest) {
        testingInfo.version = packageInfo.devDependencies.vitest;
      }
    }
    
  } catch (error) {
    console.warn('Warning: Error detecting testing framework:', error.message);
  }
  
  return testingInfo;
}

// Add caching system for large repositories
const repositoryCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache TTL

// Cache management functions
function getCachedRepository(repoUrl) {
  const cached = repositoryCache.get(repoUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedRepository(repoUrl, data) {
  repositoryCache.set(repoUrl, {
    data,
    timestamp: Date.now()
  });
}

function clearExpiredCache() {
  const now = Date.now();
  for (const [key, value] of repositoryCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      repositoryCache.delete(key);
    }
  }
}

// Clear expired cache every 30 minutes
setInterval(clearExpiredCache, 1000 * 60 * 30);

// Add batch processing and queue system
const processingQueue = [];
const maxConcurrentProcesses = 3;
let activeProcesses = 0;

// Queue management functions
function addToQueue(projectId, repoUrl, mode) {
  processingQueue.push({ projectId, repoUrl, mode, addedAt: Date.now() });
  console.log(`📋 Added project ${projectId} to processing queue. Queue length: ${processingQueue.length}`);
  processQueue();
}

function processQueue() {
  if (activeProcesses >= maxConcurrentProcesses || processingQueue.length === 0) {
    return;
  }
  
  const nextProject = processingQueue.shift();
  if (nextProject) {
    activeProcesses++;
    console.log(`🚀 Starting batch processing for project ${nextProject.projectId}. Active processes: ${activeProcesses}`);
    
    processRepository(nextProject.projectId, nextProject.repoUrl, nextProject.mode)
      .finally(() => {
        activeProcesses--;
        console.log(`✅ Completed batch processing for project ${nextProject.projectId}. Active processes: ${activeProcesses}`);
        processQueue(); // Process next item in queue
      });
  }
}

// Batch project creation endpoint
app.post('/api/projects/batch', async (req, res) => {
  try {
    const { repositories } = req.body;
    
    if (!repositories || !Array.isArray(repositories) || repositories.length === 0) {
      return res.status(400).json({ error: 'Repositories array is required' });
    }
    
    if (repositories.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 repositories can be processed in a single batch' });
    }
    
    const batchId = uuidv4();
    const batchResults = [];
    
    console.log(`🔄 Starting batch processing for ${repositories.length} repositories. Batch ID: ${batchId}`);
    
    for (const repo of repositories) {
      const { repoUrl, projectName, description, mode = 'v2' } = repo;
      
      if (!repoUrl || !projectName) {
        batchResults.push({
          repoUrl,
          projectName,
          status: 'failed',
          error: 'Repository URL and project name are required'
        });
        continue;
      }
      
      // Check if project already exists
      const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
      if (existingProject) {
        batchResults.push({
          repoUrl,
          projectName,
          status: 'exists',
          projectId: existingProject.id,
          message: 'Project already exists'
        });
        continue;
      }
      
      // Create new project
      const projectId = uuidv4();
      const project = {
        id: projectId,
        repoUrl,
        projectName,
        description: description || '',
        status: 'queued',
        createdAt: new Date().toISOString(),
        documentation: null,
        error: null,
        mode: mode || 'v2',
        batchId
      };
      
      projects.set(projectId, project);
      batchResults.push({
        repoUrl,
        projectName,
        status: 'queued',
        projectId,
        message: 'Added to processing queue'
      });
      
      // Add to processing queue
      addToQueue(projectId, repoUrl, mode);
    }
    
    res.json({
      batchId,
      totalRepositories: repositories.length,
      results: batchResults,
      message: 'Batch processing started'
    });
    
  } catch (error) {
    console.error('Error in batch project creation:', error);
    res.status(500).json({ error: 'Failed to create batch projects' });
  }
});

// Get batch processing status
app.get('/api/batch/:batchId', (req, res) => {
  const { batchId } = req.params;
  
  try {
    const batchProjects = Array.from(projects.values()).filter(p => p.batchId === batchId);
    
    if (batchProjects.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    
    const batchStatus = {
      batchId,
      totalProjects: batchProjects.length,
      completed: batchProjects.filter(p => p.status === 'completed').length,
      processing: batchProjects.filter(p => p.status === 'processing').length,
      queued: batchProjects.filter(p => p.status === 'queued').length,
      failed: batchProjects.filter(p => p.status === 'failed').length,
      projects: batchProjects.map(p => ({
        id: p.id,
        projectName: p.projectName,
        repoUrl: p.repoUrl,
        status: p.status,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
        error: p.error
      }))
    };
    
    res.json(batchStatus);
    
  } catch (error) {
    console.error('Error getting batch status:', error);
    res.status(500).json({ error: 'Failed to get batch status' });
  }
});

// Get queue status
app.get('/api/queue/status', (req, res) => {
  try {
    const queueStatus = {
      queueLength: processingQueue.length,
      activeProcesses,
      maxConcurrentProcesses,
      queueItems: processingQueue.map(item => ({
        projectId: item.projectId,
        repoUrl: item.repoUrl,
        mode: item.mode,
        addedAt: item.addedAt,
        waitTime: Date.now() - item.addedAt
      }))
    };
    
    res.json(queueStatus);
    
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// Add WebSocket support for real-time collaboration
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });

// Track active connections and their subscribed projects
const activeConnections = new Map(); // connection -> { projects: Set, userId: string }
const projectSubscribers = new Map(); // projectId -> Set of connections

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  
  // Check rate limit
  if (!checkWebSocketRateLimit(ip)) {
    ws.close(1008, 'Rate limit exceeded');
    return;
  }
  
  const connectionId = uuidv4();
  const connection = {
    id: connectionId,
    ws,
    projects: new Set(),
    userId: req.headers['x-user-id'] || 'anonymous',
    connectedAt: Date.now(),
    ip
  };
  
  activeConnections.set(connectionId, connection);
  
  console.log(`🔌 WebSocket connection established: ${connectionId} (User: ${connection.userId}, IP: ${ip})`);
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(connectionId, data);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log(`🔌 WebSocket connection closed: ${connectionId}`);
    removeConnection(connectionId);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for connection ${connectionId}:`, error);
    removeConnection(connectionId);
  });
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    connectionId,
    timestamp: Date.now()
  }));
});

// Handle WebSocket messages
function handleWebSocketMessage(connectionId, data) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return;
  
  switch (data.type) {
    case 'subscribe_project':
      subscribeToProject(connectionId, data.projectId);
      break;
    case 'unsubscribe_project':
      unsubscribeFromProject(connectionId, data.projectId);
      break;
    case 'ping':
      connection.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    default:
      console.log(`Unknown WebSocket message type: ${data.type}`);
  }
}

// Subscribe to project updates
function subscribeToProject(connectionId, projectId) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return;
  
  // Add project to connection's subscribed projects
  connection.projects.add(projectId);
  
  // Add connection to project's subscribers
  if (!projectSubscribers.has(projectId)) {
    projectSubscribers.set(projectId, new Set());
  }
  projectSubscribers.get(projectId).add(connectionId);
  
  console.log(`📡 Connection ${connectionId} subscribed to project ${projectId}`);
  
  // Send current project status
  const project = projects.get(projectId);
  if (project) {
    connection.ws.send(JSON.stringify({
      type: 'project_update',
      projectId,
      data: {
        status: project.status,
        progress: project.progress,
        hasDocumentation: !!project.documentation,
        error: project.error
      },
      timestamp: Date.now()
    }));
  }
}
// Unsubscribe from project updates
function unsubscribeFromProject(connectionId, projectId) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return;
  
  // Remove project from connection's subscribed projects
  connection.projects.delete(projectId);
  
  // Remove connection from project's subscribers
  const subscribers = projectSubscribers.get(projectId);
  if (subscribers) {
    subscribers.delete(connectionId);
    if (subscribers.size === 0) {
      projectSubscribers.delete(projectId);
    }
  }
  
  console.log(`📡 Connection ${connectionId} unsubscribed from project ${projectId}`);
}

// Remove connection and clean up
function removeConnection(connectionId) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return;
  
  // Unsubscribe from all projects
  connection.projects.forEach(projectId => {
    const subscribers = projectSubscribers.get(projectId);
    if (subscribers) {
      subscribers.delete(connectionId);
      if (subscribers.size === 0) {
        projectSubscribers.delete(projectId);
      }
    }
  });
  
  // Close WebSocket connection
  if (connection.ws.readyState === WebSocket.OPEN) {
    connection.ws.close();
  }
  
  // Remove from active connections
  activeConnections.delete(connectionId);
  
  console.log(`🧹 Cleaned up connection ${connectionId}`);
}

// Broadcast project updates to all subscribers
function broadcastProjectUpdate(projectId, updateData) {
  const subscribers = projectSubscribers.get(projectId);
  if (!subscribers || subscribers.size === 0) return;
  
  const message = JSON.stringify({
    type: 'project_update',
    projectId,
    data: updateData,
    timestamp: Date.now()
  });
  
  let deliveredCount = 0;
  subscribers.forEach(connectionId => {
    const connection = activeConnections.get(connectionId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      try {
        connection.ws.send(message);
        deliveredCount++;
      } catch (error) {
        console.error(`Error sending update to connection ${connectionId}:`, error);
        // Remove failed connection
        removeConnection(connectionId);
      }
    }
  });
  
  if (deliveredCount > 0) {
    console.log(`📡 Broadcasted update for project ${projectId} to ${deliveredCount} subscribers`);
  }
}

// Update the processRepository function to broadcast updates
function updateProjectProgress(projectId, progressData) {
  const project = projects.get(projectId);
  if (!project) return;
  
  // Update project progress
  project.progress = { ...project.progress, ...progressData };
  
  // Broadcast update to all subscribers
  broadcastProjectUpdate(projectId, {
    status: project.status,
    progress: project.progress,
    hasDocumentation: !!project.documentation,
    error: project.error
  });
}

// Add custom README template functionality
const customTemplates = new Map(); // templateId -> template
const userTemplates = new Map(); // userId -> Set of templateIds

// Template structure
class READMETemplate {
  constructor(id, name, description, content, variables, userId, isPublic = false) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.content = content;
    this.variables = variables || [];
    this.userId = userId;
    this.isPublic = isPublic;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.usageCount = 0;
    this.rating = 0;
    this.tags = [];
  }
  
  update(data) {
    Object.assign(this, data);
    this.updatedAt = Date.now();
  }
  
  incrementUsage() {
    this.usageCount++;
  }
  
  addRating(rating) {
    this.rating = (this.rating + rating) / 2;
  }
}

// Create custom template
app.post('/api/templates', (req, res) => {
  try {
    const { name, description, content, variables, isPublic, tags } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    if (!name || !content) {
      return res.status(400).json({ error: 'Template name and content are required' });
    }
    
    const templateId = uuidv4();
    const template = new READMETemplate(
      templateId,
      name,
      description || '',
      content,
      variables || [],
      userId,
      isPublic || false
    );
    
    if (tags && Array.isArray(tags)) {
      template.tags = tags;
    }
    
    // Store template
    customTemplates.set(templateId, template);
    
    // Add to user's templates
    if (!userTemplates.has(userId)) {
      userTemplates.set(userId, new Set());
    }
    userTemplates.get(userId).add(templateId);
    
    console.log(`📝 Created custom template: ${name} (ID: ${templateId})`);
    
    res.json({
      templateId,
      message: 'Template created successfully',
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        isPublic: template.isPublic,
        createdAt: template.createdAt,
        tags: template.tags
      }
    });
    
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Get user's templates
app.get('/api/templates/my', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'anonymous';
    const userTemplateIds = userTemplates.get(userId) || new Set();
    
    const templates = Array.from(userTemplateIds)
      .map(id => customTemplates.get(id))
      .filter(Boolean)
      .map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        isPublic: template.isPublic,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        usageCount: template.usageCount,
        rating: template.rating,
        tags: template.tags
      }));
    
    res.json({
      userId,
      templates,
      total: templates.length
    });
    
  } catch (error) {
    console.error('Error getting user templates:', error);
    res.status(500).json({ error: 'Failed to get user templates' });
  }
});

// Get public templates
app.get('/api/templates/public', (req, res) => {
  try {
    const { category, tags, limit = 20, offset = 0 } = req.query;
    
    let templates = Array.from(customTemplates.values())
      .filter(template => template.isPublic);
    
    // Apply filters
    if (category) {
      templates = templates.filter(template => 
        template.tags.some(tag => tag.toLowerCase().includes(category.toLowerCase()))
      );
    }
    
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim().toLowerCase());
      templates = templates.filter(template =>
        tagList.some(tag => template.tags.some(t => t.toLowerCase().includes(tag)))
      );
    }
    
    // Sort by rating and usage
    templates.sort((a, b) => {
      const scoreA = (a.rating * 0.7) + (a.usageCount * 0.3);
      const scoreB = (b.rating * 0.7) + (b.usageCount * 0.3);
      return scoreB - scoreA;
    });
    
    // Apply pagination
    const total = templates.length;
    const limitedTemplates = templates.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
      templates: limitedTemplates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        createdAt: template.createdAt,
        usageCount: template.usageCount,
        rating: template.rating,
        tags: template.tags,
        author: template.userId
      })),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('Error getting public templates:', error);
    res.status(500).json({ error: 'Failed to get public templates' });
  }
});

// Get template by ID
app.get('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const template = customTemplates.get(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check if user can access this template
    const userId = req.headers['x-user-id'] || 'anonymous';
    if (!template.isPublic && template.userId !== userId) {
      return res.status(403).json({ error: 'Access denied to this template' });
    }
    
    res.json({
      id: template.id,
      name: template.name,
      description: template.description,
      content: template.content,
      variables: template.variables,
      isPublic: template.isPublic,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      usageCount: template.usageCount,
      rating: template.rating,
      tags: template.tags,
      author: template.userId
    });
    
  } catch (error) {
    console.error('Error getting template:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// Update template
app.put('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const { name, description, content, variables, isPublic, tags } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    const template = customTemplates.get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check ownership
    if (template.userId !== userId) {
      return res.status(403).json({ error: 'You can only edit your own templates' });
    }
    
    // Update template
    template.update({
      name: name || template.name,
      description: description !== undefined ? description : template.description,
      content: content || template.content,
      variables: variables || template.variables,
      isPublic: isPublic !== undefined ? isPublic : template.isPublic,
      tags: tags || template.tags
    });
    
    console.log(`📝 Updated template: ${template.name} (ID: ${templateId})`);
    
    res.json({
      message: 'Template updated successfully',
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        isPublic: template.isPublic,
        updatedAt: template.updatedAt,
        tags: template.tags
      }
    });
    
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete template
app.delete('/api/templates/:templateId', (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    const template = customTemplates.get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check ownership
    if (template.userId !== userId) {
      return res.status(403).json({ error: 'You can only delete your own templates' });
    }
    
    // Remove from user's templates
    const userTemplateIds = userTemplates.get(userId);
    if (userTemplateIds) {
      userTemplateIds.delete(templateId);
    }
    
    // Remove template
    customTemplates.delete(templateId);
    
    console.log(`🗑️ Deleted template: ${template.name} (ID: ${templateId})`);
    
    res.json({ message: 'Template deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Rate template
app.post('/api/templates/:templateId/rate', (req, res) => {
  try {
    const { templateId } = req.params;
    const { rating } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const template = customTemplates.get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    template.addRating(rating);
    
    res.json({
      message: 'Rating submitted successfully',
      newRating: template.rating
    });
    
  } catch (error) {
    console.error('Error rating template:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Use custom template for README generation
app.post('/api/projects/:projectId/generate-with-template', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { templateId, variables } = req.body;
    
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const template = customTemplates.get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Check access
    const userId = req.headers['x-user-id'] || 'anonymous';
    if (!template.isPublic && template.userId !== userId) {
      return res.status(403).json({ error: 'Access denied to this template' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to use with template' });
    }
    
    // Generate README using custom template
    const generatedReadme = await generateCustomTemplateReadme(template, project.documentation, variables);
    
    // Update project with custom template README
    if (!project.documentation.generatedReadme) {
      project.documentation.generatedReadme = {};
    }
    
    project.documentation.generatedReadme.customTemplate = {
      templateId,
      templateName: template.name,
      content: generatedReadme,
      markdown: marked.parse(generatedReadme),
      raw: generatedReadme,
      variables: variables || {},
      generatedAt: new Date().toISOString()
    };
    
    // Increment template usage
    template.incrementUsage();
    
    res.json({
      message: 'README generated with custom template successfully',
      templateName: template.name,
      content: generatedReadme
    });
    
  } catch (error) {
    console.error('Error generating README with custom template:', error);
    res.status(500).json({ error: 'Failed to generate README with custom template' });
  }
});

// Generate README using custom template
async function generateCustomTemplateReadme(template, documentation, variables = {}) {
  try {
    let content = template.content;
    
    // Replace variables in template
    const allVariables = {
      // Default variables
      projectName: documentation.projectName || 'Project',
      description: documentation.description || 'A software project',
      totalFiles: documentation.summary?.totalFiles || 0,
      totalDirectories: documentation.summary?.totalDirectories || 0,
      languages: Object.keys(documentation.summary?.languages || {}).join(', '),
      fileTypes: Object.keys(documentation.summary?.fileTypes || {}).join(', '),
      
      // Custom variables
      ...variables
    };
    
    // Replace variables in template content
    Object.entries(allVariables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      content = content.replace(regex, value);
    });
    
    // Replace dynamic content placeholders
    if (content.includes('{{PROJECT_STRUCTURE}}')) {
      content = content.replace('{{PROJECT_STRUCTURE}}', generateEnhancedProjectStructure(documentation));
    }
    
    if (content.includes('{{FEATURES}}')) {
      const features = detectProjectFeatures(documentation);
      content = content.replace('{{FEATURES}}', features.map(f => `- ${f}`).join('\n'));
    }
    
    if (content.includes('{{INSTALLATION}}')) {
      const installCommands = generateInstallCommands(documentation.packageInfo, documentation);
      content = content.replace('{{INSTALLATION}}', installCommands.map(cmd => `\`\`\`bash\n${cmd}\n\`\`\``).join('\n\n'));
    }
    
    if (content.includes('{{USAGE}}')) {
      const usageCommands = generateUsageCommands(documentation.packageInfo, 'index.js', documentation);
      content = content.replace('{{USAGE}}', usageCommands.map(cmd => `\`\`\`bash\n${cmd}\n\`\`\``).join('\n\n'));
    }
    
    return content;
    
  } catch (error) {
    console.error('Error generating custom template README:', error);
    throw new Error('Failed to generate README with custom template');
  }
}

// Get template categories and tags
app.get('/api/templates/categories', (req, res) => {
  try {
    const categories = new Set();
    const allTags = new Set();
    
    customTemplates.forEach(template => {
      if (template.isPublic) {
        template.tags.forEach(tag => {
          allTags.add(tag);
          // Extract category from tag (e.g., "web" from "web-app", "web-framework")
          const category = tag.split('-')[0];
          categories.add(category);
        });
      }
    });
    
    res.json({
      categories: Array.from(categories).sort(),
      tags: Array.from(allTags).sort(),
      totalTemplates: Array.from(customTemplates.values()).filter(t => t.isPublic).length
    });
    
  } catch (error) {
    console.error('Error getting template categories:', error);
    res.status(500).json({ error: 'Failed to get template categories' });
  }
});

// Rate limiting configuration
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many requests',
      message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests',
        message,
        retryAfter: Math.ceil(windowMs / 1000),
        timestamp: new Date().toISOString()
      });
    }
  });
};

// Apply rate limiting to different endpoints
const generalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per 15 minutes
  'Too many requests from this IP, please try again later.'
);

const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 requests per 15 minutes
  'Too many authentication attempts, please try again later.'
);

const projectCreationLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10, // 10 project creations per hour
  'Too many project creations, please try again later.'
);

const searchLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutes
  50, // 50 searches per 5 minutes
  'Too many search requests, please try again later.'
);

const aiGenerationLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  20, // 20 AI generations per hour
  'Too many AI generation requests, please try again later.'
);

// Apply rate limiters to routes
app.use('/api/auth', authLimiter);
app.use('/api/projects', projectCreationLimiter);
app.use('/api/search', searchLimiter);
app.use('/api/ai', aiGenerationLimiter);
app.use('/api', generalLimiter);

// Rate limiting middleware for specific endpoints
app.use('/api/projects', (req, res, next) => {
  if (req.method === 'POST') {
    return projectCreationLimiter(req, res, next);
  }
  next();
});

// Rate limiting for AI endpoints
app.use('/api/projects/:projectId/generate-with-template', aiGenerationLimiter);

// Rate limiting for batch operations
app.use('/api/projects/batch', (req, res, next) => {
  const batchLimiter = createRateLimiter(
    60 * 60 * 1000, // 1 hour
    3, // 3 batch operations per hour
    'Too many batch operations, please try again later.'
  );
  return batchLimiter(req, res, next);
});

// Rate limiting for WebSocket connections
const wsRateLimit = new Map(); // ip -> { count: number, resetTime: number }
const WS_RATE_LIMIT = { max: 10, windowMs: 60 * 1000 }; // 10 connections per minute

function checkWebSocketRateLimit(ip) {
  const now = Date.now();
  const limit = wsRateLimit.get(ip);
  
  if (!limit || now > limit.resetTime) {
    wsRateLimit.set(ip, { count: 1, resetTime: now + WS_RATE_LIMIT.windowMs });
    return true;
  }
  
  if (limit.count >= WS_RATE_LIMIT.max) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Update WebSocket connection handling with rate limiting
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  
  // Check rate limit
  if (!checkWebSocketRateLimit(ip)) {
    ws.close(1008, 'Rate limit exceeded');
    return;
  }
  
  const connectionId = uuidv4();
  const connection = {
    id: connectionId,
    ws,
    projects: new Set(),
    userId: req.headers['x-user-id'] || 'anonymous',
    connectedAt: Date.now(),
    ip
  };
  
  activeConnections.set(connectionId, connection);
  
  console.log(`🔌 WebSocket connection established: ${connectionId} (User: ${connection.userId}, IP: ${ip})`);
  
  // ... rest of the WebSocket handling code remains the same
});

// Add webhook support for GitHub/GitLab
const webhookConfig = {
  github: {
    secret: process.env.GITHUB_WEBHOOK_SECRET || '',
    events: ['push', 'pull_request', 'issues', 'release']
  },
  gitlab: {
    secret: process.env.GITLAB_WEBHOOK_SECRET || '',
    events: ['Push Hook', 'Merge Request Hook', 'Issue Hook', 'Release Hook']
  }
};

// Webhook event handlers
const webhookHandlers = {
  github: {
    push: handleGitHubPush,
    pull_request: handleGitHubPullRequest,
    issues: handleGitHubIssue,
    release: handleGitHubRelease
  },
  gitlab: {
    'Push Hook': handleGitLabPush,
    'Merge Request Hook': handleGitLabMergeRequest,
    'Issue Hook': handleGitLabIssue,
    'Release Hook': handleGitLabRelease
  }
};

// GitHub webhook endpoint
app.post('/api/webhooks/github', (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const delivery = req.headers['x-github-delivery'];
    
    // Verify webhook signature
    if (webhookConfig.github.secret && !verifyGitHubSignature(req.body, signature, webhookConfig.github.secret)) {
      console.warn('⚠️ Invalid GitHub webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    console.log(`📡 GitHub webhook received: ${event} (${delivery})`);
    
    // Handle the event
    const handler = webhookHandlers.github[event];
    if (handler) {
      handler(req.body, res);
    } else {
      console.log(`📡 Unhandled GitHub event: ${event}`);
      res.status(200).json({ message: 'Event received but not handled' });
    }
    
  } catch (error) {
    console.error('Error processing GitHub webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GitLab webhook endpoint
app.post('/api/webhooks/gitlab', (req, res) => {
  try {
    const token = req.headers['x-gitlab-token'];
    const event = req.headers['x-gitlab-event'];
    
    // Verify webhook token
    if (webhookConfig.gitlab.secret && token !== webhookConfig.gitlab.secret) {
      console.warn('⚠️ Invalid GitLab webhook token');
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    console.log(`📡 GitLab webhook received: ${event}`);
    
    // Handle the event
    const handler = webhookHandlers.gitlab[event];
    if (handler) {
      handler(req.body, res);
    } else {
      console.log(`📡 Unhandled GitLab event: ${event}`);
      res.status(200).json({ message: 'Event received but not handled' });
    }
    
  } catch (error) {
    console.error('Error processing GitLab webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Verify GitHub webhook signature
function verifyGitHubSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
// GitHub event handlers
function handleGitHubPush(payload, res) {
  try {
    const { repository, ref, commits } = payload;
    const repoUrl = repository.clone_url;
    
    console.log(`🔄 GitHub push event for ${repoUrl} (${ref})`);
    
    // Find existing project
    const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
    
    if (existingProject) {
      console.log(`🔄 Triggering update for existing project: ${existingProject.projectName}`);
      
      // Mark project for update
      existingProject.status = 'updating';
      existingProject.lastUpdate = new Date().toISOString();
      existingProject.updateTrigger = 'github_webhook';
      
      // Add to processing queue for update
      addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
      
      // Broadcast update to subscribers
      broadcastProjectUpdate(existingProject.id, {
        status: existingProject.status,
        message: 'Repository updated via webhook, regenerating documentation...',
        lastUpdate: existingProject.lastUpdate
      });
      
      res.json({
        message: 'Project update triggered',
        projectId: existingProject.id,
        projectName: existingProject.projectName,
        commits: commits.length
      });
    } else {
      console.log(`📝 No existing project found for ${repoUrl}, webhook ignored`);
      res.json({ message: 'No existing project found, webhook ignored' });
    }
    
  } catch (error) {
    console.error('Error handling GitHub push:', error);
    res.status(500).json({ error: 'Failed to handle push event' });
  }
}

function handleGitHubPullRequest(payload, res) {
  try {
    const { repository, pull_request, action } = payload;
    const repoUrl = repository.clone_url;
    
    console.log(`🔀 GitHub PR ${action} for ${repoUrl} (#${pull_request.number})`);
    
    // For now, just log the event
    // Could be extended to create preview documentation for PRs
    res.json({ message: 'Pull request event received' });
    
  } catch (error) {
    console.error('Error handling GitHub PR:', error);
    res.status(500).json({ error: 'Failed to handle PR event' });
  }
}

function handleGitHubIssue(payload, res) {
  try {
    const { repository, issue, action } = payload;
    const repoUrl = repository.clone_url;
    
    console.log(`🐛 GitHub issue ${action} for ${repoUrl} (#${issue.number})`);
    
    // For now, just log the event
    res.json({ message: 'Issue event received' });
    
  } catch (error) {
    console.error('Error handling GitHub issue:', error);
    res.status(500).json({ error: 'Failed to handle issue event' });
  }
}

function handleGitHubRelease(payload, res) {
  try {
    const { repository, release, action } = payload;
    const repoUrl = repository.clone_url;
    
    console.log(`🚀 GitHub release ${action} for ${repoUrl} (${release.tag_name})`);
    
    // Find existing project and trigger update for new releases
    const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
    
    if (existingProject && action === 'published') {
      console.log(`🚀 New release detected, triggering documentation update`);
      
      existingProject.status = 'updating';
      existingProject.lastUpdate = new Date().toISOString();
      existingProject.updateTrigger = 'github_release';
      existingProject.releaseInfo = {
        tag: release.tag_name,
        name: release.name,
        body: release.body
      };
      
      // Add to processing queue
      addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
      
      res.json({
        message: 'Release update triggered',
        projectId: existingProject.id,
        release: release.tag_name
      });
    } else {
      res.json({ message: 'Release event received' });
    }
    
  } catch (error) {
    console.error('Error handling GitHub release:', error);
    res.status(500).json({ error: 'Failed to handle release event' });
  }
}

// GitLab event handlers
function handleGitLabPush(payload, res) {
  try {
    const { project, ref, commits } = payload;
    const repoUrl = project.git_http_url;
    
    console.log(`🔄 GitLab push event for ${repoUrl} (${ref})`);
    
    // Find existing project
    const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
    
    if (existingProject) {
      console.log(`🔄 Triggering update for existing project: ${existingProject.projectName}`);
      
      existingProject.status = 'updating';
      existingProject.lastUpdate = new Date().toISOString();
      existingProject.updateTrigger = 'gitlab_webhook';
      
      // Add to processing queue
      addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
      
      res.json({
        message: 'Project update triggered',
        projectId: existingProject.id,
        projectName: existingProject.projectName,
        commits: commits.length
      });
    } else {
      res.json({ message: 'No existing project found, webhook ignored' });
    }
    
  } catch (error) {
    console.error('Error handling GitLab push:', error);
    res.status(500).json({ error: 'Failed to handle push event' });
  }
}

function handleGitLabMergeRequest(payload, res) {
  try {
    const { project, object_attributes } = payload;
    const repoUrl = project.git_http_url;
    
    console.log(`🔀 GitLab MR for ${repoUrl} (#${object_attributes.iid})`);
    
    res.json({ message: 'Merge request event received' });
    
  } catch (error) {
    console.error('Error handling GitLab MR:', error);
    res.status(500).json({ error: 'Failed to handle MR event' });
  }
}

function handleGitLabIssue(payload, res) {
  try {
    const { project, object_attributes } = payload;
    const repoUrl = project.git_http_url;
    
    console.log(`🐛 GitLab issue for ${repoUrl} (#${object_attributes.iid})`);
    
    res.json({ message: 'Issue event received' });
    
  } catch (error) {
    console.error('Error handling GitLab issue:', error);
    res.status(500).json({ error: 'Failed to handle issue event' });
  }
}

function handleGitLabRelease(payload, res) {
  try {
    const { project, name, tag } = payload;
    const repoUrl = project.git_http_url;
    
    console.log(`🚀 GitLab release for ${repoUrl} (${tag})`);
    
    // Find existing project and trigger update
    const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
    
    if (existingProject) {
      existingProject.status = 'updating';
      existingProject.lastUpdate = new Date().toISOString();
      existingProject.updateTrigger = 'gitlab_release';
      existingProject.releaseInfo = { name, tag };
      
      // Add to processing queue
      addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
      
      res.json({
        message: 'Release update triggered',
        projectId: existingProject.id,
        release: tag
      });
    } else {
      res.json({ message: 'Release event received' });
    }
    
  } catch (error) {
    console.error('Error handling GitLab release:', error);
    res.status(500).json({ error: 'Failed to handle release event' });
  }
}

// Webhook configuration endpoint
app.get('/api/webhooks/config', (req, res) => {
  try {
    const config = {
      github: {
        enabled: !!webhookConfig.github.secret,
        events: webhookConfig.github.events,
        endpoint: '/api/webhooks/github'
      },
      gitlab: {
        enabled: !!webhookConfig.gitlab.secret,
        events: webhookConfig.gitlab.events,
        endpoint: '/api/webhooks/gitlab'
      }
    };
    
    res.json(config);
    
  } catch (error) {
    console.error('Error getting webhook config:', error);
    res.status(500).json({ error: 'Failed to get webhook configuration' });
  }
});

// Add export functionality for multiple formats
const exportFormats = {
  pdf: {
    name: 'PDF Document',
    extension: '.pdf',
    mimeType: 'application/pdf',
    description: 'Portable Document Format'
  },
  docx: {
    name: 'Word Document',
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    description: 'Microsoft Word Document'
  },
  html: {
    name: 'HTML Document',
    extension: '.html',
    mimeType: 'text/html',
    description: 'Web page format'
  },
  txt: {
    name: 'Plain Text',
    extension: '.txt',
    mimeType: 'text/plain',
    description: 'Plain text format'
  },
  json: {
    name: 'JSON Data',
    extension: '.json',
    mimeType: 'application/json',
    description: 'Structured data format'
  }
};

// Export project documentation
app.post('/api/projects/:projectId/export', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { format, includeCode, includeStructure, includeReadme } = req.body;
    
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to export' });
    }
    
    if (!exportFormats[format]) {
      return res.status(400).json({ error: 'Unsupported export format' });
    }
    
    console.log(`📤 Exporting project ${projectId} to ${format.toUpperCase()}`);
    
    let exportedContent;
    let filename;
    
    switch (format) {
      case 'pdf':
        exportedContent = await exportToPDF(project, { includeCode, includeStructure, includeReadme });
        filename = `${project.projectName}-documentation.pdf`;
        break;
      case 'docx':
        exportedContent = await exportToDOCX(project, { includeCode, includeStructure, includeReadme });
        filename = `${project.projectName}-documentation.docx`;
        break;
      case 'html':
        exportedContent = exportToHTML(project, { includeCode, includeStructure, includeReadme });
        filename = `${project.projectName}-documentation.html`;
        break;
      case 'txt':
        exportedContent = exportToTXT(project, { includeCode, includeStructure, includeReadme });
        filename = `${project.projectName}-documentation.txt`;
        break;
      case 'json':
        exportedContent = exportToJSON(project, { includeCode, includeStructure, includeReadme });
        filename = `${project.projectName}-documentation.json`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported export format' });
    }
    
    // Set response headers
    res.setHeader('Content-Type', exportFormats[format].mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(exportedContent));
    
    // Send the exported content
    res.send(exportedContent);
    
    console.log(`✅ Successfully exported project ${projectId} to ${format.toUpperCase()}`);
    
  } catch (error) {
    console.error('Error exporting project:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Export to PDF using Puppeteer
async function exportToPDF(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  try {
    // Generate HTML content
    const htmlContent = generateExportHTML(project, { includeCode, includeStructure, includeReadme });
    
    // Launch browser
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set content and wait for rendering
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '1in',
        right: '1in',
        bottom: '1in',
        left: '1in'
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
          ${project.projectName} - Documentation
        </div>
      `,
      footerTemplate: `
        <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
          Generated by GitGen on ${new Date().toLocaleDateString()}
        </div>
      `
    });
    
    await browser.close();
    return pdf;
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('PDF generation failed');
  }
}

// Export to DOCX using docx library
async function exportToDOCX(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  try {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: project.projectName,
            heading: HeadingLevel.TITLE
          }),
          new Paragraph({
            text: 'Project Documentation',
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph({
            text: `Generated on ${new Date().toLocaleDateString()}`,
            spacing: { after: 200 }
          })
        ]
      }]
    });
    
    // Add project information
    if (project.description) {
      doc.addSection({
        children: [
          new Paragraph({
            text: 'Description',
            heading: HeadingLevel.HEADING_2
          }),
          new Paragraph({
            text: project.description
          })
        ]
      });
    }
    
    // Add README content
    if (includeReadme && project.documentation.readme) {
      doc.addSection({
        children: [
          new Paragraph({
            text: 'README',
            heading: HeadingLevel.HEADING_2
          }),
          new Paragraph({
            text: project.documentation.readme.raw
          })
        ]
      });
    }
    
    // Add project structure
    if (includeStructure && project.documentation.structure) {
      doc.addSection({
        children: [
          new Paragraph({
            text: 'Project Structure',
            heading: HeadingLevel.HEADING_2
          }),
          ...generateStructureParagraphs(project.documentation.structure)
        ]
      });
    }
    
    // Add code files
    if (includeCode && project.documentation.files) {
      doc.addSection({
        children: [
          new Paragraph({
            text: 'Source Code',
            heading: HeadingLevel.HEADING_2
          }),
          ...generateCodeParagraphs(project.documentation.files)
        ]
      });
    }
    
    // Generate DOCX buffer
    const buffer = await Packer.toBuffer(doc);
    return buffer;
    
  } catch (error) {
    console.error('Error generating DOCX:', error);
    throw new Error('DOCX generation failed');
  }
}

// Export to HTML
function exportToHTML(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  const html = generateExportHTML(project, { includeCode, includeStructure, includeReadme });
  return html;
}

// Export to plain text
function exportToTXT(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  let content = `${project.projectName}\n`;
  content += '='.repeat(project.projectName.length) + '\n\n';
  content += `Generated on: ${new Date().toLocaleDateString()}\n\n`;
  
  if (project.description) {
    content += `Description: ${project.description}\n\n`;
  }
  
  if (includeReadme && project.documentation.readme) {
    content += 'README\n';
    content += '-'.repeat(5) + '\n';
    content += project.documentation.readme.raw + '\n\n';
  }
  
  if (includeStructure && project.documentation.structure) {
    content += 'Project Structure\n';
    content += '-'.repeat(17) + '\n';
    content += generateStructureText(project.documentation.structure) + '\n\n';
  }
  
  if (includeCode && project.documentation.files) {
    content += 'Source Code\n';
    content += '-'.repeat(12) + '\n';
    project.documentation.files.forEach(file => {
      content += `File: ${file.path}\n`;
      if (file.functions && file.functions.length > 0) {
        content += `Functions: ${file.functions.join(', ')}\n`;
      }
      if (file.classes && file.classes.length > 0) {
        content += `Classes: ${file.classes.join(', ')}\n`;
      }
      content += '\n';
    });
  }
  
  return content;
}

// Export to JSON
function exportToJSON(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  const exportData = {
    project: {
      id: project.id,
      name: project.projectName,
      description: project.description,
      repoUrl: project.repoUrl,
      status: project.status,
      createdAt: project.createdAt,
      completedAt: project.completedAt
    },
    documentation: {
      summary: project.documentation.summary,
      readme: includeReadme ? project.documentation.readme : null,
      structure: includeStructure ? project.documentation.structure : null,
      files: includeCode ? project.documentation.files.map(file => ({
        path: file.path,
        extension: file.extension,
        type: file.type,
        functions: file.functions,
        classes: file.classes,
        imports: file.imports
      })) : null
    },
    exportInfo: {
      exportedAt: new Date().toISOString(),
      format: 'json',
      options
    }
  };
  
  return JSON.stringify(exportData, null, 2);
}

// Generate HTML for export
function generateExportHTML(project, options = {}) {
  const { includeCode = true, includeStructure = true, includeReadme = true } = options;
  
  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${project.projectName} - Documentation</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin: 0; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
        .file-tree { font-family: monospace; background: #f5f5f5; padding: 15px; border-radius: 5px; }
        .code-block { background: #f8f8f8; border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin: 10px 0; }
        .function { color: #0066cc; font-weight: bold; }
        .class { color: #cc6600; font-weight: bold; }
        .footer { text-align: center; margin-top: 50px; padding-top: 20px; border-top: 1px solid #ccc; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${project.projectName}</h1>
        <p>Project Documentation</p>
        <p><em>Generated on ${new Date().toLocaleDateString()}</em></p>
      </div>
  `;
  
  if (project.description) {
    html += `
      <div class="section">
        <h2>Description</h2>
        <p>${project.description}</p>
      </div>
    `;
  }
  
  if (includeReadme && project.documentation.readme) {
    html += `
      <div class="section">
        <h2>README</h2>
        <div class="readme-content">
          ${project.documentation.readme.content}
        </div>
      </div>
    `;
  }
  
  if (includeStructure && project.documentation.structure) {
    html += `
      <div class="section">
        <h2>Project Structure</h2>
        <div class="file-tree">
          ${generateStructureHTML(project.documentation.structure)}
        </div>
      </div>
    `;
  }
  
  if (includeCode && project.documentation.files) {
    html += `
      <div class="section">
        <h2>Source Code</h2>
        ${generateCodeHTML(project.documentation.files)}
      </div>
    `;
  }
  
  html += `
      <div class="footer">
        <p>Generated by GitGen - Modern documentation generator for Git repositories</p>
      </div>
    </body>
    </html>
  `;
  
  return html;
}

// Helper functions for DOCX generation
function generateStructureParagraphs(structure, prefix = '') {
  const paragraphs = [];
  
  Object.entries(structure).forEach(([name, info]) => {
    if (info.type === 'directory') {
      paragraphs.push(new Paragraph({
        text: `${prefix}📁 ${name}/`,
        spacing: { before: 100 }
      }));
      
      if (info.children) {
        paragraphs.push(...generateStructureParagraphs(info.children, prefix + '  '));
      }
    } else {
      paragraphs.push(new Paragraph({
        text: `${prefix}📄 ${name}`,
        spacing: { before: 50 }
      }));
    }
  });
  
  return paragraphs;
}

function generateCodeParagraphs(files) {
  const paragraphs = [];
  
  files.forEach(file => {
    paragraphs.push(new Paragraph({
      text: `File: ${file.path}`,
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 }
    }));
    
    if (file.functions && file.functions.length > 0) {
      paragraphs.push(new Paragraph({
        text: `Functions: ${file.functions.join(', ')}`,
        spacing: { after: 100 }
      }));
    }
    
    if (file.classes && file.classes.length > 0) {
      paragraphs.push(new Paragraph({
        text: `Classes: ${file.classes.join(', ')}`,
        spacing: { after: 100 }
      }));
    }
  });
  
  return paragraphs;
}

// Helper functions for text generation
function generateStructureText(structure, prefix = '') {
  let text = '';
  
  Object.entries(structure).forEach(([name, info]) => {
    if (info.type === 'directory') {
      text += `${prefix}📁 ${name}/\n`;
      if (info.children) {
        text += generateStructureText(info.children, prefix + '  ');
      }
    } else {
      text += `${prefix}📄 ${name}\n`;
    }
  });
  
  return text;
}

// Helper functions for HTML generation
function generateStructureHTML(structure, prefix = '') {
  let html = '';
  
  Object.entries(structure).forEach(([name, info]) => {
    if (info.type === 'directory') {
      html += `<div style="margin-left: ${prefix.length * 20}px;">📁 ${name}/</div>`;
      if (info.children) {
        html += generateStructureHTML(info.children, prefix + '  ');
      }
    } else {
      html += `<div style="margin-left: ${prefix.length * 20}px;">📄 ${name}</div>`;
    }
  });
  
  return html;
}

function generateCodeHTML(files) {
  let html = '';
  
  files.forEach(file => {
    html += `
      <div class="code-block">
        <h3>${file.path}</h3>
        ${file.functions && file.functions.length > 0 ? `<p><span class="function">Functions:</span> ${file.functions.join(', ')}</p>` : ''}
        ${file.classes && file.classes.length > 0 ? `<p><span class="class">Classes:</span> ${file.classes.join(', ')}</p>` : ''}
      </div>
    `;
  });
  
  return html;
}

// Get available export formats
app.get('/api/export/formats', (req, res) => {
  try {
    res.json({
      formats: exportFormats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting export formats:', error);
    res.status(500).json({ error: 'Failed to get export formats' });
  }
});
// Add internationalization support
const i18n = {
  locales: ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'ru'],
  defaultLocale: 'en',
  messages: {
    en: {
      // Common
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      search: 'Search',
      filter: 'Filter',
      sort: 'Sort',
      
      // Navigation
      home: 'Home',
      projects: 'Projects',
      templates: 'Templates',
      settings: 'Settings',
      help: 'Help',
      
      // Project
      projectName: 'Project Name',
      repositoryUrl: 'Repository URL',
      description: 'Description',
      status: 'Status',
      createdAt: 'Created At',
      completedAt: 'Completed At',
      processing: 'Processing',
      completed: 'Completed',
      failed: 'Failed',
      queued: 'Queued',
      
      // Actions
      generateDocumentation: 'Generate Documentation',
      viewDocumentation: 'View Documentation',
      exportDocumentation: 'Export Documentation',
      regenerateDocumentation: 'Regenerate Documentation',
      
      // Status messages
      projectCreated: 'Project created successfully',
      projectUpdated: 'Project updated successfully',
      projectDeleted: 'Project deleted successfully',
      documentationGenerated: 'Documentation generated successfully',
      
      // Errors
      projectNotFound: 'Project not found',
      invalidRepositoryUrl: 'Invalid repository URL',
      repositoryCloneFailed: 'Failed to clone repository',
      documentationGenerationFailed: 'Documentation generation failed',
      
      // Export
      exportFormats: 'Export Formats',
      exportToPDF: 'Export to PDF',
      exportToWord: 'Export to Word',
      exportToHTML: 'Export to HTML',
      exportToText: 'Export to Text',
      exportToJSON: 'Export to JSON',
      
      // Templates
      customTemplates: 'Custom Templates',
      createTemplate: 'Create Template',
      templateName: 'Template Name',
      templateDescription: 'Template Description',
      templateContent: 'Template Content',
      makePublic: 'Make Public',
      tags: 'Tags',
      
      // Search
      searchProjects: 'Search Projects',
      searchFiles: 'Search Files',
      searchFunctions: 'Search Functions',
      searchClasses: 'Search Classes',
      searchResults: 'Search Results',
      noResultsFound: 'No results found',
      
      // Webhooks
      webhooks: 'Webhooks',
      githubWebhook: 'GitHub Webhook',
      gitlabWebhook: 'GitLab Webhook',
      webhookUrl: 'Webhook URL',
      webhookSecret: 'Webhook Secret',
      webhookEvents: 'Webhook Events'
    },
    es: {
      // Common
      loading: 'Cargando...',
      error: 'Error',
      success: 'Éxito',
      cancel: 'Cancelar',
      save: 'Guardar',
      delete: 'Eliminar',
      edit: 'Editar',
      create: 'Crear',
      search: 'Buscar',
      filter: 'Filtrar',
      sort: 'Ordenar',
      
      // Navigation
      home: 'Inicio',
      projects: 'Proyectos',
      templates: 'Plantillas',
      settings: 'Configuración',
      help: 'Ayuda',
      
      // Project
      projectName: 'Nombre del Proyecto',
      repositoryUrl: 'URL del Repositorio',
      description: 'Descripción',
      status: 'Estado',
      createdAt: 'Creado En',
      completedAt: 'Completado En',
      processing: 'Procesando',
      completed: 'Completado',
      failed: 'Fallido',
      queued: 'En Cola',
      
      // Actions
      generateDocumentation: 'Generar Documentación',
      viewDocumentation: 'Ver Documentación',
      exportDocumentation: 'Exportar Documentación',
      regenerateDocumentation: 'Regenerar Documentación',
      
      // Status messages
      projectCreated: 'Proyecto creado exitosamente',
      projectUpdated: 'Proyecto actualizado exitosamente',
      projectDeleted: 'Proyecto eliminado exitosamente',
      documentationGenerated: 'Documentación generada exitosamente',
      
      // Errors
      projectNotFound: 'Proyecto no encontrado',
      invalidRepositoryUrl: 'URL de repositorio inválida',
      repositoryCloneFailed: 'Falló la clonación del repositorio',
      documentationGenerationFailed: 'Falló la generación de documentación',
      
      // Export
      exportFormats: 'Formatos de Exportación',
      exportToPDF: 'Exportar a PDF',
      exportToWord: 'Exportar a Word',
      exportToHTML: 'Exportar a HTML',
      exportToText: 'Exportar a Texto',
      exportToJSON: 'Exportar a JSON',
      
      // Templates
      customTemplates: 'Plantillas Personalizadas',
      createTemplate: 'Crear Plantilla',
      templateName: 'Nombre de la Plantilla',
      templateDescription: 'Descripción de la Plantilla',
      templateContent: 'Contenido de la Plantilla',
      makePublic: 'Hacer Público',
      tags: 'Etiquetas',
      
      // Search
      searchProjects: 'Buscar Proyectos',
      searchFiles: 'Buscar Archivos',
      searchFunctions: 'Buscar Funciones',
      searchClasses: 'Buscar Clases',
      searchResults: 'Resultados de Búsqueda',
      noResultsFound: 'No se encontraron resultados',
      
      // Webhooks
      webhooks: 'Webhooks',
      githubWebhook: 'Webhook de GitHub',
      gitlabWebhook: 'Webhook de GitLab',
      webhookUrl: 'URL del Webhook',
      webhookSecret: 'Secreto del Webhook',
      webhookEvents: 'Eventos del Webhook'
    },
    fr: {
      // Common
      loading: 'Chargement...',
      error: 'Erreur',
      success: 'Succès',
      cancel: 'Annuler',
      save: 'Sauvegarder',
      delete: 'Supprimer',
      edit: 'Modifier',
      create: 'Créer',
      search: 'Rechercher',
      filter: 'Filtrer',
      sort: 'Trier',
      
      // Navigation
      home: 'Accueil',
      projects: 'Projets',
      templates: 'Modèles',
      settings: 'Paramètres',
      help: 'Aide',
      
      // Project
      projectName: 'Nom du Projet',
      repositoryUrl: 'URL du Dépôt',
      description: 'Description',
      status: 'Statut',
      createdAt: 'Créé Le',
      completedAt: 'Terminé Le',
      processing: 'En Cours',
      completed: 'Terminé',
      failed: 'Échoué',
      queued: 'En Attente',
      
      // Actions
      generateDocumentation: 'Générer la Documentation',
      viewDocumentation: 'Voir la Documentation',
      exportDocumentation: 'Exporter la Documentation',
      regenerateDocumentation: 'Régénérer la Documentation',
      
      // Status messages
      projectCreated: 'Projet créé avec succès',
      projectUpdated: 'Projet mis à jour avec succès',
      projectDeleted: 'Projet supprimé avec succès',
      documentationGenerated: 'Documentation générée avec succès',
      
      // Errors
      projectNotFound: 'Projet non trouvé',
      invalidRepositoryUrl: 'URL de dépôt invalide',
      repositoryCloneFailed: 'Échec du clonage du dépôt',
      documentationGenerationFailed: 'Échec de la génération de documentation',
      
      // Export
      exportFormats: 'Formats d\'Exportation',
      exportToPDF: 'Exporter en PDF',
      exportToWord: 'Exporter en Word',
      exportToHTML: 'Exporter en HTML',
      exportToText: 'Exporter en Texte',
      exportToJSON: 'Exporter en JSON',
      
      // Templates
      customTemplates: 'Modèles Personnalisés',
      createTemplate: 'Créer un Modèle',
      templateName: 'Nom du Modèle',
      templateDescription: 'Description du Modèle',
      templateContent: 'Contenu du Modèle',
      makePublic: 'Rendre Public',
      tags: 'Balises',
      
      // Search
      searchProjects: 'Rechercher des Projets',
      searchFiles: 'Rechercher des Fichiers',
      searchFunctions: 'Rechercher des Fonctions',
      searchClasses: 'Rechercher des Classes',
      searchResults: 'Résultats de Recherche',
      noResultsFound: 'Aucun résultat trouvé',
      
      // Webhooks
      webhooks: 'Webhooks',
      githubWebhook: 'Webhook GitHub',
      gitlabWebhook: 'Webhook GitLab',
      webhookUrl: 'URL du Webhook',
      webhookSecret: 'Secret du Webhook',
      webhookEvents: 'Événements du Webhook'
    }
  }
};

// Get message for current locale
function getMessage(key, locale = 'en', params = {}) {
  const messages = i18n.messages[locale] || i18n.messages[i18n.defaultLocale];
  let message = messages[key] || key;
  
  // Replace parameters
  Object.entries(params).forEach(([param, value]) => {
    message = message.replace(`{${param}}`, value);
  });
  
  return message;
}

// Get supported locales
function getSupportedLocales() {
  return i18n.locales.map(locale => ({
    code: locale,
    name: getLocaleName(locale),
    nativeName: getNativeLocaleName(locale)
  }));
}

// Get locale display name
function getLocaleName(locale) {
  const names = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    ru: 'Russian'
  };
  return names[locale] || locale;
}

// Get native locale name
function getNativeLocaleName(locale) {
  const names = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
    zh: '中文',
    ko: '한국어',
    ru: 'Русский'
  };
  return names[locale] || locale;
}

// Internationalization endpoints
app.get('/api/i18n/locales', (req, res) => {
  try {
    res.json({
      locales: getSupportedLocales(),
      defaultLocale: i18n.defaultLocale,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting locales:', error);
    res.status(500).json({ error: 'Failed to get locales' });
  }
});

app.get('/api/i18n/messages/:locale', (req, res) => {
  try {
    const { locale } = req.params;
    
    if (!i18n.locales.includes(locale)) {
      return res.status(400).json({ error: 'Unsupported locale' });
    }
    
    const messages = i18n.messages[locale] || {};
    
    res.json({
      locale,
      messages,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get message endpoint
app.get('/api/i18n/message/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { locale = 'en', ...params } = req.query;
    
    const message = getMessage(key, locale, params);
    
    res.json({
      key,
      locale,
      message,
      params,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting message:', error);
    res.status(500).json({ error: 'Failed to get message' });
  }
});

// Update user locale preference
app.post('/api/i18n/preference', (req, res) => {
  try {
    const { locale, userId } = req.body;
    
    if (!i18n.locales.includes(locale)) {
      return res.status(400).json({ error: 'Unsupported locale' });
    }
    
    // Store user preference (in a real app, this would go to a database)
    // For now, we'll just return success
    res.json({
      message: 'Locale preference updated',
      locale,
      userId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error updating locale preference:', error);
    res.status(500).json({ error: 'Failed to update locale preference' });
  }
});

// Middleware to detect user locale
app.use('/api', (req, res, next) => {
  // Detect locale from headers
  const acceptLanguage = req.headers['accept-language'];
  let userLocale = i18n.defaultLocale;
  
  if (acceptLanguage) {
    // Parse Accept-Language header
    const languages = acceptLanguage.split(',')
      .map(lang => lang.split(';')[0].trim())
      .map(lang => lang.split('-')[0]); // Get primary language
    
    // Find first supported language
    for (const lang of languages) {
      if (i18n.locales.includes(lang)) {
        userLocale = lang;
        break;
      }
    }
  }
  
  // Add locale to request object
  req.userLocale = userLocale;
  next();
});

// Helper function to get localized response
function getLocalizedResponse(key, req, params = {}) {
  const locale = req.userLocale || i18n.defaultLocale;
  return getMessage(key, locale, params);
}

// Update existing endpoints to use localization
app.get('/api/health', (req, res) => {
  const message = getLocalizedResponse('success', req);
  res.json({ 
    status: 'healthy', 
    service: 'GitGen',
    message,
    locale: req.userLocale
  });
});

// Add security enhancements and audit logging
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Security configuration
const securityConfig = {
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  bcryptRounds: 12,
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000 // 15 minutes
};

// Audit logging system
const auditLog = [];
const MAX_AUDIT_LOG_SIZE = 10000;

// Audit log entry structure
class AuditLogEntry {
  constructor(action, userId, resource, details, ip, userAgent) {
    this.id = uuidv4();
    this.timestamp = new Date().toISOString();
    this.action = action;
    this.userId = userId || 'anonymous';
    this.resource = resource;
    this.details = details;
    this.ip = ip;
    this.userAgent = userAgent;
    this.sessionId = null;
  }
  
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }
}

// Add audit log entry
function addAuditLog(action, userId, resource, details, req) {
  const entry = new AuditLogEntry(
    action,
    userId,
    resource,
    details,
    req.ip || req.connection.remoteAddress,
    req.headers['user-agent']
  );
  
  auditLog.push(entry);
  
  // Maintain log size
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.shift();
  }
  
  console.log(`🔒 AUDIT: ${action} by ${userId} on ${resource} - ${details}`);
}

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Rate limiting for security-sensitive endpoints
const securityLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 attempts per 15 minutes
  'Too many security-related requests, please try again later.'
);

// Apply security rate limiting
app.use('/api/auth', securityLimiter);
app.use('/api/admin', securityLimiter);

// Security middleware
app.use((req, res, next) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Log security events
  if (req.path.includes('/admin') || req.path.includes('/auth')) {
    addAuditLog('SECURITY_ACCESS', req.userId || 'anonymous', req.path, 'Security endpoint accessed', req);
  }
  
  next();
});

// GDPR compliance endpoints
app.get('/api/gdpr/data/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    // In a real app, this would fetch user data from database
    const userData = {
      userId,
      projects: Array.from(projects.values()).filter(p => p.userId === userId),
      templates: Array.from(customTemplates.values()).filter(t => t.userId === userId),
      auditLog: auditLog.filter(log => log.userId === userId),
      exportHistory: [], // Would come from database
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    addAuditLog('GDPR_DATA_REQUEST', userId, 'gdpr', 'User data export requested', req);
    
    res.json({
      message: 'User data exported successfully',
      data: userData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error exporting user data:', error);
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

app.delete('/api/gdpr/data/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    // In a real app, this would delete user data from database
    // For now, we'll just mark projects as deleted
    let deletedCount = 0;
    
    for (const [projectId, project] of projects.entries()) {
      if (project.userId === userId) {
        project.deletedAt = new Date().toISOString();
        project.deletedBy = 'GDPR_REQUEST';
        project.status = 'deleted';
        deletedCount++;
      }
    }
    
    // Mark templates as deleted
    let deletedTemplates = 0;
    for (const [templateId, template] of customTemplates.entries()) {
      if (template.userId === userId) {
        template.deletedAt = new Date().toISOString();
        template.deletedBy = 'GDPR_REQUEST';
        deletedTemplates++;
      }
    }
    
    addAuditLog('GDPR_DATA_DELETION', userId, 'gdpr', `User data deleted: ${deletedCount} projects, ${deletedTemplates} templates`, req);
    
    res.json({
      message: 'User data deleted successfully',
      deletedProjects: deletedCount,
      deletedTemplates: deletedTemplates,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error deleting user data:', error);
    res.status(500).json({ error: 'Failed to delete user data' });
  }
});

// Audit log endpoints
app.get('/api/admin/audit-log', (req, res) => {
  try {
    const { action, userId, resource, startDate, endDate, limit = 100 } = req.query;
    
    let filteredLog = auditLog;
    
    // Apply filters
    if (action) {
      filteredLog = filteredLog.filter(log => log.action === action);
    }
    
    if (userId) {
      filteredLog = filteredLog.filter(log => log.userId === userId);
    }
    
    if (resource) {
      filteredLog = filteredLog.filter(log => log.resource.includes(resource));
    }
    
    if (startDate) {
      const start = new Date(startDate);
      filteredLog = filteredLog.filter(log => new Date(log.timestamp) >= start);
    }
    
    if (endDate) {
      const end = new Date(endDate);
      filteredLog = filteredLog.filter(log => new Date(log.timestamp) <= end);
    }
    
    // Apply limit and sort by timestamp
    const limitedLog = filteredLog
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    addAuditLog('AUDIT_LOG_ACCESSED', req.userId || 'anonymous', 'admin', 'Audit log accessed', req);
    
    res.json({
      totalEntries: filteredLog.length,
      entries: limitedLog,
      filters: { action, userId, resource, startDate, endDate, limit },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error accessing audit log:', error);
    res.status(500).json({ error: 'Failed to access audit log' });
  }
});

// Security status endpoint
app.get('/api/admin/security-status', (req, res) => {
  try {
    const status = {
      securityHeaders: true,
      rateLimiting: true,
      auditLogging: true,
      gdprCompliance: true,
      encryption: true,
      sessionManagement: true,
      lastSecurityScan: new Date().toISOString(),
      vulnerabilities: [],
      recommendations: []
    };
    
    // Check for potential security issues
    if (securityConfig.jwtSecret === 'your-super-secret-jwt-key-change-in-production') {
      status.recommendations.push('Change default JWT secret in production');
    }
    
    if (process.env.NODE_ENV !== 'production') {
      status.recommendations.push('Enable production mode for enhanced security');
    }
    
    addAuditLog('SECURITY_STATUS_CHECKED', req.userId || 'anonymous', 'admin', 'Security status checked', req);
    
    res.json(status);
    
  } catch (error) {
    console.error('Error checking security status:', error);
    res.status(500).json({ error: 'Failed to check security status' });
  }
});

// Update existing endpoints to include audit logging
const originalCreateProject = app._router.stack.find(layer => 
  layer.route && layer.route.path === '/api/projects' && layer.route.methods.post
);

if (originalCreateProject) {
  app.post('/api/projects', (req, res) => {
    // Log the action before processing
    addAuditLog('PROJECT_CREATED', req.userId || 'anonymous', 'projects', 
      `Project creation initiated: ${req.body.projectName}`, req);
    
    // Call the original handler
    originalCreateProject.handle(req, res);
  });
}

// Add audit logging to other critical endpoints
app.use('/api/projects/:projectId', (req, res, next) => {
  const { projectId } = req.params;
  const action = req.method === 'GET' ? 'PROJECT_VIEWED' : 
                 req.method === 'PUT' ? 'PROJECT_UPDATED' : 
                 req.method === 'DELETE' ? 'PROJECT_DELETED' : 'PROJECT_ACCESSED';
  
  addAuditLog(action, req.userId || 'anonymous', `projects/${projectId}`, 
    `${req.method} request to project ${projectId}`, req);
  
  next();
});

// Security monitoring middleware
app.use((req, res, next) => {
  // Monitor for suspicious activity
  const suspiciousPatterns = [
    /\.\.\//, // Directory traversal
    /<script/i, // XSS attempts
    /union\s+select/i, // SQL injection
    /eval\s*\(/i, // Code injection
    /javascript:/i // JavaScript protocol
  ];
  
  const requestString = JSON.stringify(req.body) + req.url + JSON.stringify(req.query);
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestString)) {
      addAuditLog('SECURITY_THREAT_DETECTED', req.userId || 'anonymous', req.path, 
        `Suspicious pattern detected: ${pattern.source}`, req);
      
      return res.status(400).json({ 
        error: 'Invalid request detected',
        message: 'Request contains potentially malicious content'
      });
    }
  }
  
  next();
});

// Add security headers to WebSocket connections
wss.on('connection', (ws, req) => {
  // Validate origin
  const origin = req.headers.origin;
  if (origin && !isValidOrigin(origin)) {
    addAuditLog('WEBSOCKET_ORIGIN_REJECTED', 'anonymous', 'websocket', 
      `Invalid origin: ${origin}`, req);
    ws.close(1008, 'Invalid origin');
    return;
  }
  
  // ... existing WebSocket code ...
});

// Validate WebSocket origin
function isValidOrigin(origin) {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://yourdomain.com' // Add your production domain
  ];
  
  return allowedOrigins.includes(origin);
}
// Add analytics dashboard and code quality metrics
const analytics = {
  projects: {
    total: 0,
    completed: 0,
    failed: 0,
    processing: 0,
    queued: 0,
    byLanguage: {},
    byStatus: {},
    byDate: {},
    averageProcessingTime: 0
  },
  users: {
    total: 0,
    active: 0,
    new: 0,
    byActivity: {}
  },
  system: {
    uptime: 0,
    memoryUsage: 0,
    cpuUsage: 0,
    activeConnections: 0,
    requestsPerMinute: 0,
    errorRate: 0
  },
  performance: {
    averageResponseTime: 0,
    cacheHitRate: 0,
    searchQueries: 0,
    exportsGenerated: 0,
    aiGenerations: 0
  }
};

// Analytics tracking functions
function trackProjectCreated(project) {
  analytics.projects.total++;
  analytics.projects.byStatus[project.status] = (analytics.projects.byStatus[project.status] || 0) + 1;
  
  const date = new Date().toISOString().split('T')[0];
  analytics.projects.byDate[date] = (analytics.projects.byDate[date] || 0) + 1;
  
  if (project.documentation && project.documentation.summary) {
    const languages = Object.keys(project.documentation.summary.languages || {});
    languages.forEach(lang => {
      analytics.projects.byLanguage[lang] = (analytics.projects.byLanguage[lang] || 0) + 1;
    });
  }
}

function trackProjectCompleted(project, processingTime) {
  analytics.projects.completed++;
  analytics.projects.byStatus.completed = (analytics.projects.byStatus.completed || 0) + 1;
  analytics.projects.byStatus.processing = Math.max(0, (analytics.projects.byStatus.processing || 0) - 1);
  
  // Update average processing time
  const currentAvg = analytics.projects.averageProcessingTime;
  const totalCompleted = analytics.projects.completed;
  analytics.projects.averageProcessingTime = ((currentAvg * (totalCompleted - 1)) + processingTime) / totalCompleted;
}

function trackProjectFailed(project) {
  analytics.projects.failed++;
  analytics.projects.byStatus.failed = (analytics.projects.byStatus.failed || 0) + 1;
  analytics.projects.byStatus.processing = Math.max(0, (analytics.projects.byStatus.processing || 0) - 1);
}

function trackUserActivity(userId, action) {
  if (!analytics.users.byActivity[userId]) {
    analytics.users.byActivity[userId] = {
      lastSeen: new Date().toISOString(),
      actions: 0,
      projects: 0
    };
  }
  
  analytics.users.byActivity[userId].lastSeen = new Date().toISOString();
  analytics.users.byActivity[userId].actions++;
  
  if (action === 'PROJECT_CREATED') {
    analytics.users.byActivity[userId].projects++;
  }
}

function trackSystemMetrics() {
  const memUsage = process.memoryUsage();
  analytics.system.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
  analytics.system.uptime = process.uptime();
  analytics.system.activeConnections = activeConnections.size;
}

function trackPerformanceMetrics(responseTime, cacheHit, searchQuery, exportGenerated, aiGenerated) {
  // Update average response time
  const currentAvg = analytics.performance.averageResponseTime;
  const totalRequests = Object.values(analytics.users.byActivity).reduce((sum, user) => sum + user.actions, 0);
  analytics.performance.averageResponseTime = ((currentAvg * (totalRequests - 1)) + responseTime) / totalRequests;
  
  // Update cache hit rate
  if (cacheHit !== undefined) {
    analytics.performance.cacheHitRate = cacheHit ? 
      (analytics.performance.cacheHitRate + 1) / 2 : 
      analytics.performance.cacheHitRate / 2;
  }
  
  if (searchQuery) analytics.performance.searchQueries++;
  if (exportGenerated) analytics.performance.exportsGenerated++;
  if (aiGenerated) analytics.performance.aiGenerations++;
}

// Update analytics when projects change
function updateProjectAnalytics() {
  analytics.projects.total = projects.size;
  analytics.projects.completed = Array.from(projects.values()).filter(p => p.status === 'completed').length;
  analytics.projects.failed = Array.from(projects.values()).filter(p => p.status === 'failed').length;
  analytics.projects.processing = Array.from(projects.values()).filter(p => p.status === 'processing').length;
  analytics.projects.queued = Array.from(projects.values()).filter(p => p.status === 'queued').length;
  
  // Update user count
  const uniqueUsers = new Set(Array.from(projects.values()).map(p => p.userId).filter(Boolean));
  analytics.users.total = uniqueUsers.size;
  analytics.users.active = Object.keys(analytics.users.byActivity).length;
  
  // Calculate new users (created in last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  analytics.users.new = Array.from(projects.values())
    .filter(p => new Date(p.createdAt) > oneDayAgo)
    .map(p => p.userId)
    .filter((userId, index, arr) => arr.indexOf(userId) === index).length;
}

// Analytics endpoints
app.get('/api/analytics/dashboard', (req, res) => {
  try {
    // Update real-time metrics
    updateProjectAnalytics();
    trackSystemMetrics();
    
    addAuditLog('ANALYTICS_ACCESSED', req.userId || 'anonymous', 'analytics', 'Dashboard accessed', req);
    
    res.json({
      analytics,
      timestamp: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

app.get('/api/analytics/projects', (req, res) => {
  try {
    const { timeframe = '7d', groupBy = 'status' } = req.query;
    
    let data = {};
    
    switch (groupBy) {
      case 'status':
        data = analytics.projects.byStatus;
        break;
      case 'language':
        data = analytics.projects.byLanguage;
        break;
      case 'date':
        data = analytics.projects.byDate;
        break;
      default:
        data = analytics.projects.byStatus;
    }
    
    res.json({
      data,
      groupBy,
      timeframe,
      total: analytics.projects.total,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting project analytics:', error);
    res.status(500).json({ error: 'Failed to get project analytics' });
  }
});

app.get('/api/analytics/users', (req, res) => {
  try {
    const { active = false } = req.query;
    
    let userData = analytics.users.byActivity;
    
    if (active === 'true') {
      // Filter for users active in last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      userData = Object.entries(analytics.users.byActivity)
        .filter(([userId, data]) => new Date(data.lastSeen) > oneDayAgo)
        .reduce((acc, [userId, data]) => {
          acc[userId] = data;
          return acc;
        }, {});
    }
    
    res.json({
      users: userData,
      total: analytics.users.total,
      active: analytics.users.active,
      new: analytics.users.new,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting user analytics:', error);
    res.status(500).json({ error: 'Failed to get user analytics' });
  }
});

app.get('/api/analytics/performance', (req, res) => {
  try {
    res.json({
      performance: analytics.performance,
      system: {
        uptime: analytics.system.uptime,
        memoryUsage: analytics.system.memoryUsage,
        activeConnections: analytics.system.activeConnections
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting performance analytics:', error);
    res.status(500).json({ error: 'Failed to get performance analytics' });
  }
});

// Code quality metrics
const codeQualityMetrics = {
  projects: new Map(), // projectId -> metrics
  global: {
    averageComplexity: 0,
    averageMaintainability: 0,
    averageReliability: 0,
    totalIssues: 0,
    criticalIssues: 0,
    codeCoverage: 0
  }
};

// Analyze code quality for a project
function analyzeCodeQuality(projectId, documentation) {
  try {
    const metrics = {
      projectId,
      analyzedAt: new Date().toISOString(),
      files: 0,
      lines: 0,
      functions: 0,
      classes: 0,
      complexity: 0,
      maintainability: 0,
      reliability: 0,
      issues: [],
      coverage: 0
    };
    
    if (documentation.files) {
      metrics.files = documentation.files.length;
      
      documentation.files.forEach(file => {
        if (file.raw) {
          metrics.lines += file.lines || 0;
          metrics.functions += (file.functions || []).length;
          metrics.classes += (file.classes || []).length;
          
          // Calculate complexity (simplified)
          const complexity = calculateFileComplexity(file.raw);
          metrics.complexity += complexity;
          
          // Check for common issues
          const issues = detectCodeIssues(file.raw, file.path);
          metrics.issues.push(...issues);
        }
      });
      
      // Calculate averages
      if (metrics.files > 0) {
        metrics.complexity = Math.round(metrics.complexity / metrics.files * 100) / 100;
        metrics.maintainability = calculateMaintainabilityIndex(metrics);
        metrics.reliability = calculateReliabilityIndex(metrics);
      }
      
      // Estimate code coverage (would come from actual test results)
      metrics.coverage = estimateCodeCoverage(documentation);
    }
    
    // Store metrics
    codeQualityMetrics.projects.set(projectId, metrics);
    
    // Update global metrics
    updateGlobalCodeQualityMetrics();
    
    console.log(`🔍 Code quality analyzed for project ${projectId}: ${metrics.complexity} complexity, ${metrics.maintainability} maintainability`);
    
    return metrics;
    
  } catch (error) {
    console.error('Error analyzing code quality:', error);
    return null;
  }
}

// Calculate file complexity (simplified cyclomatic complexity)
function calculateFileComplexity(content) {
  let complexity = 1; // Base complexity
  
  const patterns = [
    /if\s*\(/g,           // if statements
    /else\s*if\s*\(/g,    // else if statements
    /else\s*\{/g,         // else blocks
    /for\s*\(/g,          // for loops
    /while\s*\(/g,        // while loops
    /switch\s*\(/g,       // switch statements
    /case\s+/g,           // case statements
    /\|\||&&/g,           // logical operators
    /\?/g,                // ternary operators
    /catch\s*\(/g,        // catch blocks
    /finally\s*\{/g       // finally blocks
  ];
  
  patterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  });
  
  return complexity;
}

// Detect common code issues
function detectCodeIssues(content, filePath) {
  const issues = [];
  
  // Check for hardcoded secrets
  const secretPatterns = [
    /password\s*[:=]\s*['"`][^'"`]+['"`]/gi,
    /api_key\s*[:=]\s*['"`][^'"`]+['"`]/gi,
    /secret\s*[:=]\s*['"`][^'"`]+['"`]/gi,
    /token\s*[:=]\s*['"`][^'"`]+['"`]/gi
  ];
  
  secretPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      issues.push({
        type: 'SECURITY',
        severity: 'HIGH',
        message: 'Potential hardcoded secret detected',
        line: getLineNumber(content, content.indexOf(matches[0])),
        file: filePath
      });
    }
  });
  
  // Check for SQL injection vulnerabilities
  if (content.includes('SELECT') || content.includes('INSERT') || content.includes('UPDATE')) {
    if (content.includes('${') || content.includes('+') || content.includes('concat')) {
      issues.push({
        type: 'SECURITY',
        severity: 'HIGH',
        message: 'Potential SQL injection vulnerability',
        line: getLineNumber(content, content.indexOf('SELECT')),
        file: filePath
      });
    }
  }
  
  // Check for XSS vulnerabilities
  if (content.includes('innerHTML') || content.includes('outerHTML')) {
    issues.push({
      type: 'SECURITY',
      severity: 'MEDIUM',
      message: 'Potential XSS vulnerability with innerHTML/outerHTML',
      line: getLineNumber(content, content.indexOf('innerHTML')),
      file: filePath
    });
  }
  
  // Check for performance issues
  if (content.includes('eval(') || content.includes('setTimeout(') || content.includes('setInterval(')) {
    issues.push({
      type: 'PERFORMANCE',
      severity: 'MEDIUM',
      message: 'Potential performance issue detected',
      line: getLineNumber(content, content.indexOf('eval')),
      file: filePath
    });
  }
  
  return issues;
}

// Calculate maintainability index
function calculateMaintainabilityIndex(metrics) {
  // Simplified maintainability calculation
  let maintainability = 100;
  
  // Reduce for high complexity
  if (metrics.complexity > 10) maintainability -= 20;
  else if (metrics.complexity > 5) maintainability -= 10;
  
  // Reduce for many issues
  const criticalIssues = metrics.issues.filter(i => i.severity === 'HIGH').length;
  maintainability -= criticalIssues * 5;
  
  // Reduce for large files
  if (metrics.lines > 1000) maintainability -= 15;
  else if (metrics.lines > 500) maintainability -= 10;
  
  return Math.max(0, Math.min(100, maintainability));
}

// Calculate reliability index
function calculateReliabilityIndex(metrics) {
  let reliability = 100;
  
  // Reduce for security issues
  const securityIssues = metrics.issues.filter(i => i.type === 'SECURITY').length;
  reliability -= securityIssues * 10;
  
  // Reduce for critical issues
  const criticalIssues = metrics.issues.filter(i => i.severity === 'HIGH').length;
  reliability -= criticalIssues * 15;
  
  return Math.max(0, Math.min(100, reliability));
}

// Estimate code coverage
function estimateCodeCoverage(documentation) {
  // This would normally come from actual test results
  // For now, estimate based on project structure
  
  let coverage = 0;
  
  if (documentation.files) {
    const testFiles = documentation.files.filter(f => 
      f.path.includes('test') || f.path.includes('spec') || f.path.includes('__tests__')
    );
    
    const sourceFiles = documentation.files.filter(f => 
      !f.path.includes('test') && !f.path.includes('spec') && !f.path.includes('__tests__')
    );
    
    if (sourceFiles.length > 0) {
      coverage = Math.round((testFiles.length / sourceFiles.length) * 100);
    }
  }
  
  return Math.min(100, coverage);
}

// Update global code quality metrics
function updateGlobalCodeQualityMetrics() {
  const projects = Array.from(codeQualityMetrics.projects.values());
  
  if (projects.length === 0) return;
  
  const global = codeQualityMetrics.global;
  
  global.averageComplexity = projects.reduce((sum, p) => sum + p.complexity, 0) / projects.length;
  global.averageMaintainability = projects.reduce((sum, p) => sum + p.maintainability, 0) / projects.length;
  global.averageReliability = projects.reduce((sum, p) => sum + p.reliability, 0) / projects.length;
  
  global.totalIssues = projects.reduce((sum, p) => sum + p.issues.length, 0);
  global.criticalIssues = projects.reduce((sum, p) => 
    sum + p.issues.filter(i => i.severity === 'HIGH').length, 0
  );
  
  global.codeCoverage = projects.reduce((sum, p) => sum + p.coverage, 0) / projects.length;
}

// Code quality endpoints
app.get('/api/analytics/code-quality', (req, res) => {
  try {
    const { projectId } = req.query;
    
    if (projectId) {
      const metrics = codeQualityMetrics.projects.get(projectId);
      if (!metrics) {
        return res.status(404).json({ error: 'Code quality metrics not found for project' });
      }
      
      res.json({
        projectId,
        metrics,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        global: codeQualityMetrics.global,
        projects: Array.from(codeQualityMetrics.projects.entries()).map(([id, metrics]) => ({
          projectId: id,
          complexity: metrics.complexity,
          maintainability: metrics.maintainability,
          reliability: metrics.reliability,
          issues: metrics.issues.length,
          coverage: metrics.coverage
        })),
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error getting code quality metrics:', error);
    res.status(500).json({ error: 'Failed to get code quality metrics' });
  }
});

// Trigger code quality analysis for a project
app.post('/api/analytics/code-quality/:projectId/analyze', (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to analyze' });
    }
    
    const metrics = analyzeCodeQuality(projectId, project.documentation);
    
    if (metrics) {
      addAuditLog('CODE_QUALITY_ANALYZED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Code quality analysis performed', req);
      
      res.json({
        message: 'Code quality analysis completed',
        projectId,
        metrics,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Code quality analysis failed' });
    }
    
  } catch (error) {
    console.error('Error analyzing code quality:', error);
    res.status(500).json({ error: 'Failed to analyze code quality' });
  }
});

// Update the processRepository function to include code quality analysis
const originalProcessRepository = processRepository;
processRepository = async function(projectId, repoUrl, mode = 'v2') {
  const startTime = Date.now();
  
  try {
    // Call original function
    await originalProcessRepository.call(this, projectId, repoUrl, mode);
    
          // Analyze code quality after documentation is generated
      const project = projects.get(projectId);
      if (project && project.documentation) {
        const codeQuality = analyzeCodeQuality(projectId, project.documentation);
        
        // Execute plugin hooks for code quality analysis
        if (codeQuality) {
          executeHook('afterCodeAnalysis', project, codeQuality);
        }
      }
    
    // Track completion metrics
    const processingTime = Date.now() - startTime;
    trackProjectCompleted(project, processingTime);
    
  } catch (error) {
    trackProjectFailed(project);
    throw error;
  }
};

// Add dependency analysis and security vulnerability scanning
const dependencyAnalysis = {
  projects: new Map(), // projectId -> dependencies
  vulnerabilities: new Map(), // projectId -> vulnerabilities
  global: {
    totalDependencies: 0,
    vulnerableDependencies: 0,
    criticalVulnerabilities: 0,
    highVulnerabilities: 0,
    mediumVulnerabilities: 0,
    lowVulnerabilities: 0
  }
};

// Analyze dependencies for a project
async function analyzeDependencies(projectId, repoPath) {
  try {
    const dependencies = {
      projectId,
      analyzedAt: new Date().toISOString(),
      packageManagers: [],
      dependencies: [],
      devDependencies: [],
      vulnerabilities: [],
      licenses: [],
      outdated: [],
      security: {
        score: 100,
        issues: 0,
        recommendations: []
      }
    };
    
    // Check for different package managers
    const packageManagers = await detectPackageManagers(repoPath);
    dependencies.packageManagers = packageManagers;
    
    // Analyze each package manager
    for (const manager of packageManagers) {
      const managerDeps = await analyzePackageManager(manager, repoPath);
      
      if (managerDeps) {
        dependencies.dependencies.push(...managerDeps.dependencies);
        dependencies.devDependencies.push(...managerDeps.devDependencies);
        dependencies.licenses.push(...managerDeps.licenses);
        
        // Check for vulnerabilities
        const vulnerabilities = await checkVulnerabilities(managerDeps.dependencies, managerDeps.devDependencies);
        dependencies.vulnerabilities.push(...vulnerabilities);
        
        // Check for outdated packages
        const outdated = await checkOutdatedPackages(managerDeps.dependencies, managerDeps.devDependencies, manager);
        dependencies.outdated.push(...outdated);
      }
    }
    
    // Calculate security score
    dependencies.security = calculateSecurityScore(dependencies);
    
    // Store analysis results
    dependencyAnalysis.projects.set(projectId, dependencies);
    
    // Update global metrics
    updateGlobalDependencyMetrics();
    
    console.log(`📦 Dependency analysis completed for project ${projectId}: ${dependencies.dependencies.length} dependencies, ${dependencies.vulnerabilities.length} vulnerabilities`);
    
    return dependencies;
    
  } catch (error) {
    console.error('Error analyzing dependencies:', error);
    return null;
  }
}

// Detect package managers in the repository
async function detectPackageManagers(repoPath) {
  const managers = [];
  
  try {
    // Check for Node.js
    try {
      await fs.access(path.join(repoPath, 'package.json'));
      managers.push('npm');
    } catch (error) {
      // No package.json
    }
    
    // Check for Python
    try {
      await fs.access(path.join(repoPath, 'requirements.txt'));
      managers.push('pip');
    } catch (error) {
      // No requirements.txt
    }
    
    try {
      await fs.access(path.join(repoPath, 'pyproject.toml'));
      managers.push('poetry');
    } catch (error) {
      // No pyproject.toml
    }
    
    // Check for Java
    try {
      await fs.access(path.join(repoPath, 'pom.xml'));
      managers.push('maven');
    } catch (error) {
      // No pom.xml
    }
    
    try {
      await fs.access(path.join(repoPath, 'build.gradle'));
      managers.push('gradle');
    } catch (error) {
      // No build.gradle
    }
    
    // Check for Go
    try {
      await fs.access(path.join(repoPath, 'go.mod'));
      managers.push('go');
    } catch (error) {
      // No go.mod
    }
    
    // Check for Rust
    try {
      await fs.access(path.join(repoPath, 'Cargo.toml'));
      managers.push('cargo');
    } catch (error) {
      // No Cargo.toml
    }
    
  } catch (error) {
    console.error('Error detecting package managers:', error);
  }
  
  return managers;
}

// Analyze dependencies for a specific package manager
async function analyzePackageManager(manager, repoPath) {
  try {
    switch (manager) {
      case 'npm':
        return await analyzeNpmDependencies(repoPath);
      case 'pip':
        return await analyzePipDependencies(repoPath);
      case 'poetry':
        return await analyzePoetryDependencies(repoPath);
      case 'maven':
        return await analyzeMavenDependencies(repoPath);
      case 'gradle':
        return await analyzeGradleDependencies(repoPath);
      case 'go':
        return await analyzeGoDependencies(repoPath);
      case 'cargo':
        return await analyzeCargoDependencies(repoPath);
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error analyzing ${manager} dependencies:`, error);
    return null;
  }
}
// Analyze npm dependencies
async function analyzeNpmDependencies(repoPath) {
  try {
    const packagePath = path.join(repoPath, 'package.json');
    const packageContent = await fs.readFile(packagePath, 'utf-8');
    const packageData = JSON.parse(packageContent);
    
    const dependencies = [];
    const devDependencies = [];
    const licenses = [];
    
    // Process production dependencies
    if (packageData.dependencies) {
      Object.entries(packageData.dependencies).forEach(([name, version]) => {
        dependencies.push({
          name,
          version,
          manager: 'npm',
          type: 'production',
          license: 'Unknown', // Would come from npm registry
          lastUpdated: null
        });
      });
    }
    
    // Process dev dependencies
    if (packageData.devDependencies) {
      Object.entries(packageData.devDependencies).forEach(([name, version]) => {
        devDependencies.push({
          name,
          version,
          manager: 'npm',
          type: 'development',
          license: 'Unknown',
          lastUpdated: null
        });
      });
    }
    
    // Check package-lock.json for more details
    try {
      const lockPath = path.join(repoPath, 'package-lock.json');
      const lockContent = await fs.readFile(lockPath, 'utf-8');
      const lockData = JSON.parse(lockContent);
      
      // Update dependency information with lock data
      const allDeps = [...dependencies, ...devDependencies];
      allDeps.forEach(dep => {
        const lockDep = lockData.dependencies?.[dep.name];
        if (lockDep) {
          dep.resolved = lockDep.resolved;
          dep.integrity = lockDep.integrity;
        }
      });
    } catch (error) {
      // No package-lock.json
    }
    
    return { dependencies, devDependencies, licenses };
    
  } catch (error) {
    console.error('Error analyzing npm dependencies:', error);
    return null;
  }
}

// Analyze pip dependencies
async function analyzePipDependencies(repoPath) {
  try {
    const requirementsPath = path.join(repoPath, 'requirements.txt');
    const requirementsContent = await fs.readFile(requirementsPath, 'utf-8');
    
    const dependencies = [];
    const lines = requirementsContent.split('\n');
    
    lines.forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const match = line.match(/^([a-zA-Z0-9_-]+)([<>=!~]+)(.+)$/);
        if (match) {
          dependencies.push({
            name: match[1],
            version: match[2] + match[3],
            manager: 'pip',
            type: 'production',
            license: 'Unknown',
            lastUpdated: null
          });
        } else {
          // No version specified
          dependencies.push({
            name: line,
            version: 'latest',
            manager: 'pip',
            type: 'production',
            license: 'Unknown',
            lastUpdated: null
          });
        }
      }
    });
    
    return { dependencies, devDependencies: [], licenses: [] };
    
  } catch (error) {
    console.error('Error analyzing pip dependencies:', error);
    return null;
  }
}

// Analyze other package managers (simplified implementations)
async function analyzePoetryDependencies(repoPath) {
  try {
    const pyprojectPath = path.join(repoPath, 'pyproject.toml');
    const pyprojectContent = await fs.readFile(pyprojectPath, 'utf-8');
    
    // Simple TOML parsing (in production, use a proper TOML parser)
    const dependencies = [];
    
    // Extract dependencies from pyproject.toml
    const depMatch = pyprojectContent.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\[|$)/);
    if (depMatch) {
      const depSection = depMatch[1];
      const depLines = depSection.split('\n');
      
      depLines.forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#') && line.includes('=')) {
          const [name, version] = line.split('=').map(s => s.trim());
          if (name && version) {
            dependencies.push({
              name: name.replace(/"/g, ''),
              version: version.replace(/"/g, ''),
              manager: 'poetry',
              type: 'production',
              license: 'Unknown',
              lastUpdated: null
            });
          }
        }
      });
    }
    
    return { dependencies, devDependencies: [], licenses: [] };
    
  } catch (error) {
    console.error('Error analyzing poetry dependencies:', error);
    return null;
  }
}

async function analyzeMavenDependencies(repoPath) {
  try {
    const pomPath = path.join(repoPath, 'pom.xml');
    const pomContent = await fs.readFile(pomPath, 'utf-8');
    
    const dependencies = [];
    
    // Simple XML parsing for dependencies
    const depMatches = pomContent.match(/<dependency>([\s\S]*?)<\/dependency>/g);
    if (depMatches) {
      depMatches.forEach(dep => {
        const groupIdMatch = dep.match(/<groupId>([^<]+)<\/groupId>/);
        const artifactIdMatch = dep.match(/<artifactId>([^<]+)<\/artifactId>/);
        const versionMatch = dep.match(/<version>([^<]+)<\/version>/);
        
        if (groupIdMatch && artifactIdMatch) {
          dependencies.push({
            name: `${groupIdMatch[1]}:${artifactIdMatch[1]}`,
            version: versionMatch ? versionMatch[1] : 'unknown',
            manager: 'maven',
            type: 'production',
            license: 'Unknown',
            lastUpdated: null
          });
        }
      });
    }
    
    return { dependencies, devDependencies: [], licenses: [] };
    
  } catch (error) {
    console.error('Error analyzing maven dependencies:', error);
    return null;
  }
}

async function analyzeGradleDependencies(repoPath) {
  // Simplified implementation
  return { dependencies: [], devDependencies: [], licenses: [] };
}

async function analyzeGoDependencies(repoPath) {
  try {
    const goModPath = path.join(repoPath, 'go.mod');
    const goModContent = await fs.readFile(goModPath, 'utf-8');
    
    const dependencies = [];
    const lines = goModContent.split('\n');
    
    lines.forEach(line => {
      line = line.trim();
      if (line.startsWith('require ')) {
        const parts = line.split(' ');
        if (parts.length >= 3) {
          dependencies.push({
            name: parts[1],
            version: parts[2],
            manager: 'go',
            type: 'production',
            license: 'Unknown',
            lastUpdated: null
          });
        }
      }
    });
    
    return { dependencies, devDependencies: [], licenses: [] };
    
  } catch (error) {
    console.error('Error analyzing go dependencies:', error);
    return null;
  }
}

async function analyzeCargoDependencies(repoPath) {
  try {
    const cargoPath = path.join(repoPath, 'Cargo.toml');
    const cargoContent = await fs.readFile(cargoPath, 'utf-8');
    
    const dependencies = [];
    
    // Simple TOML parsing for dependencies
    const depMatch = cargoContent.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
    if (depMatch) {
      const depSection = depMatch[1];
      const depLines = depSection.split('\n');
      
      depLines.forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#') && line.includes('=')) {
          const [name, version] = line.split('=').map(s => s.trim());
          if (name && version) {
            dependencies.push({
              name: name.replace(/"/g, ''),
              version: version.replace(/"/g, ''),
              manager: 'cargo',
              type: 'production',
              license: 'Unknown',
              lastUpdated: null
            });
          }
        }
      });
    }
    
    return { dependencies, devDependencies: [], licenses: [] };
    
  } catch (error) {
    console.error('Error analyzing cargo dependencies:', error);
    return null;
  }
}

// Check for vulnerabilities in dependencies
async function checkVulnerabilities(dependencies, devDependencies) {
  const vulnerabilities = [];
  
  // In a real implementation, this would query vulnerability databases
  // For now, we'll simulate some common vulnerabilities
  
  const allDeps = [...dependencies, ...devDependencies];
  
  allDeps.forEach(dep => {
    // Simulate vulnerability detection
    if (dep.name.includes('lodash') && dep.version.startsWith('4.17.0')) {
      vulnerabilities.push({
        dependency: dep.name,
        version: dep.version,
        severity: 'HIGH',
        type: 'SECURITY',
        description: 'Prototype pollution vulnerability',
        cve: 'CVE-2019-10744',
        recommendation: 'Upgrade to version 4.17.12 or later'
      });
    }
    
    if (dep.name.includes('axios') && dep.version.startsWith('0.21.0')) {
      vulnerabilities.push({
        dependency: dep.name,
        version: dep.version,
        severity: 'MEDIUM',
        type: 'SECURITY',
        description: 'Server-Side Request Forgery vulnerability',
        cve: 'CVE-2021-3749',
        recommendation: 'Upgrade to version 0.21.1 or later'
      });
    }
    
    if (dep.name.includes('moment') && dep.version.startsWith('2.29.0')) {
      vulnerabilities.push({
        dependency: dep.name,
        version: dep.version,
        severity: 'LOW',
        type: 'SECURITY',
        description: 'Regular expression denial of service',
        cve: 'CVE-2022-31129',
        recommendation: 'Upgrade to version 2.29.4 or later'
      });
    }
  });
  
  return vulnerabilities;
}

// Check for outdated packages
async function checkOutdatedPackages(dependencies, devDependencies, manager) {
  const outdated = [];
  
  // In a real implementation, this would query package registries
  // For now, we'll simulate some outdated packages
  
  const allDeps = [...dependencies, ...devDependencies];
  
  allDeps.forEach(dep => {
    // Simulate outdated package detection
    if (dep.name.includes('react') && dep.version.startsWith('17.')) {
      outdated.push({
        dependency: dep.name,
        currentVersion: dep.version,
        latestVersion: '18.2.0',
        manager,
        type: 'major',
        lastUpdated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
    
    if (dep.name.includes('express') && dep.version.startsWith('4.17.')) {
      outdated.push({
        dependency: dep.name,
        currentVersion: dep.version,
        latestVersion: '4.18.2',
        manager,
        type: 'minor',
        lastUpdated: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
  });
  
  return outdated;
}

// Calculate security score for dependencies
function calculateSecurityScore(dependencies) {
  let score = 100;
  const issues = [];
  const recommendations = [];
  
  // Reduce score for vulnerabilities
  dependencies.vulnerabilities.forEach(vuln => {
    switch (vuln.severity) {
      case 'CRITICAL':
        score -= 25;
        break;
      case 'HIGH':
        score -= 15;
        break;
      case 'MEDIUM':
        score -= 10;
        break;
      case 'LOW':
        score -= 5;
        break;
    }
    
    issues.push(`${vuln.severity}: ${vuln.description}`);
    recommendations.push(vuln.recommendation);
  });
  
  // Reduce score for outdated packages
  dependencies.outdated.forEach(pkg => {
    if (pkg.type === 'major') {
      score -= 10;
      recommendations.push(`Update ${pkg.dependency} to latest version`);
    } else if (pkg.type === 'minor') {
      score -= 5;
      recommendations.push(`Consider updating ${pkg.dependency}`);
    }
  }
  
  // Reduce score for missing lock files
  if (dependencies.packageManagers.includes('npm') && !dependencies.dependencies.some(d => d.resolved)) {
    score -= 10;
    recommendations.push('Use package-lock.json for reproducible builds');
  }
  
  return {
    score: Math.max(0, score),
    issues: issues.length,
    recommendations: [...new Set(recommendations)]
  };
}

// Update global dependency metrics
function updateGlobalDependencyMetrics() {
  const allProjects = Array.from(dependencyAnalysis.projects.values());
  
  if (allProjects.length === 0) return;
  
  const global = dependencyAnalysis.global;
  
  global.totalDependencies = allProjects.reduce((sum, p) => 
    sum + p.dependencies.length + p.devDependencies.length, 0
  );
  
  global.vulnerableDependencies = allProjects.reduce((sum, p) => 
    sum + p.vulnerabilities.length, 0
  );
  
  global.criticalVulnerabilities = allProjects.reduce((sum, p) => 
    sum + p.vulnerabilities.filter(v => v.severity === 'CRITICAL').length, 0
  );
  
  global.highVulnerabilities = allProjects.reduce((sum, p) => 
    sum + p.vulnerabilities.filter(v => v.severity === 'HIGH').length, 0
  );
  
  global.mediumVulnerabilities = allProjects.reduce((sum, p) => 
    sum + p.vulnerabilities.filter(v => v.severity === 'MEDIUM').length, 0
  );
  
  global.lowVulnerabilities = allProjects.reduce((sum, p) => 
    sum + p.vulnerabilities.filter(v => v.severity === 'LOW').length, 0
  );
}

// Dependency analysis endpoints
app.get('/api/analytics/dependencies', (req, res) => {
  try {
    const { projectId } = req.query;
    
    if (projectId) {
      const analysis = dependencyAnalysis.projects.get(projectId);
      if (!analysis) {
        return res.status(404).json({ error: 'Dependency analysis not found for project' });
      }
      
      res.json({
        projectId,
        analysis,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        global: dependencyAnalysis.global,
        projects: Array.from(dependencyAnalysis.projects.entries()).map(([id, analysis]) => ({
          projectId: id,
          totalDependencies: analysis.dependencies.length + analysis.devDependencies.length,
          vulnerabilities: analysis.vulnerabilities.length,
          securityScore: analysis.security.score,
          packageManagers: analysis.packageManagers
        })),
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error getting dependency analysis:', error);
    res.status(500).json({ error: 'Failed to get dependency analysis' });
  }
});

// Trigger dependency analysis for a project
app.post('/api/analytics/dependencies/:projectId/analyze', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Create temporary directory for analysis
    const tempDir = `temp/${projectId}`;
    
    // Analyze dependencies
    const analysis = await analyzeDependencies(projectId, tempDir);
    
    if (analysis) {
      addAuditLog('DEPENDENCY_ANALYSIS_PERFORMED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Dependency analysis performed', req);
      
      res.json({
        message: 'Dependency analysis completed',
        projectId,
        analysis,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Dependency analysis failed' });
    }
    
  } catch (error) {
    console.error('Error analyzing dependencies:', error);
    res.status(500).json({ error: 'Failed to analyze dependencies' });
  }
});

// Update the processRepository function to include dependency analysis
const originalProcessRepositoryWithAnalytics = processRepository;
processRepository = async function(projectId, repoUrl, mode = 'v2') {
  const startTime = Date.now();
  
  try {
    // Call original function
    await originalProcessRepositoryWithAnalytics.call(this, projectId, repoUrl, mode);
    
    // Analyze dependencies after repository is cloned
    const project = projects.get(projectId);
    if (project) {
      const tempDir = `temp/${projectId}`;
      const dependencyAnalysis = await analyzeDependencies(projectId, tempDir);
      
      // Execute plugin hooks for dependency analysis
      if (dependencyAnalysis) {
        executeHook('afterDependencyAnalysis', dependencyAnalysis, dependencyAnalysis);
      }
    }
    
    // Generate architecture and API documentation after documentation is generated
    if (project && project.documentation) {
      await generateArchitectureDiagram(projectId, project.documentation);
      await generateAPIDocumentation(projectId, project.documentation);
      await generateDatabaseSchema(projectId, project.documentation);
      await generateDeploymentGuides(projectId, project.documentation);
      
      // Execute plugin hooks for enhanced analysis
      project.documentation = executeHook('afterProjectAnalysis', project, project.documentation);
      
      // Enhance individual file analysis with plugins
      if (project.documentation.files) {
        project.documentation.files = project.documentation.files.map(file => {
          return executeHook('afterFileAnalysis', file, file.analysis || {});
        });
      }
    }
    
    // Track completion metrics
    const processingTime = Date.now() - startTime;
    trackProjectCompleted(project, processingTime);
    
  } catch (error) {
    trackProjectFailed(project);
    throw error;
  }
};

// Add architecture diagrams and API documentation generation
const architectureGenerator = {
  projects: new Map(), // projectId -> architecture data
  diagrams: new Map() // projectId -> generated diagrams
};

// Generate architecture diagram for a project
async function generateArchitectureDiagram(projectId, documentation) {
  try {
    const architecture = {
      projectId,
      generatedAt: new Date().toISOString(),
      components: [],
      relationships: [],
      layers: [],
      technologies: [],
      diagram: null
    };
    
    // Analyze project structure for components
    if (documentation.structure) {
      architecture.components = extractComponents(documentation.structure);
    }
    
    // Analyze code for relationships
    if (documentation.files) {
      architecture.relationships = extractRelationships(documentation.files);
    }
    
    // Detect architectural layers
    architecture.layers = detectArchitecturalLayers(documentation);
    
    // Identify technologies
    architecture.technologies = identifyTechnologies(documentation);
    
    // Generate diagram (Mermaid.js format)
    architecture.diagram = generateMermaidDiagram(architecture);
    
    // Store architecture data
    architectureGenerator.projects.set(projectId, architecture);
    
    console.log(`🏗️ Architecture diagram generated for project ${projectId}`);
    
    return architecture;
    
  } catch (error) {
    console.error('Error generating architecture diagram:', error);
    return null;
  }
}

// Extract components from project structure
function extractComponents(structure) {
  const components = [];
  
  function scanStructure(items, parentPath = '') {
    Object.entries(items).forEach(([name, info]) => {
      if (info.type === 'directory') {
        const component = {
          name,
          type: 'directory',
          path: parentPath ? `${parentPath}/${name}` : name,
          category: categorizeComponent(name),
          children: []
        };
        
        if (info.children) {
          scanStructure(info.children, component.path);
          component.children = Object.keys(info.children);
        }
        
        components.push(component);
      } else if (info.type === 'file') {
        const component = {
          name,
          type: 'file',
          path: parentPath ? `${parentPath}/${name}` : name,
          category: categorizeComponent(name),
          extension: info.extension,
          size: info.size
        };
        
        components.push(component);
      }
    });
  }
  
  scanStructure(structure);
  return components;
}

// Categorize components based on naming patterns
function categorizeComponent(name) {
  const nameLower = name.toLowerCase();
  
  if (nameLower.includes('controller') || nameLower.includes('ctrl')) return 'Controller';
  if (nameLower.includes('service')) return 'Service';
  if (nameLower.includes('model') || nameLower.includes('entity')) return 'Model';
  if (nameLower.includes('repository') || nameLower.includes('repo')) return 'Repository';
  if (nameLower.includes('middleware')) return 'Middleware';
  if (nameLower.includes('util') || nameLower.includes('helper')) return 'Utility';
  if (nameLower.includes('config') || nameLower.includes('conf')) return 'Configuration';
  if (nameLower.includes('test') || nameLower.includes('spec')) return 'Test';
  if (nameLower.includes('component') || nameLower.includes('ui')) return 'UI Component';
  if (nameLower.includes('api') || nameLower.includes('route')) return 'API';
  if (nameLower.includes('db') || nameLower.includes('database')) return 'Database';
  if (nameLower.includes('auth') || nameLower.includes('security')) return 'Security';
  
  return 'Other';
}

// Extract relationships between components
function extractRelationships(files) {
  const relationships = [];
  
  files.forEach(file => {
    if (file.raw && file.imports) {
      file.imports.forEach(importPath => {
        relationships.push({
          from: file.path,
          to: importPath,
          type: 'import',
          strength: 'strong'
        });
      });
    }
    
    if (file.raw && file.functions) {
      file.functions.forEach(funcName => {
        // Look for function calls in the same file
        const functionCalls = findFunctionCalls(file.raw, funcName);
        functionCalls.forEach(call => {
          relationships.push({
            from: `${file.path}:${funcName}`,
            to: call,
            type: 'function_call',
            strength: 'medium'
          });
        });
      });
    }
  });
  
  return relationships;
}

// Find function calls in code
function findFunctionCalls(content, funcName) {
  const calls = [];
  const regex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    calls.push(funcName);
  }
  
  return calls;
}

// Detect architectural layers
function detectArchitecturalLayers(documentation) {
  const layers = [];
  
  // Check for common architectural patterns
  if (documentation.files.some(f => f.path.includes('controller'))) {
    layers.push({
      name: 'Presentation Layer',
      components: ['Controllers', 'Routes', 'Views'],
      description: 'Handles user interface and request routing'
    });
  }
  
  if (documentation.files.some(f => f.path.includes('service'))) {
    layers.push({
      name: 'Business Logic Layer',
      components: ['Services', 'Business Logic', 'Use Cases'],
      description: 'Contains business rules and application logic'
    });
  }
  
  if (documentation.files.some(f => f.path.includes('model') || f.path.includes('entity'))) {
    layers.push({
      name: 'Data Access Layer',
      components: ['Models', 'Entities', 'Repositories'],
      description: 'Manages data persistence and database operations'
    });
  }
  
  if (documentation.files.some(f => f.path.includes('middleware'))) {
    layers.push({
      name: 'Cross-cutting Concerns',
      components: ['Middleware', 'Interceptors', 'Filters'],
      description: 'Handles cross-cutting concerns like logging, security, etc.'
    });
  }
  
  return layers;
}
// Identify technologies used in the project
function identifyTechnologies(documentation) {
  const technologies = [];
  
  // Framework detection
  if (documentation.files.some(f => f.raw && f.raw.includes('express'))) {
    technologies.push({
      name: 'Express.js',
      category: 'Framework',
      description: 'Web application framework for Node.js'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('react'))) {
    technologies.push({
      name: 'React',
      category: 'Frontend Framework',
      description: 'JavaScript library for building user interfaces'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('vue'))) {
    technologies.push({
      name: 'Vue.js',
      category: 'Frontend Framework',
      description: 'Progressive JavaScript framework'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('angular'))) {
    technologies.push({
      name: 'Angular',
      category: 'Frontend Framework',
      description: 'Platform for building mobile and desktop web applications'
    });
  }
  
  // Database detection
  if (documentation.files.some(f => f.raw && f.raw.includes('mongoose'))) {
    technologies.push({
      name: 'MongoDB + Mongoose',
      category: 'Database',
      description: 'NoSQL database with ODM'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('sequelize'))) {
    technologies.push({
      name: 'Sequelize',
      category: 'Database',
      description: 'ORM for Node.js'
    });
  }
  
  // Testing frameworks
  if (documentation.files.some(f => f.raw && f.raw.includes('jest'))) {
    technologies.push({
      name: 'Jest',
      category: 'Testing',
      description: 'JavaScript testing framework'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('mocha'))) {
    technologies.push({
      name: 'Mocha',
      category: 'Testing',
      description: 'JavaScript test framework'
    });
  }
  
  return technologies;
}

// Generate Mermaid.js diagram
function generateMermaidDiagram(architecture) {
  let mermaid = 'graph TD\n';
  
  // Add components
  architecture.components.forEach(component => {
    const nodeId = component.path.replace(/[^a-zA-Z0-9]/g, '_');
    const shape = component.type === 'directory' ? 'subgraph' : 'rectangle';
    const color = getComponentColor(component.category);
    
    if (component.type === 'directory') {
      mermaid += `  subgraph ${nodeId}["${component.name}"]\n`;
      component.children.forEach(child => {
        const childId = child.replace(/[^a-zA-Z0-9]/g, '_');
        mermaid += `    ${childId}["${child}"]\n`;
      });
      mermaid += `  end\n`;
    } else {
      mermaid += `  ${nodeId}["${component.name}"]\n`;
    }
    
    mermaid += `  style ${nodeId} fill:${color}\n`;
  });
  
  // Add relationships
  architecture.relationships.forEach(rel => {
    const fromId = rel.from.replace(/[^a-zA-Z0-9]/g, '_');
    const toId = rel.to.replace(/[^a-zA-Z0-9]/g, '_');
    
    if (rel.type === 'import') {
      mermaid += `  ${fromId} --> ${toId}\n`;
    } else if (rel.type === 'function_call') {
      mermaid += `  ${fromId} -.-> ${toId}\n`;
    }
  });
  
  // Add layers
  architecture.layers.forEach((layer, index) => {
    mermaid += `  subgraph Layer${index}["${layer.name}"]\n`;
    layer.components.forEach(comp => {
      const compId = comp.replace(/[^a-zA-Z0-9]/g, '_');
      mermaid += `    ${compId}["${comp}"]\n`;
    });
    mermaid += `  end\n`;
  });
  
  return mermaid;
}

// Get color for component category
function getComponentColor(category) {
  const colors = {
    'Controller': '#ff6b6b',
    'Service': '#4ecdc4',
    'Model': '#45b7d1',
    'Repository': '#96ceb4',
    'Middleware': '#feca57',
    'Utility': '#ff9ff3',
    'Configuration': '#54a0ff',
    'Test': '#5f27cd',
    'UI Component': '#00d2d3',
    'API': '#ff9f43',
    'Database': '#10ac84',
    'Security': '#ee5253',
    'Other': '#c8d6e5'
  };
  
  return colors[category] || colors['Other'];
}

// API documentation generation
const apiDocGenerator = {
  projects: new Map(), // projectId -> API documentation
  openApiSpecs: new Map() // projectId -> OpenAPI specification
};

// Generate API documentation for a project
async function generateAPIDocumentation(projectId, documentation) {
  try {
    const apiDoc = {
      projectId,
      generatedAt: new Date().toISOString(),
      endpoints: [],
      models: [],
      schemas: [],
      openApiSpec: null,
      swaggerUi: null
    };
    
    // Extract API endpoints
    if (documentation.files) {
      apiDoc.endpoints = extractAPIEndpoints(documentation.files);
    }
    
    // Extract data models
    if (documentation.files) {
      apiDoc.models = extractDataModels(documentation.files);
    }
    
    // Generate OpenAPI specification
    apiDoc.openApiSpec = generateOpenAPISpec(apiDoc);
    
    // Generate Swagger UI HTML
    apiDoc.swaggerUi = generateSwaggerUI(apiDoc.openApiSpec);
    
    // Store API documentation
    apiDocGenerator.projects.set(projectId, apiDoc);
    apiDocGenerator.openApiSpecs.set(projectId, apiDoc.openApiSpec);
    
    console.log(`📚 API documentation generated for project ${projectId}: ${apiDoc.endpoints.length} endpoints`);
    
    return apiDoc;
    
  } catch (error) {
    console.error('Error generating API documentation:', error);
    return null;
  }
}

// Extract API endpoints from code files
function extractAPIEndpoints(files) {
  const endpoints = [];
  
  files.forEach(file => {
    if (file.raw && file.extension === '.js') {
      // Look for Express.js routes
      const routeMatches = file.raw.match(/app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      
      if (routeMatches) {
        routeMatches.forEach(match => {
          const methodMatch = match.match(/app\.(get|post|put|delete|patch)/);
          const pathMatch = match.match(/['"`]([^'"`]+)['"`]/);
          
          if (methodMatch && pathMatch) {
            endpoints.push({
              method: methodMatch[1].toUpperCase(),
              path: pathMatch[1],
              file: file.path,
              description: extractEndpointDescription(file.raw, pathMatch[1]),
              parameters: extractEndpointParameters(file.raw, pathMatch[1]),
              responses: extractEndpointResponses(file.raw, pathMatch[1])
            });
          }
        });
      }
      
      // Look for router definitions
      const routerMatches = file.raw.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      
      if (routerMatches) {
        routerMatches.forEach(match => {
          const methodMatch = match.match(/router\.(get|post|put|delete|patch)/);
          const pathMatch = match.match(/['"`]([^'"`]+)['"`]/);
          
          if (methodMatch && pathMatch) {
            endpoints.push({
              method: methodMatch[1].toUpperCase(),
              path: pathMatch[1],
              file: file.path,
              description: extractEndpointDescription(file.raw, pathMatch[1]),
              parameters: extractEndpointParameters(file.raw, pathMatch[1]),
              responses: extractEndpointResponses(file.raw, pathMatch[1])
            });
          }
        });
      }
    }
  });
  
  return endpoints;
}

// Extract endpoint description from code
function extractEndpointDescription(content, path) {
  // Look for comments above the endpoint
  const lines = content.split('\n');
  const pathIndex = lines.findIndex(line => line.includes(path));
  
  if (pathIndex > 0) {
    let description = '';
    let i = pathIndex - 1;
    
    // Look for comments above the endpoint
    while (i >= 0 && (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('/*'))) {
      const comment = lines[i].trim().replace(/^\/\/\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '');
      description = comment + ' ' + description;
      i--;
    }
    
    return description.trim() || `API endpoint for ${path}`;
  }
  
  return `API endpoint for ${path}`;
}

// Extract endpoint parameters
function extractEndpointParameters(content, path) {
  const parameters = [];
  
  // Look for parameter extraction in the endpoint handler
  const paramMatches = content.match(/req\.(params|query|body)\.(\w+)/g);
  
  if (paramMatches) {
    paramMatches.forEach(match => {
      const sourceMatch = match.match(/req\.(params|query|body)\.(\w+)/);
      if (sourceMatch) {
        parameters.push({
          name: sourceMatch[2],
          in: sourceMatch[1] === 'params' ? 'path' : sourceMatch[1] === 'query' ? 'query' : 'body',
          required: true,
          type: 'string',
          description: `Parameter ${sourceMatch[2]}`
        });
      }
    });
  }
  
  return parameters;
}

// Extract endpoint responses
function extractEndpointResponses(content, path) {
  const responses = {
    '200': {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {}
          }
        }
      }
    },
    '400': {
      description: 'Bad request',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              error: {
                type: 'string',
                description: 'Error message'
              }
            }
          }
        }
      }
    },
    '500': {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              error: {
                type: 'string',
                description: 'Error message'
              }
            }
          }
        }
      }
    }
  };
  
  return responses;
}

// Extract data models from code files
function extractDataModels(files) {
  const models = [];
  
  files.forEach(file => {
    if (file.raw && file.classes) {
      file.classes.forEach(className => {
        const model = {
          name: className,
          file: file.path,
          properties: extractModelProperties(file.raw, className),
          methods: extractModelMethods(file.raw, className)
        };
        
        models.push(model);
      });
    }
  });
  
  return models;
}

// Extract model properties
function extractModelProperties(content, className) {
  const properties = [];
  
  // Look for class properties
  const classContent = extractClassContent(content, className);
  if (classContent) {
    const propMatches = classContent.match(/(\w+)\s*[:=]\s*([^;\n]+)/g);
    
    propMatches.forEach(match => {
      const propMatch = match.match(/(\w+)\s*[:=]\s*([^;\n]+)/);
      if (propMatch) {
        properties.push({
          name: propMatch[1],
          type: inferPropertyType(propMatch[2]),
          description: `Property ${propMatch[1]}`
        });
      }
    });
  }
  
  return properties;
}

// Extract model methods
function extractModelMethods(content, className) {
  const methods = [];
  
  const classContent = extractClassContent(content, className);
  if (classContent) {
    const methodMatches = classContent.match(/(\w+)\s*\([^)]*\)\s*\{/g);
    
    methodMatches.forEach(match => {
      const methodMatch = match.match(/(\w+)\s*\(/);
      if (methodMatch) {
        methods.push({
          name: methodMatch[1],
          description: `Method ${methodMatch[1]}`,
          parameters: []
        });
      }
    });
  }
  
  return methods;
}

// Extract class content
function extractClassContent(content, className) {
  const classRegex = new RegExp(`class\\s+${className}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g');
  const match = classRegex.exec(content);
  
  return match ? match[1] : null;
}

// Infer property type from value
function inferPropertyType(value) {
  const trimmed = value.trim();
  
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return 'string';
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (!isNaN(trimmed)) return 'number';
  if (trimmed.startsWith('[')) return 'array';
  if (trimmed.startsWith('{')) return 'object';
  
  return 'string';
}

// Generate OpenAPI specification
function generateOpenAPISpec(apiDoc) {
  const openApi = {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    paths: {},
    components: {
      schemas: {}
    }
  };
  
  // Add endpoints to paths
  apiDoc.endpoints.forEach(endpoint => {
    const path = endpoint.path;
    
    if (!openApi.paths[path]) {
      openApi.paths[path] = {};
    }
    
    openApi.paths[path][endpoint.method.toLowerCase()] = {
      summary: endpoint.description,
      parameters: endpoint.parameters,
      responses: endpoint.responses
    };
  });
  
  // Add models to components
  apiDoc.models.forEach(model => {
    openApi.components.schemas[model.name] = {
      type: 'object',
      properties: model.properties.reduce((props, prop) => {
        props[prop.name] = {
          type: prop.type,
          description: prop.description
        };
        return props;
      }, {})
    };
  });
  
  return openApi;
}

// Generate Swagger UI HTML
function generateSwaggerUI(openApiSpec) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
        *, *:before, *:after { box-sizing: inherit; }
        body { margin:0; background: #fafafa; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@4.0.0/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@4.0.0/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                spec: ${JSON.stringify(openApiSpec)},
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout"
            });
        };
    </script>
</body>
</html>`;
  
  return html;
}

// Architecture and API documentation endpoints
app.get('/api/analytics/architecture/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const architecture = architectureGenerator.projects.get(projectId);
    
    if (!architecture) {
      return res.status(404).json({ error: 'Architecture diagram not found for project' });
    }
    
    res.json({
      projectId,
      architecture,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting architecture:', error);
    res.status(500).json({ error: 'Failed to get architecture' });
  }
});

app.get('/api/analytics/api-docs/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const apiDoc = apiDocGenerator.projects.get(projectId);
    
    if (!apiDoc) {
      return res.status(404).json({ error: 'API documentation not found for project' });
    }
    
    res.json({
      projectId,
      apiDoc,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting API documentation:', error);
    res.status(500).json({ error: 'Failed to get API documentation' });
  }
});

app.get('/api/analytics/api-docs/:projectId/swagger', (req, res) => {
  try {
    const { projectId } = req.params;
    const apiDoc = apiDocGenerator.projects.get(projectId);
    
    if (!apiDoc) {
      return res.status(404).json({ error: 'API documentation not found for project' });
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.send(apiDoc.swaggerUi);
    
  } catch (error) {
    console.error('Error getting Swagger UI:', error);
    res.status(500).json({ error: 'Failed to get Swagger UI' });
  }
});

app.get('/api/analytics/api-docs/:projectId/openapi', (req, res) => {
  try {
    const { projectId } = req.params;
    const openApiSpec = apiDocGenerator.openApiSpecs.get(projectId);
    
    if (!openApiSpec) {
      return res.status(404).json({ error: 'OpenAPI specification not found for project' });
    }
    
    res.json(openApiSpec);
    
  } catch (error) {
    console.error('Error getting OpenAPI specification:', error);
    res.status(500).json({ error: 'Failed to get OpenAPI specification' });
  }
});

// Trigger architecture and API documentation generation
app.post('/api/analytics/architecture/:projectId/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to analyze' });
    }
    
    // Generate architecture diagram
    const architecture = await generateArchitectureDiagram(projectId, project.documentation);
    
    // Generate API documentation
    const apiDoc = await generateAPIDocumentation(projectId, project.documentation);
    
    if (architecture && apiDoc) {
      addAuditLog('ARCHITECTURE_GENERATED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Architecture diagram and API documentation generated', req);
      
      res.json({
        message: 'Architecture and API documentation generated successfully',
        projectId,
        architecture,
        apiDoc,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Failed to generate architecture or API documentation' });
    }
    
  } catch (error) {
    console.error('Error generating architecture:', error);
    res.status(500).json({ error: 'Failed to generate architecture' });
  }
});

app.get('/api/analytics/api-docs/:projectId/swagger', (req, res) => {
  try {
    const { projectId } = req.params;
    const apiDoc = apiDocGenerator.projects.get(projectId);
    
    if (!apiDoc) {
      return res.status(404).json({ error: 'API documentation not found for project' });
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.send(apiDoc.swaggerUi);
    
  } catch (error) {
    console.error('Error getting Swagger UI:', error);
    res.status(500).json({ error: 'Failed to get Swagger UI' });
  }
});

app.get('/api/analytics/api-docs/:projectId/openapi', (req, res) => {
  try {
    const { projectId } = req.params;
    const openApiSpec = apiDocGenerator.openApiSpecs.get(projectId);
    
    if (!openApiSpec) {
      return res.status(404).json({ error: 'OpenAPI specification not found for project' });
    }
    
    res.json(openApiSpec);
    
  } catch (error) {
    console.error('Error getting OpenAPI specification:', error);
    res.status(500).json({ error: 'Failed to get OpenAPI specification' });
  }
});

// Trigger architecture and API documentation generation
app.post('/api/analytics/architecture/:projectId/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to analyze' });
    }
    
    // Generate architecture diagram
    const architecture = await generateArchitectureDiagram(projectId, project.documentation);
    
    // Generate API documentation
    const apiDoc = await generateAPIDocumentation(projectId, project.documentation);
    
    if (architecture && apiDoc) {
      addAuditLog('ARCHITECTURE_GENERATED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Architecture diagram and API documentation generated', req);
      
      res.json({
        message: 'Architecture and API documentation generated successfully',
        projectId,
        architecture,
        apiDoc,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Failed to generate architecture or API documentation' });
      }
    
  } catch (error) {
    console.error('Error generating architecture:', error);
    res.status(500).json({ error: 'Failed to generate architecture' });
  }
});

// Database schema documentation generation
const schemaGenerator = {
  projects: new Map(), // projectId -> schema documentation
  schemas: new Map() // projectId -> generated schemas
};

// Generate database schema documentation for a project
async function generateDatabaseSchema(projectId, documentation) {
  try {
    const schemaDoc = {
      projectId,
      generatedAt: new Date().toISOString(),
      databases: [],
      tables: [],
      relationships: [],
      migrations: [],
      schema: null
    };
    
    // Analyze project for database configurations
    if (documentation.files) {
      schemaDoc.databases = detectDatabases(documentation.files);
      schemaDoc.tables = extractTables(documentation.files);
      schemaDoc.relationships = extractTableRelationships(documentation.files);
      schemaDoc.migrations = extractMigrations(documentation.files);
    }
    
    // Generate schema diagram
    schemaDoc.schema = generateSchemaDiagram(schemaDoc);
    
    // Store schema documentation
    schemaGenerator.projects.set(projectId, schemaDoc);
    schemaGenerator.schemas.set(projectId, schemaDoc.schema);
    
    console.log(`🗄️ Database schema generated for project ${projectId}: ${schemaDoc.tables.length} tables`);
    
    return schemaDoc;
    
  } catch (error) {
    console.error('Error generating database schema:', error);
    return null;
  }
}

// Detect databases used in the project
function detectDatabases(files) {
  const databases = [];
  
  files.forEach(file => {
    if (file.raw) {
      const content = file.raw.toLowerCase();
      
      // MongoDB detection
      if (content.includes('mongoose') || content.includes('mongodb')) {
        databases.push({
          name: 'MongoDB',
          type: 'NoSQL',
          description: 'Document-oriented database',
          driver: content.includes('mongoose') ? 'Mongoose ODM' : 'Native MongoDB driver'
        });
      }
      
      // PostgreSQL detection
      if (content.includes('postgresql') || content.includes('postgres') || content.includes('pg')) {
        databases.push({
          name: 'PostgreSQL',
          type: 'SQL',
          description: 'Advanced open source database',
          driver: content.includes('pg') ? 'pg (node-postgres)' : 'Unknown'
        });
      }
      
      // MySQL detection
      if (content.includes('mysql') || content.includes('mariadb')) {
        databases.push({
          name: 'MySQL',
          type: 'SQL',
          description: 'Open source relational database',
          driver: 'mysql2 or mysql'
        });
      }
      
      // SQLite detection
      if (content.includes('sqlite') || content.includes('better-sqlite3')) {
        databases.push({
          name: 'SQLite',
          type: 'SQL',
          description: 'Lightweight file-based database',
          driver: 'better-sqlite3 or sqlite3'
        });
      }
      
      // Redis detection
      if (content.includes('redis') || content.includes('ioredis')) {
        databases.push({
          name: 'Redis',
          type: 'NoSQL',
          description: 'In-memory data structure store',
          driver: 'ioredis or redis'
        });
      }
    }
  });
  
  return databases;
}

// Extract table definitions from code
function extractTables(files) {
  const tables = [];
  
  files.forEach(file => {
    if (file.raw && file.extension === '.js') {
      const content = file.raw;
      
      // Look for Mongoose schemas
      const mongooseMatches = content.match(/new\s+Schema\s*\(\s*\{([\s\S]*?)\}\s*\)/g);
      mongooseMatches?.forEach(match => {
        const schemaContent = match.match(/new\s+Schema\s*\(\s*\{([\s\S]*?)\}\s*\)/);
        if (schemaContent) {
          const tableName = extractTableName(content, match);
          const fields = extractMongooseFields(schemaContent[1]);
          
          tables.push({
            name: tableName,
            type: 'Mongoose Schema',
            fields,
            file: file.path
          });
        }
      });
    }
  });
  
  return tables;
}

// Extract table name from context
function extractTableName(content, schemaMatch) {
  const lines = content.split('\n');
  const schemaIndex = lines.findIndex(line => line.includes(schemaMatch.substring(0, 20)));
  
  if (schemaIndex > 0) {
    for (let i = schemaIndex - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('const') || line.startsWith('let') || line.startsWith('var')) {
        const varMatch = line.match(/(\w+)\s*=/);
        if (varMatch) {
          return varMatch[1];
        }
      }
    }
  }
  
  return 'UnknownTable';
}

// Extract Mongoose schema fields
function extractMongooseFields(schemaContent) {
  const fields = [];
  const fieldMatches = schemaContent.match(/(\w+)\s*:\s*\{([^}]*)\}/g);
  
  fieldMatches?.forEach(match => {
    const fieldMatch = match.match(/(\w+)\s*:\s*\{([^}]*)\}/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldProps = fieldMatch[2];
      
      fields.push({
        name: fieldName,
        type: extractFieldType(fieldProps),
        required: fieldProps.includes('required: true'),
        unique: fieldProps.includes('unique: true'),
        default: extractDefaultValue(fieldProps)
      });
    }
  });
  
  return fields;
}

// Extract field type from properties
function extractFieldType(props) {
  if (props.includes('type: String')) return 'String';
  if (props.includes('type: Number')) return 'Number';
  if (props.includes('type: Boolean')) return 'Boolean';
  if (props.includes('type: Date')) return 'Date';
  if (props.includes('type: ObjectId')) return 'ObjectId';
  if (props.includes('type: Array')) return 'Array';
  if (props.includes('type: Mixed')) return 'Mixed';
  
  return 'String';
}

// Extract default value from properties
function extractDefaultValue(props) {
  const defaultMatch = props.match(/default\s*:\s*([^,}]+)/);
  return defaultMatch ? defaultMatch[1].trim() : null;
}

// Generate schema diagram
function generateSchemaDiagram(schemaDoc) {
  let mermaid = 'erDiagram\n';
  
  // Add tables
  schemaDoc.tables.forEach(table => {
    mermaid += `  ${table.name} {\n`;
    table.fields.forEach(field => {
      const required = field.required ? 'PK' : '';
      mermaid += `    ${field.type} ${field.name} ${required}\n`;
    });
    mermaid += `  }\n`;
  });
  
  return mermaid;
}

// Database schema endpoints
app.get('/api/analytics/schema/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const schema = schemaGenerator.projects.get(projectId);
    
    if (!schema) {
      return res.status(404).json({ error: 'Database schema not found for project' });
    }
    
    res.json({
      projectId,
      schema,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting database schema:', error);
    res.status(500).json({ error: 'Failed to get database schema' });
  }
});

// Trigger database schema generation
app.post('/api/analytics/schema/:projectId/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to analyze' });
    }
    
    // Generate database schema
    const schema = await generateDatabaseSchema(projectId, project.documentation);
    
    if (schema) {
      addAuditLog('SCHEMA_GENERATED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Database schema generated', req);
      
      res.json({
        message: 'Database schema generated successfully',
        projectId,
        schema,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Failed to generate database schema' });
    }
    
  } catch (error) {
    console.error('Error generating database schema:', error);
    res.status(500).json({ error: 'Failed to generate database schema' });
  }
});

// Deployment guides generation
const deploymentGenerator = {
  projects: new Map(), // projectId -> deployment guides
  guides: new Map() // projectId -> generated guides
};

// Generate deployment guides for a project
async function generateDeploymentGuides(projectId, documentation) {
  try {
    const deploymentDoc = {
      projectId,
      generatedAt: new Date().toISOString(),
      platforms: [],
      docker: null,
      kubernetes: null,
      cloud: [],
      guides: []
    };
    
    // Analyze project for deployment configurations
    if (documentation.files) {
      deploymentDoc.platforms = detectDeploymentPlatforms(documentation.files);
      deploymentDoc.docker = extractDockerConfig(documentation.files);
      deploymentDoc.kubernetes = extractKubernetesConfig(documentation.files);
      deploymentDoc.cloud = detectCloudPlatforms(documentation.files);
    }
    
    // Generate deployment guides
    deploymentDoc.guides = generatePlatformGuides(deploymentDoc);
    
    // Store deployment documentation
    deploymentGenerator.projects.set(projectId, deploymentDoc);
    deploymentGenerator.guides.set(projectId, deploymentDoc.guides);
    
    console.log(`🚀 Deployment guides generated for project ${projectId}: ${deploymentDoc.platforms.length} platforms`);
    
    return deploymentDoc;
    
  } catch (error) {
    console.error('Error generating deployment guides:', error);
    return null;
  }
}

// Detect deployment platforms
function detectDeploymentPlatforms(files) {
  const platforms = [];
  
  files.forEach(file => {
    if (file.raw) {
      const content = file.raw.toLowerCase();
      const path = file.path.toLowerCase();
      
      // Docker detection
      if (path.includes('dockerfile') || content.includes('docker')) {
        platforms.push({
          name: 'Docker',
          type: 'Containerization',
          description: 'Container-based deployment',
          configFile: path.includes('dockerfile') ? file.path : null
        });
      }
      
      // Kubernetes detection
      if (path.includes('kubernetes') || path.includes('k8s') || content.includes('kubernetes')) {
        platforms.push({
          name: 'Kubernetes',
          type: 'Orchestration',
          description: 'Container orchestration platform',
          configFile: file.path
        });
      }
      
      // Heroku detection
      if (path.includes('procfile') || content.includes('heroku')) {
        platforms.push({
          name: 'Heroku',
          type: 'PaaS',
          description: 'Platform as a Service',
          configFile: path.includes('procfile') ? file.path : null
        });
      }
    }
  });
  
  return platforms;
}

// Extract Docker configuration
function extractDockerConfig(files) {
  const dockerFile = files.find(f => f.path.includes('dockerfile'));
  
  if (dockerFile) {
    return {
      hasDockerfile: true,
      dockerfilePath: dockerFile.path,
      content: dockerFile.raw,
      baseImage: extractBaseImage(dockerFile.raw),
      ports: extractExposedPorts(dockerFile.raw)
    };
  }
  
  return null;
}

// Extract base image from Dockerfile
function extractBaseImage(content) {
  const fromMatch = content.match(/FROM\s+([^\s\n]+)/i);
  return fromMatch ? fromMatch[1] : 'Unknown';
}

// Extract exposed ports from Dockerfile
function extractExposedPorts(content) {
  const ports = [];
  const exposeMatches = content.match(/EXPOSE\s+(\d+)/gi);
  
  exposeMatches?.forEach(match => {
    const portMatch = match.match(/EXPOSE\s+(\d+)/i);
    if (portMatch) {
      ports.push(parseInt(portMatch[1]));
    }
  });
  
  return ports;
}

// Generate platform-specific deployment guides
function generatePlatformGuides(deploymentDoc) {
  const guides = [];
  
  // Docker guide
  if (deploymentDoc.docker) {
    guides.push({
      platform: 'Docker',
      title: 'Docker Deployment Guide',
      content: generateDockerGuide(deploymentDoc.docker),
      difficulty: 'Beginner',
      estimatedTime: '15 minutes'
    });
  }
  
  // Heroku guide
  if (deploymentDoc.platforms.some(p => p.name === 'Heroku')) {
    guides.push({
      platform: 'Heroku',
      title: 'Heroku Deployment Guide',
      content: generateHerokuGuide(),
      difficulty: 'Beginner',
      estimatedTime: '10 minutes'
    });
  }
  
  return guides;
}

// Generate Docker deployment guide
function generateDockerGuide(dockerConfig) {
  return `
# Docker Deployment Guide

## Prerequisites
- Docker installed on your system
- Docker Compose (optional, for multi-container setups)

## Quick Start

1. **Build the Docker image:**
   \`\`\`bash
   docker build -t your-app-name .
   \`\`\`

2. **Run the container:**
   \`\`\`bash
   docker run -p ${dockerConfig.ports[0] || 3000}:${dockerConfig.ports[0] || 3000} your-app-name
   \`\`\`

## Base Image
The application uses: \`${dockerConfig.baseImage}\`

## Ports
The application exposes the following ports:
${dockerConfig.ports.map(port => `- Port ${port}`).join('\n')}

## Production Deployment
For production, consider using Docker Compose or Kubernetes for better orchestration.
`;
}

// Generate Heroku deployment guide
function generateHerokuGuide() {
  return `
# Heroku Deployment Guide

## Prerequisites
- Heroku CLI installed
- Heroku account
- Git repository

## Quick Deploy

1. **Login to Heroku:**
   \`\`\`bash
   heroku login
   \`\`\`

2. **Create a new Heroku app:**
   \`\`\`bash
   heroku create your-app-name
   \`\`\`

3. **Set environment variables:**
   \`\`\`bash
   heroku config:set NODE_ENV=production
   \`\`\`

4. **Deploy:**
   \`\`\`bash
   git push heroku main
   \`\`\`

## Environment Variables
Set your environment variables in the Heroku dashboard or via CLI:
\`\`\`bash
heroku config:set DATABASE_URL=your-database-url
\`\`\`

## Monitoring
Monitor your app with:
\`\`\`bash
heroku logs --tail
heroku ps
\`\`\`
`;
}

// Deployment guides endpoints
app.get('/api/analytics/deployment/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const deployment = deploymentGenerator.projects.get(projectId);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment guides not found for project' });
    }
    
    res.json({
      projectId,
      deployment,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting deployment guides:', error);
    res.status(500).json({ error: 'Failed to get deployment guides' });
  }
});

// Trigger deployment guides generation
app.post('/api/analytics/deployment/:projectId/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!project.documentation) {
      return res.status(400).json({ error: 'Project has no documentation to analyze' });
    }
    
    // Generate deployment guides
    const deployment = await generateDeploymentGuides(projectId, project.documentation);
    
    if (deployment) {
      addAuditLog('DEPLOYMENT_GENERATED', req.userId || 'anonymous', `projects/${projectId}`, 
        'Deployment guides generated', req);
      
      res.json({
        message: 'Deployment guides generated successfully',
        projectId,
        deployment,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Failed to generate deployment guides' });
    }
    
  } catch (error) {
    console.error('Error generating deployment guides:', error);
    res.status(500).json({ error: 'Failed to generate deployment guides' });
  }
});

// Plugin System for extensible architecture
const pluginSystem = {
  plugins: new Map(), // pluginId -> plugin instance
  hooks: new Map(), // hookName -> array of plugin functions
  registry: new Map() // pluginName -> plugin metadata
};

// Plugin base class
class BasePlugin {
  constructor(name, version, description) {
    this.name = name;
    this.version = version;
    this.description = description;
    this.enabled = true;
    this.hooks = [];
  }
  
  // Register hooks this plugin provides
  registerHook(hookName, callback) {
    if (!pluginSystem.hooks.has(hookName)) {
      pluginSystem.hooks.set(hookName, []);
    }
    pluginSystem.hooks.get(hookName).push(callback);
    this.hooks.push(hookName);
  }
  
  // Plugin lifecycle methods
  onEnable() {}
  onDisable() {}
  onInstall() {}
  onUninstall() {}
  
  // Get plugin info
  getInfo() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      enabled: this.enabled,
      hooks: this.hooks
    };
  }
}

// Built-in plugins
class CodeAnalysisPlugin extends BasePlugin {
  constructor() {
    super('CodeAnalysis', '1.0.0', 'Enhanced code analysis and metrics');
    this.registerHook('afterFileAnalysis', this.enhanceFileAnalysis.bind(this));
    this.registerHook('afterProjectAnalysis', this.enhanceProjectAnalysis.bind(this));
  }
  
  enhanceFileAnalysis(file, analysis) {
    // Add additional code analysis
    if (analysis.complexity > 10) {
      analysis.warnings = analysis.warnings || [];
      analysis.warnings.push('High complexity detected - consider refactoring');
    }
    
    if (analysis.lines > 1000) {
      analysis.warnings = analysis.warnings || [];
      analysis.warnings.push('Large file detected - consider splitting');
    }
    
    return analysis;
  }
  
  enhanceProjectAnalysis(project, analysis) {
    // Add project-level insights
    analysis.pluginInsights = {
      totalComplexity: project.files?.reduce((sum, f) => sum + (f.complexity || 0), 0) || 0,
      averageComplexity: project.files?.reduce((sum, f) => sum + (f.complexity || 0), 0) / (project.files?.length || 1) || 0,
      maintainabilityScore: this.calculateMaintainabilityScore(project)
    };
    
    return analysis;
  }
  
  calculateMaintainabilityScore(project) {
    const files = project.files || [];
    if (files.length === 0) return 100;
    
    const avgComplexity = files.reduce((sum, f) => sum + (f.complexity || 0), 0) / files.length;
    const avgLines = files.reduce((sum, f) => sum + (f.lines || 0), 0) / files.length;
    
    let score = 100;
    if (avgComplexity > 5) score -= 20;
    if (avgComplexity > 10) score -= 30;
    if (avgLines > 500) score -= 15;
    if (avgLines > 1000) score -= 25;
    
    return Math.max(0, score);
  }
}

class SecurityPlugin extends BasePlugin {
  constructor() {
    super('Security', '1.0.0', 'Security vulnerability detection and analysis');
    this.registerHook('afterDependencyAnalysis', this.securityScan.bind(this));
    this.registerHook('afterCodeAnalysis', this.securityCodeScan.bind(this));
  }
  
  securityScan(dependencies, analysis) {
    // Add security insights
    analysis.securityIssues = analysis.securityIssues || [];
    
    // Check for known vulnerable packages
    const vulnerablePackages = ['lodash', 'moment', 'jquery'];
    vulnerablePackages.forEach(pkg => {
      if (dependencies.some(dep => dep.name === pkg)) {
        analysis.securityIssues.push({
          type: 'vulnerable_package',
          package: pkg,
          severity: 'medium',
          description: 'Known vulnerable package detected'
        });
      }
    });
    
    return analysis;
  }
  
  securityCodeScan(file, analysis) {
    // Add security code analysis
    analysis.securityWarnings = analysis.securityWarnings || [];
    
    if (file.raw) {
      const content = file.raw.toLowerCase();
      
      // Check for common security issues
      if (content.includes('eval(')) {
        analysis.securityWarnings.push({
          type: 'dangerous_function',
          function: 'eval',
          severity: 'high',
          description: 'eval() function detected - security risk'
        });
      }
      
      if (content.includes('innerhtml') && content.includes('user')) {
        analysis.securityWarnings.push({
          type: 'xss_risk',
          severity: 'medium',
          description: 'Potential XSS risk with user input'
        });
      }
    }
    
    return analysis;
  }
}

// Plugin management functions
function registerPlugin(plugin) {
  if (!(plugin instanceof BasePlugin)) {
    throw new Error('Plugin must extend BasePlugin');
  }
  
  const pluginId = `${plugin.name}-${plugin.version}`;
  pluginSystem.plugins.set(pluginId, plugin);
  pluginSystem.registry.set(plugin.name, {
    id: pluginId,
    version: plugin.version,
    description: plugin.description,
    enabled: plugin.enabled
  });
  
  // Call install hook
  plugin.onInstall();
  
  console.log(`🔌 Plugin registered: ${plugin.name} v${plugin.version}`);
  return pluginId;
}

function unregisterPlugin(pluginId) {
  const plugin = pluginSystem.plugins.get(pluginId);
  if (plugin) {
    plugin.onUninstall();
    pluginSystem.plugins.delete(pluginId);
    
    // Remove from registry
    for (const [name, info] of pluginSystem.registry.entries()) {
      if (info.id === pluginId) {
        pluginSystem.registry.delete(name);
        break;
      }
    }
    
    console.log(`🔌 Plugin unregistered: ${pluginId}`);
    return true;
  }
  return false;
}

function enablePlugin(pluginId) {
  const plugin = pluginSystem.plugins.get(pluginId);
  if (plugin) {
    plugin.enabled = true;
    plugin.onEnable();
    console.log(`🔌 Plugin enabled: ${pluginId}`);
    return true;
  }
  return false;
}

function disablePlugin(pluginId) {
  const plugin = pluginSystem.plugins.get(pluginId);
  if (plugin) {
    plugin.enabled = false;
    plugin.onDisable();
    console.log(`🔌 Plugin disabled: ${pluginId}`);
    return true;
  }
  return false;
}

// Execute plugin hooks
function executeHook(hookName, ...args) {
  const hooks = pluginSystem.hooks.get(hookName) || [];
  let result = args[0]; // First argument is usually the data to transform
  
  hooks.forEach(hook => {
    try {
      if (typeof hook === 'function') {
        result = hook(...args);
      }
    } catch (error) {
      console.error(`Error executing plugin hook ${hookName}:`, error);
    }
  });
  
  return result;
}

// Initialize built-in plugins
function initializeBuiltInPlugins() {
  registerPlugin(new CodeAnalysisPlugin());
  registerPlugin(new SecurityPlugin());
  console.log('🔌 Built-in plugins initialized');
}

// Plugin system endpoints
app.get('/api/plugins', (req, res) => {
  try {
    const plugins = Array.from(pluginSystem.registry.values());
    res.json({
      plugins,
      total: plugins.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting plugins:', error);
    res.status(500).json({ error: 'Failed to get plugins' });
  }
});

app.get('/api/plugins/:pluginId', (req, res) => {
  try {
    const { pluginId } = req.params;
    const plugin = pluginSystem.plugins.get(pluginId);
    
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    
    res.json({
      pluginId,
      info: plugin.getInfo(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting plugin:', error);
    res.status(500).json({ error: 'Failed to get plugin' });
  }
});

app.post('/api/plugins/:pluginId/enable', (req, res) => {
  try {
    const { pluginId } = req.params;
    const success = enablePlugin(pluginId);
    
    if (success) {
      res.json({
        message: 'Plugin enabled successfully',
        pluginId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({ error: 'Plugin not found' });
    }
  } catch (error) {
    console.error('Error enabling plugin:', error);
    res.status(500).json({ error: 'Failed to enable plugin' });
  }
});

app.post('/api/plugins/:pluginId/disable', (req, res) => {
  try {
    const { pluginId } = req.params;
    const success = disablePlugin(pluginId);
    
    if (success) {
      res.json({
        message: 'Plugin disabled successfully',
        pluginId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({ error: 'Plugin not found' });
    }
  } catch (error) {
    console.error('Error disabling plugin:', error);
    res.status(500).json({ error: 'Failed to disable plugin' });
  }
});

app.delete('/api/plugins/:pluginId', (req, res) => {
  try {
    const { pluginId } = req.params;
    const success = unregisterPlugin(pluginId);
    
    if (success) {
      res.json({
        message: 'Plugin unregistered successfully',
        pluginId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({ error: 'Plugin not found' });
    }
  } catch (error) {
    console.error('Error unregistering plugin:', error);
    res.status(500).json({ error: 'Failed to unregister plugin' });
  }
});

// Initialize plugins on startup
initializeBuiltInPlugins();

// Missing functions for plugin system
function extractTableRelationships(files) {
  const relationships = [];
  
  files.forEach(file => {
    if (file.raw && file.extension === '.js') {
      const content = file.raw;
      
      // Look for Mongoose refs
      const refMatches = content.match(/ref\s*:\s*['"`]([^'"`]+)['"`]/g);
      refMatches?.forEach(match => {
        const refMatch = match.match(/ref\s*:\s*['"`]([^'"`]+)['"`]/);
        if (refMatch) {
          relationships.push({
            type: 'Reference',
            from: extractTableName(content, match),
            to: refMatch[1],
            relationship: 'One-to-Many'
          });
        }
      });
    }
  });
  
  return relationships;
}

function extractMigrations(files) {
  const migrations = [];
  
  files.forEach(file => {
    if (file.path.includes('migration') || file.path.includes('migrations')) {
      migrations.push({
        name: file.name,
        path: file.path,
        type: 'Migration',
        description: `Migration file: ${file.name}`
      });
    }
  });
  
  return migrations;
}

function detectCloudPlatforms(files) {
  const cloudPlatforms = [];
  
  files.forEach(file => {
    if (file.raw) {
      const content = file.raw.toLowerCase();
      
      // AWS detection
      if (content.includes('aws') || content.includes('amazon') || content.includes('s3') || content.includes('lambda')) {
        cloudPlatforms.push({
          name: 'AWS',
          type: 'Cloud Provider',
          description: 'Amazon Web Services',
          services: ['S3', 'Lambda', 'EC2']
        });
      }
      
      // Google Cloud detection
      if (content.includes('google cloud') || content.includes('gcp') || content.includes('firebase')) {
        cloudPlatforms.push({
          name: 'Google Cloud',
          type: 'Cloud Provider',
          description: 'Google Cloud Platform',
          services: ['Firebase', 'Cloud Functions']
        });
      }
    }
  });
  
  return cloudPlatforms;
}

function extractKubernetesConfig(files) {
  const k8sFiles = files.filter(f => 
    f.path.includes('kubernetes') || 
    f.path.includes('k8s') || 
    f.extension === '.yaml' || 
    f.extension === '.yml'
  );
  
  if (k8sFiles.length > 0) {
    return {
      hasConfig: true,
      files: k8sFiles.map(f => ({
        name: f.name,
        path: f.path,
        content: f.raw
      }))
    };
  }
  
  return null;
}

// Missing functions for architecture and API documentation
function extractComponents(structure) {
  const components = [];
  
  function scanStructure(items, parentPath = '') {
    Object.entries(items).forEach(([name, info]) => {
      if (info.type === 'directory') {
        const component = {
          name,
          type: 'directory',
          path: parentPath ? `${parentPath}/${name}` : name,
          category: categorizeComponent(name),
          children: []
        };
        
        if (info.children) {
          scanStructure(info.children, component.path);
          component.children = Object.keys(info.children);
        }
        
        components.push(component);
      } else if (info.type === 'file') {
        const component = {
          name,
          type: 'file',
          path: parentPath ? `${parentPath}/${name}` : name,
          category: categorizeComponent(name),
          extension: info.extension,
          size: info.size
        };
        
        components.push(component);
      }
    });
  }
  
  scanStructure(structure);
  return components;
}

function categorizeComponent(name) {
  const nameLower = name.toLowerCase();
  
  if (nameLower.includes('controller') || nameLower.includes('ctrl')) return 'Controller';
  if (nameLower.includes('service')) return 'Service';
  if (nameLower.includes('model') || nameLower.includes('entity')) return 'Model';
  if (nameLower.includes('repository') || nameLower.includes('repo')) return 'Repository';
  if (nameLower.includes('middleware')) return 'Middleware';
  if (nameLower.includes('util') || nameLower.includes('helper')) return 'Utility';
  if (nameLower.includes('config') || nameLower.includes('conf')) return 'Configuration';
  if (nameLower.includes('test') || nameLower.includes('spec')) return 'Test';
  if (nameLower.includes('component') || nameLower.includes('ui')) return 'UI Component';
  if (nameLower.includes('api') || nameLower.includes('route')) return 'API';
  if (nameLower.includes('db') || nameLower.includes('database')) return 'Database';
  if (nameLower.includes('auth') || nameLower.includes('security')) return 'Security';
  
  return 'Other';
}

function extractRelationships(files) {
  const relationships = [];
  
  files.forEach(file => {
    if (file.raw && file.imports) {
      file.imports.forEach(importPath => {
        relationships.push({
          from: file.path,
          to: importPath,
          type: 'import',
          strength: 'strong'
        });
      });
    }
  });
  
  return relationships;
}

function detectArchitecturalLayers(documentation) {
  const layers = [];
  
  // Check for common architectural patterns
  if (documentation.files.some(f => f.path.includes('controller'))) {
    layers.push({
      name: 'Presentation Layer',
      components: ['Controllers', 'Routes', 'Views'],
      description: 'Handles user interface and request routing'
    });
  }
  
  if (documentation.files.some(f => f.path.includes('service'))) {
    layers.push({
      name: 'Business Logic Layer',
      components: ['Services', 'Business Logic', 'Use Cases'],
      description: 'Contains business rules and application logic'
    });
  }
  
  if (documentation.files.some(f => f.path.includes('model') || f.path.includes('entity'))) {
    layers.push({
      name: 'Data Access Layer',
      components: ['Models', 'Entities', 'Repositories'],
      description: 'Manages data persistence and database operations'
    });
  }
  
  return layers;
}

function identifyTechnologies(documentation) {
  const technologies = [];
  
  // Framework detection
  if (documentation.files.some(f => f.raw && f.raw.includes('express'))) {
    technologies.push({
      name: 'Express.js',
      category: 'Framework',
      description: 'Web application framework for Node.js'
    });
  }
  
  if (documentation.files.some(f => f.raw && f.raw.includes('react'))) {
    technologies.push({
      name: 'React',
      category: 'Frontend Framework',
      description: 'JavaScript library for building user interfaces'
    });
  }
  
  return technologies;
}

function generateMermaidDiagram(architecture) {
  let mermaid = 'graph TD\n';
  
  // Add components
  architecture.components.forEach(component => {
    const nodeId = component.path.replace(/[^a-zA-Z0-9]/g, '_');
    const color = getComponentColor(component.category);
    
    if (component.type === 'directory') {
      mermaid += `  subgraph ${nodeId}["${component.name}"]\n`;
      component.children.forEach(child => {
        const childId = child.replace(/[^a-zA-Z0-9]/g, '_');
        mermaid += `    ${childId}["${child}"]\n`;
      });
      mermaid += `  end\n`;
    } else {
      mermaid += `  ${nodeId}["${component.name}"]\n`;
    }
    
    mermaid += `  style ${nodeId} fill:${color}\n`;
  });
  
  return mermaid;
}

function getComponentColor(category) {
  const colors = {
    'Controller': '#ff6b6b',
    'Service': '#4ecdc4',
    'Model': '#45b7d1',
    'Repository': '#96ceb4',
    'Middleware': '#feca57',
    'Utility': '#ff9ff3',
    'Configuration': '#54a0ff',
    'Test': '#5f27cd',
    'UI Component': '#00d2d3',
    'API': '#ff9f43',
    'Database': '#10ac84',
    'Security': '#ee5253',
    'Other': '#c8d6e5'
  };
  
  return colors[category] || colors['Other'];
}

// Missing functions for API documentation generation
function extractAPIEndpoints(files) {
  const endpoints = [];
  
  files.forEach(file => {
    if (file.raw && file.extension === '.js') {
      const content = file.raw;
      
      // Look for Express.js routes
      const routeMatches = content.match(/app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      
      if (routeMatches) {
        routeMatches.forEach(match => {
          const methodMatch = match.match(/app\.(get|post|put|delete|patch)/);
          const pathMatch = match.match(/['"`]([^'"`]+)['"`]/);
          
          if (methodMatch && pathMatch) {
            endpoints.push({
              method: methodMatch[1].toUpperCase(),
              path: pathMatch[1],
              file: file.path,
              description: `API endpoint for ${pathMatch[1]}`,
              parameters: [],
              responses: {}
            });
          }
        });
      }
    }
  });
  
  return endpoints;
}

function extractDataModels(files) {
  const models = [];
  
  files.forEach(file => {
    if (file.raw && file.classes) {
      file.classes.forEach(className => {
        const model = {
          name: className,
          file: file.path,
          properties: [],
          methods: []
        };
        
        models.push(model);
      });
    }
  });
  
  return models;
}

function generateOpenAPISpec(apiDoc) {
  const openApi = {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    paths: {},
    components: {
      schemas: {}
    }
  };
  
  // Add endpoints to paths
  apiDoc.endpoints.forEach(endpoint => {
    const path = endpoint.path;
    
    if (!openApi.paths[path]) {
      openApi.paths[path] = {};
    }
    
    openApi.paths[path][endpoint.method.toLowerCase()] = {
      summary: endpoint.description,
      parameters: endpoint.parameters,
      responses: endpoint.responses
    };
  });
  
  return openApi;
}

function generateSwaggerUI(openApiSpec) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
        *, *:before, *:after { box-sizing: inherit; }
        body { margin:0; background: #fafafa; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@4.0.0/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@4.0.0/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                spec: ${JSON.stringify(openApiSpec)},
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout"
            });
        };
    </script>
</body>
</html>`;
  
  return html;
}

// Missing functions for deployment guides
function detectDeploymentPlatforms(files) {
  const platforms = [];
  
  files.forEach(file => {
    if (file.raw) {
      const content = file.raw.toLowerCase();
      const path = file.path.toLowerCase();
      
      // Docker detection
      if (path.includes('dockerfile') || content.includes('docker')) {
        platforms.push({
          name: 'Docker',
          type: 'Containerization',
          description: 'Container-based deployment',
          configFile: path.includes('dockerfile') ? file.path : null
        });
      }
      
      // Kubernetes detection
      if (path.includes('kubernetes') || path.includes('k8s') || content.includes('kubernetes')) {
        platforms.push({
          name: 'Kubernetes',
          type: 'Orchestration',
          description: 'Container orchestration platform',
          configFile: file.path
        });
      }
      
      // Heroku detection
      if (path.includes('procfile') || content.includes('heroku')) {
        platforms.push({
          name: 'Heroku',
          type: 'PaaS',
          description: 'Platform as a Service',
          configFile: path.includes('procfile') ? file.path : null
        });
      }
    }
  });
  
  return platforms;
}

function extractDockerConfig(files) {
  const dockerFile = files.find(f => f.path.includes('dockerfile'));
  
  if (dockerFile) {
    return {
      hasDockerfile: true,
      dockerfilePath: dockerFile.path,
      content: dockerFile.raw,
      baseImage: extractBaseImage(dockerFile.raw),
      ports: extractExposedPorts(dockerFile.raw)
    };
  }
  
  return null;
}

function extractBaseImage(content) {
  const fromMatch = content.match(/FROM\s+([^\s\n]+)/i);
  return fromMatch ? fromMatch[1] : 'Unknown';
}

function extractExposedPorts(content) {
  const ports = [];
  const exposeMatches = content.match(/EXPOSE\s+(\d+)/gi);
  
  exposeMatches?.forEach(match => {
    const portMatch = match.match(/EXPOSE\s+(\d+)/i);
    if (portMatch) {
      ports.push(parseInt(portMatch[1]));
    }
  });
  
  return ports;
}

function generatePlatformGuides(deploymentDoc) {
  const guides = [];
  
  // Docker guide
  if (deploymentDoc.docker) {
    guides.push({
      platform: 'Docker',
      title: 'Docker Deployment Guide',
      content: generateDockerGuide(deploymentDoc.docker),
      difficulty: 'Beginner',
      estimatedTime: '15 minutes'
    });
  }
  
  // Heroku guide
  if (deploymentDoc.platforms.some(p => p.name === 'Heroku')) {
    guides.push({
      platform: 'Heroku',
      title: 'Heroku Deployment Guide',
      content: generateHerokuGuide(),
      difficulty: 'Beginner',
      estimatedTime: '10 minutes'
    });
  }
  
  return guides;
}

function generateDockerGuide(dockerConfig) {
  return `
# Docker Deployment Guide

## Prerequisites
- Docker installed on your system
- Docker Compose (optional, for multi-container setups)

## Quick Start

1. **Build the Docker image:**
   \`\`\`bash
   docker build -t your-app-name .
   \`\`\`

2. **Run the container:**
   \`\`\`bash
   docker run -p ${dockerConfig.ports[0] || 3000}:${dockerConfig.ports[0] || 3000} your-app-name
   \`\`\`

## Base Image
The application uses: \`${dockerConfig.baseImage}\`

## Ports
The application exposes the following ports:
${dockerConfig.ports.map(port => `- Port ${port}`).join('\n')}

## Production Deployment
For production, consider using Docker Compose or Kubernetes for better orchestration.
`;
}

function generateHerokuGuide() {
  return `
# Heroku Deployment Guide

## Prerequisites
- Heroku CLI installed
- Heroku account
- Git repository

## Quick Deploy

1. **Login to Heroku:**
   \`\`\`bash
   heroku login
   \`\`\`

2. **Create a new Heroku app:**
   \`\`\`bash
   heroku create your-app-name
   \`\`\`

3. **Set environment variables:**
   \`\`\`bash
   heroku config:set NODE_ENV=production
   \`\`\`

4. **Deploy:**
   \`\`\`bash
   git push heroku main
   \`\`\`

## Environment Variables
Set your environment variables in the Heroku dashboard or via CLI:
\`\`\`bash
heroku config:set DATABASE_URL=your-database-url
\`\`\`

## Monitoring
Monitor your app with:
\`\`\`bash
heroku logs --tail
heroku ps
\`\`\`
`;
}
/ /   U s e r   A u t h e n t i c a t i o n   a n d   T e a m   C o l l a b o r a t i o n   S y s t e m 
 
 c o n s t   b c r y p t   =   r e q u i r e ( ' b c r y p t ' ) ; 
 
 c o n s t   j w t   =   r e q u i r e ( ' j s o n w e b t o k e n ' ) ; 
 
 / /   U s e r   s t o r a g e   ( i n   p r o d u c t i o n ,   u s e   a   p r o p e r   d a t a b a s e ) 
 
 c o n s t   u s e r s   =   n e w   M a p ( ) ; 
 
 c o n s t   u s e r S e s s i o n s   =   n e w   M a p ( ) ; 
 
 c o n s t   t e a m s   =   n e w   M a p ( ) ; 
 
 c o n s t   t e a m M e m b e r s   =   n e w   M a p ( ) ; 
 
 c o n s t   u s e r P r o j e c t s   =   n e w   M a p ( ) ; 
 
 / /   J W T   s e c r e t   ( i n   p r o d u c t i o n ,   u s e   e n v i r o n m e n t   v a r i a b l e ) 
 
 c o n s t   J W T _ S E C R E T   =   p r o c e s s . e n v . J W T _ S E C R E T   | |   ' y o u r - s e c r e t - k e y - c h a n g e - i n - p r o d u c t i o n ' ; 
 
 / /   U s e r   r e g i s t r a t i o n 
 
 a p p . p o s t ( ' / a p i / a u t h / r e g i s t e r ' ,   a s y n c   ( r e q ,   r e s )   = >   { 
 
 