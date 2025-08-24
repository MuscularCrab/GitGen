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
      lines: content.split('\n').length
    };
    
    // Generate content summary based on file type
    if (['.js', '.ts', '.jsx', '.tsx'].includes(extension)) {
      summary.type = 'javascript';
      summary.functions = extractFunctions(content);
      summary.classes = extractClasses(content);
    } else if (['.py'].includes(extension)) {
      summary.type = 'python';
      summary.functions = extractPythonFunctions(content);
      summary.classes = extractPythonClasses(content);
    } else if (['.md', '.txt'].includes(extension)) {
      summary.type = 'markdown';
      summary.content = marked.parse(content.substring(0, 500) + '...');
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
    const readmeContent = generateReadmeContent(documentation, packageInfo, mainFile);
    
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
function generateReadmeContent(documentation, packageInfo, mainFile) {
  const projectName = packageInfo?.name || 'Project';
  const description = packageInfo?.description || 'A software project';
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
  if (packageInfo && packageInfo.scripts && packageInfo.scripts.install) {
    readme += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
  } else {
    readme += `\`\`\`bash\n# Clone the repository\ngit clone <repository-url>\ncd ${projectName}\n\`\`\`\n\n`;
  }
  
  // Usage
  readme += `## Usage\n\n`;
  if (packageInfo && packageInfo.scripts && packageInfo.scripts.start) {
    readme += `\`\`\`bash\nnpm start\n\`\`\`\n\n`;
  } else {
    readme += `\`\`\`bash\n# Run the application\nnode ${mainFile}\n\`\`\`\n\n`;
  }
  
  // Features
  readme += `## Features\n\n`;
  if (documentation.files.length > 0) {
    const languages = Object.keys(documentation.summary.languages || {});
    readme += `- **Multi-language support**: ${languages.join(', ')}\n`;
    readme += `- **${documentation.summary.totalFiles} source files**\n`;
    readme += `- **${documentation.summary.totalDirectories} directories**\n`;
  }
  readme += `- Modern architecture\n`;
  readme += `- Easy to use\n\n`;
  
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