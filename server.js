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

// Rate limiting configuration
const rateLimit = require('express-rate-limit');

// Create rate limiters for different endpoints
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs: windowMs,
    max: max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
        timestamp: Date.now()
      });
    }
  });
};

// Apply rate limiting to different endpoints
const generalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per 15 minutes
  'Too many requests, please try again later.'
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

const batchLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 batch operations per hour
  'Too many batch operations, please try again later.'
);

// Apply rate limiting to endpoints
app.use('/api/projects', generalLimiter);
app.use('/api/projects', projectCreationLimiter);
app.use('/api/search', searchLimiter);
app.use('/api/projects/batch', batchLimiter);

// Enhanced search functionality
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
    
    // Index files with enhanced content analysis
    documentation.files.forEach(file => {
      if (file.raw && typeof file.raw === 'string') {
        const fileIndex = {
          path: file.path,
          language: file.language,
          size: file.size,
          functions: file.functions || [],
          classes: file.classes || [],
          tokens: file.tokens || [],
          content: file.raw.toLowerCase(),
          lastModified: Date.now()
        };
        
        index.files.push(fileIndex);
        
        // Create content index for full-text search
        const words = file.raw.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(word => word.length > 2);
        
        const wordFrequency = new Map();
        words.forEach(word => {
          wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
        });
        
        index.content.set(file.path, wordFrequency);
      }
    });
    
    index.metadata.totalFiles = index.files.length;
    index.metadata.languages = [...new Set(index.files.map(f => f.language).filter(Boolean))];
    
    searchIndex.set(projectId, index);
    console.log(`🔍 Search index built for project ${projectId}: ${index.files.length} files indexed`);
    
  } catch (error) {
    console.error(`Error building search index for project ${projectId}:`, error);
  }
}

// Enhanced search endpoint with relevance scoring
app.get('/api/search', async (req, res) => {
  try {
    const { q: query, projectId, language, fileType, limit = 50 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters long' });
    }
    
    const searchQuery = query.trim().toLowerCase();
    const results = [];
    
    // Search across all projects or specific project
    const projectsToSearch = projectId ? [projectId] : Array.from(searchIndex.keys());
    
    for (const pid of projectsToSearch) {
      const index = searchIndex.get(pid);
      if (!index) continue;
      
      const project = projects.get(pid);
      if (!project) continue;
      
      for (const file of index.files) {
        // Apply filters
        if (language && file.language !== language) continue;
        if (fileType && !file.path.endsWith(fileType)) continue;
        
        let score = 0;
        const matches = [];
        
        // Path matching (highest priority)
        if (file.path.toLowerCase().includes(searchQuery)) {
          score += 100;
          matches.push({ type: 'path', context: file.path });
        }
        
        // Function/class name matching
        const functionMatches = file.functions.filter(f => 
          f.toLowerCase().includes(searchQuery)
        );
        if (functionMatches.length > 0) {
          score += 50 * functionMatches.length;
          matches.push({ type: 'function', context: functionMatches.join(', ') });
        }
        
        const classMatches = file.classes.filter(c => 
          c.toLowerCase().includes(searchQuery)
        );
        if (classMatches.length > 0) {
          score += 50 * classMatches.length;
          matches.push({ type: 'class', context: classMatches.join(', ') });
        }
        
        // Content matching with relevance scoring
        const contentIndex = index.content.get(file.path);
        if (contentIndex) {
          const queryWords = searchQuery.split(/\s+/);
          let contentScore = 0;
          
          queryWords.forEach(word => {
            const frequency = contentIndex.get(word) || 0;
            contentScore += frequency * 10;
          });
          
          score += contentScore;
          if (contentScore > 0) {
            matches.push({ type: 'content', context: 'Content matches found' });
          }
        }
        
        // Language bonus
        if (file.language === 'javascript' || file.language === 'typescript') {
          score += 5;
        }
        
        if (score > 0) {
          results.push({
            projectId: pid,
            projectName: project.projectName,
            repoUrl: project.repoUrl,
            file: {
              path: file.path,
              language: file.language,
              size: file.size,
              functions: file.functions,
              classes: file.classes
            },
            score: score,
            matches: matches
          });
        }
      }
    }
    
    // Sort by relevance score and limit results
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, parseInt(limit));
    
    // Add search metadata
    const searchStats = {
      totalResults: results.length,
      returnedResults: limitedResults.length,
      query: searchQuery,
      filters: {
        projectId: projectId || 'all',
        language: language || 'all',
        fileType: fileType || 'all'
      },
      executionTime: Date.now()
    };
    
    res.json({
      results: limitedResults,
      stats: searchStats
    });
    
  } catch (error) {
    console.error('Error performing search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get search suggestions for autocomplete
app.get('/api/search/suggestions', async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;
    
    if (!query || query.trim().length < 1) {
      return res.json({ suggestions: [] });
    }
    
    const searchQuery = query.trim().toLowerCase();
    const suggestions = new Set();
    
    // Collect suggestions from all indexed projects
    for (const [projectId, index] of searchIndex.entries()) {
      // Function and class names
      index.files.forEach(file => {
        file.functions.forEach(func => {
          if (func.toLowerCase().includes(searchQuery)) {
            suggestions.add(func);
          }
        });
        
        file.classes.forEach(cls => {
          if (cls.toLowerCase().includes(searchQuery)) {
            suggestions.add(cls);
          }
        });
      });
      
      // File paths
      index.files.forEach(file => {
        const pathParts = file.path.split('/');
        pathParts.forEach(part => {
          if (part.toLowerCase().includes(searchQuery) && part.length > 2) {
            suggestions.add(part);
          }
        });
      });
    }
    
    const limitedSuggestions = Array.from(suggestions)
      .sort((a, b) => a.toLowerCase().indexOf(searchQuery) - b.toLowerCase().indexOf(searchQuery))
      .slice(0, parseInt(limit));
    
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

// Performance optimization: Caching system for large repositories
const repositoryCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache TTL
const MAX_CACHE_SIZE = 100; // Maximum number of cached repositories

// Cache management functions
function getCachedRepository(repoUrl) {
  const cached = repositoryCache.get(repoUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Cache hit for repository: ${repoUrl}`);
    return cached.data;
  }
  console.log(`📦 Cache miss for repository: ${repoUrl}`);
  return null;
}

function setCachedRepository(repoUrl, data) {
  // Implement LRU eviction if cache is full
  if (repositoryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = repositoryCache.keys().next().value;
    repositoryCache.delete(oldestKey);
    console.log(`🗑️  Evicted oldest cache entry: ${oldestKey}`);
  }
  
  repositoryCache.set(repoUrl, {
    data: data,
    timestamp: Date.now()
  });
  console.log(`💾 Cached repository data: ${repoUrl}`);
}

function clearExpiredCache() {
  const now = Date.now();
  let clearedCount = 0;
  
  for (const [key, value] of repositoryCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      repositoryCache.delete(key);
      clearedCount++;
    }
  }
  
  if (clearedCount > 0) {
    console.log(`🧹 Cleared ${clearedCount} expired cache entries`);
  }
}

// Clear expired cache every 30 minutes
setInterval(clearExpiredCache, 1000 * 60 * 30);

// Batch processing and queue system
const processingQueue = [];
const activeProcesses = new Set();
const MAX_CONCURRENT_PROCESSES = 3; // Maximum number of repositories processing simultaneously

// Queue management functions
function addToQueue(projectId, repoUrl, mode) {
  processingQueue.push({ projectId, repoUrl, mode, addedAt: Date.now() });
  console.log(`📋 Added project ${projectId} to processing queue. Queue length: ${processingQueue.length}`);
  processNextInQueue();
}

function processNextInQueue() {
  if (processingQueue.length === 0 || activeProcesses.size >= MAX_CONCURRENT_PROCESSES) {
    return;
  }
  
  const nextProject = processingQueue.shift();
  console.log(`🚀 Starting batch processing for project ${nextProject.projectId}. Active processes: ${activeProcesses.size}`);
  
  activeProcesses.add(nextProject.projectId);
  
  processRepository(nextProject.projectId, nextProject.repoUrl, nextProject.mode)
    .finally(() => {
      activeProcesses.delete(nextProject.projectId);
      console.log(`✅ Completed batch processing for project ${nextProject.projectId}. Active processes: ${activeProcesses.size}`);
      processNextInQueue(); // Process next item in queue
    });
}

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
  const projectList = Array.from(projects.values());
  
  // Add detailed debugging info for each project
  const debugProjects = projectList.map(project => ({
    ...project,
    debug: {
      hasDocumentation: !!project.documentation,
      documentationType: project.documentation ? typeof project.documentation : 'none',
      filesCount: project.documentation?.files?.length || 0,
      filesSample: project.documentation?.files?.slice(0, 3).map(f => ({
        path: f.path,
        language: f.language,
        size: f.size,
        hasFunctions: f.functions?.length > 0,
        hasClasses: f.classes?.length > 0
      })) || [],
      hasReadme: !!project.documentation?.readme,
      readmeLength: project.documentation?.readme?.length || 0,
      hasStructure: !!project.documentation?.structure,
      structureRootItems: project.documentation?.structure ? Object.keys(project.documentation.structure).length : 0
    }
  }));
  
  res.json({
    totalProjects: projects.size,
    timestamp: new Date().toISOString(),
    projects: debugProjects,
    status: 'success',
    message: 'Debug endpoint working with enhanced project details'
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

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { repoUrl, projectName, description, mode = 'v2' } = req.body;
    
    console.log('Creating project:', { repoUrl, projectName, description, mode });
    
    if (!repoUrl || !projectName) {
      return res.status(400).json({ error: 'Repository URL and project name are required' });
    }

    // Validate mode parameter and normalize it
    let normalizedMode = mode;
    if (mode === '1') normalizedMode = 'v1';
    if (mode === '2') normalizedMode = 'v2';
    
    if (normalizedMode && !['v1', 'v2'].includes(normalizedMode)) {
      return res.status(400).json({ error: 'Invalid mode. Use "v1" (or "1") for comprehensive or "v2" (or "2") for beginner-friendly.' });
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
      mode: normalizedMode || 'v2'
    };
    
    projects.set(projectId, project);
    
    console.log('Project created:', { projectId, projectName, totalProjects: projects.size });
    
    // Start processing the repository (don't await - let it run in background)
    addToQueue(projectId, repoUrl, normalizedMode);

    res.json({ projectId, status: 'queued', mode: normalizedMode, message: 'Project added to processing queue' });
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
  
  // Add debugging info to the response
  console.log(`📊 Project details for ${projectId}:`);
  console.log(`   Status: ${project.status}`);
  console.log(`   Has documentation: ${!!project.documentation}`);
  console.log(`   Documentation type: ${typeof project.documentation}`);
  if (project.documentation) {
    console.log(`   Files count: ${project.documentation.files?.length || 0}`);
    console.log(`   Has README: ${!!project.documentation.readme}`);
    console.log(`   README length: ${project.documentation.readme?.length || 0}`);
    
    // Log first few files
    if (project.documentation.files && project.documentation.files.length > 0) {
      console.log(`   Sample files:`);
      project.documentation.files.slice(0, 3).forEach((file, index) => {
        console.log(`     ${index + 1}. ${file.path} (${file.language}, ${file.size} bytes)`);
      });
    }
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
  
  let progress = 0;
  let message = 'Initializing...';
  let step = 1;
  
  if (project.status === 'completed') {
    progress = 100;
    message = 'Documentation generated successfully';
    step = 6;
  } else if (project.status === 'failed') {
    progress = 0;
    message = 'Documentation generation failed';
    step = 1;
  } else if (project.status === 'processing') {
    // Estimate progress based on what's been done
    if (project.documentation && project.documentation.files && project.documentation.files.length > 0) {
      progress = 80;
      message = 'Generating AI documentation...';
      step = 5;
    } else {
      progress = 30;
      message = 'Analyzing repository structure...';
      step = 3;
    }
  }
  
  res.json({
    projectId,
    status: project.status,
    progress: progress,
    message: message,
    step: step,
    repoMetrics: project.documentation ? {
      totalFiles: project.documentation.files?.length || 0,
      totalDirectories: project.documentation.summary?.totalDirectories || 0,
      totalSize: project.documentation.summary?.totalSize || 0,
      languages: project.documentation.summary?.languages ? Object.keys(project.documentation.summary.languages) : []
    } : null
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

// Export project documentation in various formats
app.get('/api/projects/:projectId/export', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { format = 'markdown' } = req.query;
    
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (project.status !== 'completed' || !project.documentation) {
      return res.status(400).json({ error: 'Project documentation not ready yet' });
    }
    
    const documentation = project.documentation;
    let content, filename, contentType;
    
    switch (format.toLowerCase()) {
      case 'markdown':
        content = documentation.generatedReadme?.raw || documentation.readme?.content || `# ${project.projectName}\n\nNo README available.`;
        filename = `${project.projectName}-README.md`;
        contentType = 'text/markdown';
        break;
        
      case 'html':
        // Convert markdown to HTML
        const marked = require('marked');
        content = marked.parse(documentation.generatedReadme?.raw || documentation.readme?.content || `# ${project.projectName}\n\nNo README available.`);
        filename = `${project.projectName}-README.html`;
        contentType = 'text/html';
        break;
        
      case 'json':
        content = JSON.stringify({
          projectName: project.projectName,
          repoUrl: project.repoUrl,
          status: project.status,
          createdAt: project.createdAt,
          completedAt: project.completedAt,
          documentation: {
            summary: documentation.summary,
            files: documentation.files.map(f => ({
              path: f.path,
              language: f.language,
              size: f.size,
              functions: f.functions,
              classes: f.classes
            })),
            structure: documentation.structure,
            readme: documentation.readme,
            generatedReadme: documentation.generatedReadme
          }
        }, null, 2);
        filename = `${project.projectName}-documentation.json`;
        contentType = 'application/json';
        break;
        
      case 'txt':
        // Convert markdown to plain text
        content = (documentation.generatedReadme?.raw || documentation.readme?.content || `# ${project.projectName}\n\nNo README available.`)
          .replace(/#{1,6}\s+/g, '') // Remove headers
          .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
          .replace(/\*(.*?)\*/g, '$1') // Remove italic
          .replace(/`(.*?)`/g, '$1') // Remove code
          .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Remove links
        filename = `${project.projectName}-README.txt`;
        contentType = 'text/plain';
        break;
        
      default:
        return res.status(400).json({ 
          error: 'Unsupported format. Supported formats: markdown, html, json, txt' 
        });
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(content, 'utf8'));
    
    res.send(content);
    
  } catch (error) {
    console.error('Error exporting project:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Get available export formats
app.get('/api/projects/:projectId/export/formats', (req, res) => {
  const { projectId } = req.params;
  const project = projects.get(projectId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const formats = [
    {
      id: 'markdown',
      name: 'Markdown (.md)',
      description: 'Standard markdown format',
      extension: '.md',
      mimeType: 'text/markdown'
    },
    {
      id: 'html',
      name: 'HTML (.html)',
      description: 'Web-ready HTML format',
      extension: '.html',
      mimeType: 'text/html'
    },
    {
      id: 'json',
      name: 'JSON (.json)',
      description: 'Structured data format',
      extension: '.json',
      mimeType: 'application/json'
    },
    {
      id: 'txt',
      name: 'Plain Text (.txt)',
      description: 'Simple text format',
      extension: '.txt',
      mimeType: 'text/plain'
    }
  ];
  
  res.json({
    projectId,
    projectName: project.projectName,
    availableFormats: formats,
    recommendedFormat: 'markdown'
  });
});

// Webhook support for GitHub and GitLab
app.post('/api/webhooks/github', async (req, res) => {
  try {
    const event = req.headers['x-github-event'];
    const delivery = req.headers['x-github-delivery'];
    const signature = req.headers['x-hub-signature-256'];
    
    console.log(`📡 GitHub webhook received: ${event} (${delivery})`);
    
    // Verify webhook signature if secret is configured
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      const crypto = require('crypto');
      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      
      if (signature !== expectedSignature) {
        console.warn('⚠️  GitHub webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
    
    if (event === 'push') {
      const { repository, ref } = req.body;
      const repoUrl = repository.clone_url;
      
      console.log(`🔄 Repository updated: ${repoUrl} (${ref})`);
      
      // Find existing project for this repository
      const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
      
      if (existingProject) {
        console.log(`🔄 Updating existing project: ${existingProject.id}`);
        
        // Mark project for regeneration
        existingProject.status = 'queued';
        existingProject.lastUpdate = new Date().toISOString();
        existingProject.webhookTriggered = true;
        
        // Add to processing queue
        addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
        
        console.log(`✅ Project ${existingProject.id} queued for regeneration`);
      } else {
        console.log(`ℹ️  No existing project found for repository: ${repoUrl}`);
      }
    }
    
    res.json({ status: 'webhook processed' });
    
  } catch (error) {
    console.error('Error processing GitHub webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/api/webhooks/gitlab', async (req, res) => {
  try {
    const event = req.headers['x-gitlab-event'];
    const token = req.headers['x-gitlab-token'];
    
    console.log(`📡 GitLab webhook received: ${event}`);
    
    // Verify webhook token if configured
    if (process.env.GITLAB_WEBHOOK_TOKEN && token !== process.env.GITLAB_WEBHOOK_TOKEN) {
      console.warn('⚠️  GitLab webhook token verification failed');
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (event === 'Push Hook') {
      const { project, ref } = req.body;
      const repoUrl = project.git_http_url;
      
      console.log(`🔄 GitLab repository updated: ${repoUrl} (${ref})`);
      
      // Find existing project for this repository
      const existingProject = Array.from(projects.values()).find(p => p.repoUrl === repoUrl);
      
      if (existingProject) {
        console.log(`🔄 Updating existing GitLab project: ${existingProject.id}`);
        
        // Mark project for regeneration
        existingProject.status = 'queued';
        existingProject.lastUpdate = new Date().toISOString();
        existingProject.webhookTriggered = true;
        
        // Add to processing queue
        addToQueue(existingProject.id, repoUrl, existingProject.mode || 'v2');
        
        console.log(`✅ GitLab project ${existingProject.id} queued for regeneration`);
      } else {
        console.log(`ℹ️  No existing project found for GitLab repository: ${repoUrl}`);
      }
    }
    
    res.json({ status: 'webhook processed' });
    
  } catch (error) {
    console.error('Error processing GitLab webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Webhook configuration endpoint
app.get('/api/webhooks/config', (req, res) => {
  const config = {
    github: {
      url: `${req.protocol}://${req.get('host')}/api/webhooks/github`,
      events: ['push', 'pull_request'],
      secret: process.env.GITHUB_WEBHOOK_SECRET ? 'configured' : 'not configured'
    },
    gitlab: {
      url: `${req.protocol}://${req.get('host')}/api/webhooks/gitlab`,
      events: ['Push Hook', 'Merge Request Hook'],
      token: process.env.GITLAB_WEBHOOK_TOKEN ? 'configured' : 'not configured'
    },
    instructions: {
      github: 'Add the webhook URL to your GitHub repository settings with push events enabled',
      gitlab: 'Add the webhook URL to your GitLab project settings with push events enabled'
    }
  };
  
  res.json(config);
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
    // Check cache first for performance optimization
    const cachedData = getCachedRepository(repoUrl);
    if (cachedData) {
      console.log(`📦 Using cached data for repository: ${repoUrl}`);
      
      // Update project with cached documentation
      project.documentation = cachedData.documentation;
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      project.cacheHit = true;
      
      // Build search index
      buildSearchIndex(projectId, cachedData.documentation);
      
      projects.set(projectId, project);
      console.log(`✅ Project completed from cache: ${projectId}`);
      return;
    }

    const tempDir = `temp/${projectId}`;
    console.log(`Creating temp directory: ${tempDir}`);
    
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });
    console.log(`Temp directory created successfully: ${tempDir}`);

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
    project.cacheHit = false;
    
    console.log(`📊 Project ${projectId} updated with documentation:`);
    console.log(`   Documentation type: ${typeof documentation}`);
    console.log(`   Files count: ${documentation.files?.length || 0}`);
    console.log(`   Has README: ${!!documentation.readme}`);
    console.log(`   README length: ${documentation.readme?.length || 0}`);
    
    // Cache the results for future use
    setCachedRepository(repoUrl, { documentation });
    
    // Build search index
    buildSearchIndex(projectId, documentation);
    
    projects.set(projectId, project);
    console.log(`✅ Project completed: ${projectId}`);
    
    // Verify the project was stored correctly
    const storedProject = projects.get(projectId);
    console.log(`🔍 Verification - stored project has documentation: ${!!storedProject.documentation}`);
    console.log(`🔍 Verification - stored project files count: ${storedProject.documentation?.files?.length || 0}`);
    
  } catch (error) {
    console.error(`Error processing repository for project ${projectId}:`, error);
    console.error(`Error details:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    project.status = 'failed';
    project.error = error.message;
    projects.set(projectId, project);
  }
}

// Generate documentation from repository
async function generateDocumentation(tempDir, project, mode) {
  try {
    console.log(`📚 Generating documentation for project: ${project.projectName}`);
    const documentation = {
      summary: {},
      files: [],
      structure: {},
      readme: null,
      generatedReadme: null
    };

    // Scan directory for files
    console.log(`🔍 Starting directory scan for: ${tempDir}`);
    const files = await scanDirectory(tempDir);
    console.log(`📁 Directory scan complete. Found ${files.length} files`);
    
    // Log each file found
    files.forEach((file, index) => {
      console.log(`📄 File ${index + 1}: ${file.path} (${file.language}, ${file.size} bytes)`);
    });
    
    documentation.files = files;
    console.log(`📊 Documentation files array set with ${documentation.files.length} files`);

    // Build hierarchical file structure for frontend
    console.log(`🏗️  Building file structure...`);
    documentation.structure = buildFileStructure(files);
    console.log(`✅ File structure built with ${Object.keys(documentation.structure).length} root items`);

    // Extract original README if it exists
    console.log(`📖 Looking for original README...`);
    const readmeFile = files.find(file => 
      file.path.toLowerCase().includes('readme') && 
      (file.path.toLowerCase().endsWith('.md') || file.path.toLowerCase().endsWith('.txt'))
    );
    
    if (readmeFile) {
      console.log(`📖 Found original README: ${readmeFile.path}`);
      documentation.readme = {
        path: readmeFile.path,
        content: readmeFile.raw,
        raw: readmeFile.raw
      };
    } else {
      console.log(`📖 No README file found in repository`);
    }

    // Generate AI README if available
    if (geminiAI && AI_CONFIG) {
      try {
        console.log(`🤖 Attempting AI README generation...`);
        const aiReadme = await generateAIReadme(files, project, mode);
        if (aiReadme) {
          documentation.generatedReadme = {
            raw: aiReadme,
            markdown: aiReadme
          };
          console.log(`✅ AI README generated successfully (${aiReadme.length} characters)`);
        } else {
          console.log(`⚠️  AI README generation returned null`);
        }
      } catch (aiError) {
        console.warn('AI README generation failed, using template:', aiError.message);
        // Fallback to a basic template
        documentation.generatedReadme = {
          raw: `# ${project.projectName}\n\nThis is a generated README for ${project.projectName}.\n\n## Description\n\nThis project was analyzed from the repository: ${project.repoUrl}\n\n## Files\n\nThis project contains ${files.length} files.\n\n## Getting Started\n\nClone the repository and explore the codebase.`,
          markdown: `# ${project.projectName}\n\nThis is a generated README for ${project.projectName}.\n\n## Description\n\nThis project was analyzed from the repository: ${project.repoUrl}\n\n## Files\n\nThis project contains ${files.length} files.\n\n## Getting Started\n\nClone the repository and explore the codebase.`
        };
      }
    } else {
      // Create a basic template if AI is not available
      documentation.generatedReadme = {
        raw: `# ${project.projectName}\n\nThis is a generated README for ${project.projectName}.\n\n## Description\n\nThis project was analyzed from the repository: ${project.repoUrl}\n\n## Files\n\nThis project contains ${files.length} files.\n\n## Getting Started\n\nClone the repository and explore the codebase.`,
        markdown: `# ${project.projectName}\n\nThis is a generated README for ${project.projectName}.\n\n## Description\n\nThis project was analyzed from the repository: ${project.repoUrl}\n\n## Files\n\nThis project contains ${files.length} files.\n\n## Getting Started\n\nClone the repository and explore the codebase.`
      };
    }

    // Generate summary statistics
    const languages = {};
    const fileTypes = {};
    let totalSize = 0;
    
    files.forEach(file => {
      // Count languages
      if (file.language) {
        languages[file.language] = (languages[file.language] || 0) + 1;
      }
      
      // Count file types
      const ext = path.extname(file.path).toLowerCase();
      if (ext) {
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      }
      
      // Sum sizes
      totalSize += file.size || 0;
    });

    documentation.summary = {
      totalFiles: files.length,
      totalDirectories: countDirectories(documentation.structure),
      totalSize: totalSize,
      languages: languages,
      fileTypes: fileTypes,
      hasReadme: !!documentation.readme
    };

    console.log(`📚 Documentation generation complete. Final file count: ${documentation.files.length}`);
    console.log(`📊 Summary: ${documentation.summary.totalFiles} files, ${documentation.summary.totalDirectories} directories, ${Object.keys(languages).length} languages`);
    return documentation;
  } catch (error) {
    console.error('❌ Error generating documentation:', error);
    throw error;
  }
}

// Helper function to count directories in structure
function countDirectories(structure) {
  let count = 0;
  function countDirs(obj) {
    Object.values(obj).forEach(item => {
      if (item.type === 'directory') {
        count++;
        if (item.children) {
          countDirs(item.children);
        }
      }
    });
  }
  countDirs(structure);
  return count;
}

// Scan directory for files
async function scanDirectory(dirPath, basePath = '') {
  const files = [];
  
  try {
    console.log(`🔍 Scanning directory: ${dirPath} (base: ${basePath})`);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    console.log(`📁 Found ${entries.length} entries in ${dirPath}`);
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip common directories that don't need documentation
        if (['.git', 'node_modules', 'dist', 'build', '.next', '.vscode', '.idea', 'coverage'].includes(entry.name)) {
          console.log(`⏭️  Skipping directory: ${entry.name}`);
          continue;
        }
        
        console.log(`📂 Processing subdirectory: ${entry.name}`);
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, relativePath);
        console.log(`📂 Subdirectory ${entry.name} returned ${subFiles.length} files`);
        files.push(...subFiles);
      } else {
        // Analyze file
        console.log(`📄 Processing file: ${entry.name}`);
        const fileInfo = await analyzeFile(fullPath, relativePath);
        if (fileInfo) {
          console.log(`✅ File analyzed: ${entry.name} (${fileInfo.language}, ${fileInfo.size} bytes)`);
          files.push(fileInfo);
        } else {
          console.log(`❌ File skipped: ${entry.name}`);
        }
      }
    }
    
    console.log(`📊 Total files found in ${dirPath}: ${files.length}`);
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
  
  return files;
}

// Analyze individual file
async function analyzeFile(filePath, relativePath) {
  try {
    console.log(`🔍 Analyzing file: ${filePath}`);
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    console.log(`📊 File stats: ${relativePath} - Size: ${stats.size} bytes, Extension: ${ext}`);
    
    // Skip binary files and very large files
    if (stats.size > 1024 * 1024) { // 1MB limit
      console.log(`⏭️  Skipping large file: ${relativePath} (${stats.size} bytes > 1MB)`);
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
    
    console.log(`🏷️  File info created: ${relativePath} (${fileInfo.language})`);
    
    // Read file content for analysis
    try {
      const content = await fs.readFile(filePath, 'utf8');
      fileInfo.raw = content;
      console.log(`📖 File content read: ${relativePath} (${content.length} characters)`);
      
      // Basic analysis based on file type
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        fileInfo.functions = extractFunctions(content);
        fileInfo.classes = extractClasses(content);
        console.log(`🔧 Functions extracted: ${fileInfo.functions.length}, Classes: ${fileInfo.classes.length}`);
      }
      
      // Extract tokens for search
      fileInfo.tokens = extractTokens(content);
      console.log(`🔤 Tokens extracted: ${fileInfo.tokens.length}`);
      
    } catch (readError) {
      // File might be binary or encoded, skip content analysis
      console.warn(`⚠️  Could not read file content for ${filePath}:`, readError.message);
    }
    
    console.log(`✅ File analysis complete: ${relativePath}`);
    return fileInfo;
  } catch (error) {
    console.error(`❌ Error analyzing file ${filePath}:`, error);
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

// Build hierarchical file structure from flat files array
function buildFileStructure(files) {
  const structure = {};
  
  console.log(`🏗️  Building file structure from ${files.length} files...`);
  
  files.forEach((file, index) => {
    const pathParts = file.path.split('/');
    let currentLevel = structure;
    
    console.log(`📁 Processing file ${index + 1}: ${file.path} (${pathParts.length} path parts)`);
    
    // Navigate through the path parts
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLastPart = i === pathParts.length - 1;
      
      if (isLastPart) {
        // This is a file
        currentLevel[part] = {
          type: 'file',
          path: file.path,
          language: file.language,
          size: file.size,
          functions: file.functions || [],
          classes: file.classes || [],
          raw: file.raw
        };
        console.log(`📄 Added file: ${part} to level ${i}`);
      } else {
        // This is a directory
        if (!currentLevel[part]) {
          currentLevel[part] = {
            type: 'directory',
            children: {}
          };
          console.log(`📂 Created directory: ${part} at level ${i}`);
        } else if (currentLevel[part].type !== 'directory') {
          // If there's a file with the same name, convert it to a directory
          console.log(`🔄 Converting file ${part} to directory at level ${i}`);
          currentLevel[part] = {
            type: 'directory',
            children: {}
          };
        }
        currentLevel = currentLevel[part].children;
      }
    }
  });
  
  console.log(`✅ File structure built. Root items: ${Object.keys(structure).length}`);
  console.log(`📊 Structure preview:`, Object.keys(structure).slice(0, 5));
  
  return structure;
}

// Generate AI README using Gemini
async function generateAIReadme(files, project, mode) {
  console.log(`🤖 Starting AI README generation for project: ${project.projectName}`);
  console.log(`📊 Mode: ${mode}, Files count: ${files.length}`);
  
  if (!geminiAI || !AI_CONFIG) {
    console.log(`⚠️  AI not available - geminiAI: ${!!geminiAI}, AI_CONFIG: ${!!AI_CONFIG}`);
    return null;
  }

  try {
    console.log(`🤖 Using AI model: ${AI_CONFIG.model}`);
    const model = geminiAI.getGenerativeModel({ model: AI_CONFIG.model });
    
    // Prepare context for AI
    const fileSummary = files.slice(0, 20).map(file => 
      `${file.path} (${file.language}) - ${file.functions.length} functions, ${file.classes.length} classes`
    ).join('\n');
    
    console.log(`📝 File summary for AI (${fileSummary.length} characters):`);
    console.log(fileSummary);
    
    const prompt = mode === 'v1' 
      ? `Generate a comprehensive README.md for the project "${project.projectName}" with repository URL ${project.repoUrl}. 
         The project contains these files:\n${fileSummary}\n\nCreate a detailed README with sections for description, installation, usage, API documentation, and contributing guidelines.`
      : `Generate a beginner-friendly README.md for the project "${project.projectName}" with repository URL ${project.repoUrl}. 
         The project contains these files:\n${fileSummary}\n\nCreate a simple, clear README with basic sections for what the project does, how to install it, and how to use it.`;
    
    console.log(`📝 AI prompt length: ${prompt.length} characters`);
    console.log(`🤖 Sending request to Gemini AI...`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiReadme = response.text();
    
    console.log(`✅ AI README generated successfully!`);
    console.log(`📊 README length: ${aiReadme.length} characters`);
    console.log(`📄 README preview: ${aiReadme.substring(0, 200)}...`);
    
    return aiReadme;
    
  } catch (error) {
    console.error('❌ AI README generation failed:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
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
app.listen(PORT, async () => {
  console.log(`🚀 GitGen server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
  console.log(`📖 API info: http://localhost:${PORT}/api`);
  
  // Test file system operations
  try {
    await fs.mkdir('temp', { recursive: true });
    console.log('✅ Temp directory creation test passed');
  } catch (error) {
    console.error('❌ Temp directory creation test failed:', error.message);
  }
});
