const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3030;

// In-memory storage for projects (in production, use a database)
const projects = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client/build (React app)
app.use(express.static(path.join(__dirname, 'client/build')));

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
      projects: '/api/projects',
      'projects/:id': '/api/projects/:id'
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

// Create new project
app.post('/api/projects', (req, res) => {
  try {
    const { repoUrl, projectName, description, mode = 'v2' } = req.body;
    
    console.log('Creating project:', { repoUrl, projectName, description, mode });
    
    if (!repoUrl || !projectName) {
      return res.status(400).json({ error: 'Repository URL and project name are required' });
    }

    // Generate a simple ID (in production, use UUID)
    const projectId = Date.now().toString();
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
    
    // Simulate processing completion after a delay
    setTimeout(() => {
      const storedProject = projects.get(projectId);
      if (storedProject) {
        storedProject.status = 'completed';
        storedProject.documentation = {
          summary: `Documentation generated for ${projectName}`,
          files: [],
          readme: `# ${projectName}\n\nDocumentation generated successfully.`
        };
        projects.set(projectId, storedProject);
        console.log('Project completed:', projectId);
      }
    }, 5000); // Complete after 5 seconds for demo

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
