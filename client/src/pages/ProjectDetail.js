import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjects } from '../context/ProjectContext';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { 
  BookOpen, 
  GitBranch, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  ArrowLeft,
  FileText,
  Folder,
  Code,
  Download,
  Share2,
  ExternalLink
} from 'lucide-react';
import Loader from '../components/Loader';

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { currentProject, loading, error, loadProject } = useProjects();
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId, loadProject]);

  // Fetch progress updates when processing
  const fetchProgress = useCallback(async () => {
    if (currentProject?.status === 'processing') {
      try {
        const response = await fetch(`/api/projects/${projectId}/progress`);
        if (response.ok) {
          const progressData = await response.json();
          setProgress(progressData);
        }
      } catch (error) {
        console.error('Failed to fetch progress:', error);
      }
    }
  }, [currentProject?.status, projectId]);

  // Fetch progress updates when processing (no auto-refresh)
  useEffect(() => {
    if (currentProject?.status === 'processing') {
      // Fetch progress immediately
      fetchProgress();
      
      // Only fetch progress updates, don't refresh the entire project
      const progressInterval = setInterval(() => {
        console.log('Fetching progress updates...');
        fetchProgress();
      }, 2000);
      
      return () => {
        clearInterval(progressInterval);
      };
    } else {
      // Clear progress when not processing
      setProgress(null);
    }
  }, [currentProject?.status, projectId, fetchProgress]);

  // Show completion notification and reload project
  useEffect(() => {
    if (currentProject?.status === 'completed') {
      // Show a brief notification that processing is complete
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
      notification.innerHTML = `
        <div class="flex items-center space-x-2">
          <svg class="w-5 h-2" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
          </svg>
          <span>Documentation generation completed!</span>
          <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">×</button>
        </div>
      `;
      document.body.appendChild(notification);
      
      // Reload the project to show final results
      setTimeout(() => {
        loadProject(projectId);
      }, 1000);
      
      // Remove notification after 5 seconds
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 5000);
    }
  }, [currentProject?.status, projectId, loadProject]);

  const toggleFileExpansion = (filePath) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
    } else {
      newExpanded.add(filePath);
    }
    setExpandedFiles(newExpanded);
  };

  const renderFileTree = (structure, path = '') => {
    return Object.entries(structure).map(([name, item]) => {
      const fullPath = path ? `${path}/${name}` : name;
      const isExpanded = expandedFiles.has(fullPath);
      
      if (item.type === 'directory') {
        return (
          <div key={fullPath} className="ml-4">
            <button
              onClick={() => toggleFileExpansion(fullPath)}
              className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 py-1 w-full text-left"
            >
              <Folder className="w-4 h-4 text-blue-500" />
              <span className="font-medium">{name}</span>
              <span className="text-gray-400">/</span>
            </button>
            {isExpanded && item.children && (
              <div className="ml-4">
                {renderFileTree(item.children, fullPath)}
              </div>
            )}
          </div>
        );
      } else {
        return (
          <div key={fullPath} className="ml-4 flex items-center space-x-2 py-1">
            <FileText className="w-4 h-4 text-green-500" />
            <span className="text-gray-600">{name}</span>
            <span className="text-xs text-gray-400">
              ({Math.round(item.size / 1024)}KB)
            </span>
          </div>
        );
      }
    });
  };

  const renderFileDetails = (files) => {
    return files.map((file) => (
      <div key={file.path} className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Code className="w-5 h-5 text-primary-600" />
            <span className="font-mono text-sm">{file.path}</span>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span>{file.lines} lines</span>
            <span>•</span>
            <span>{Math.round(file.size / 1024)}KB</span>
          </div>
        </div>
        
        {file.functions && file.functions.length > 0 && (
          <div className="mb-3">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Functions:</h4>
            <div className="flex flex-wrap gap-2">
              {file.functions.map((func, index) => (
                <span key={index} className="badge badge-info text-xs">
                  {func}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {file.classes && file.classes.length > 0 && (
          <div className="mb-3">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Classes:</h4>
            <div className="flex flex-wrap gap-2">
              {file.classes.map((cls, index) => (
                <span key={index} className="badge badge-info text-xs">
                  {cls}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    ));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <Loader size="default" className="mx-auto mb-4" />
          <p className="text-gray-600">Loading project...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50">
        <div className="flex items-center space-x-2 text-red-800">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-600">Project not found</p>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', name: 'Overview', icon: BookOpen },
    { id: 'structure', name: 'File Structure', icon: Folder },
    { id: 'files', name: 'File Details', icon: FileText },
    { id: 'readme', name: 'Original README', icon: FileText },
    { id: 'generated', name: 'Generated README', icon: BookOpen }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/projects"
            className="btn-secondary inline-flex items-center space-x-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Projects</span>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {currentProject.projectName}
            </h1>
            <div className="flex items-center space-x-2 text-gray-600 mt-1">
              <GitBranch className="w-4 h-4" />
              <span className="font-mono text-sm">
                {currentProject.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button className="btn-secondary inline-flex items-center space-x-2">
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button className="btn-primary inline-flex items-center space-x-2">
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        </div>
      </div>

      {/* Project Status */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
                         {currentProject.status === 'completed' ? (
               <CheckCircle className="w-8 h-8 text-green-600" />
             ) : currentProject.status === 'processing' ? (
               <Loader size="small" />
             ) : (
               <AlertCircle className="w-8 h-8 text-red-600" />
             )}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Status: {currentProject.status.charAt(0).toUpperCase() + currentProject.status.slice(1)}
              </h3>
              <p className="text-gray-600">
                {currentProject.status === 'completed' 
                  ? 'Documentation generated successfully'
                  : currentProject.status === 'processing'
                  ? 'Analyzing repository and generating documentation...'
                  : 'Failed to generate documentation'
                }
              </p>
            </div>
          </div>
          
          {currentProject.description && (
            <div className="text-right">
              <p className="text-sm text-gray-500">Description</p>
              <p className="text-gray-700">{currentProject.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar for Processing Status */}
      {currentProject.status === 'processing' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Processing Progress</h3>
                         <div className="flex items-center space-x-2 text-sm text-gray-600">
               <Loader size="small" />
               <span>{progress?.message || 'Processing...'}</span>
             </div>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-3 mb-3 relative overflow-hidden">
            <div 
              className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress?.percentage || 0}%` }}
            ></div>
            {/* Animated progress indicator */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse"></div>
          </div>
          
          {/* Progress Info */}
          <div className="flex justify-between items-center mb-4 text-sm">
            <span className="text-gray-600">
              Step {progress?.step || 0} of {progress?.totalSteps || 6}
            </span>
            <span className="text-blue-600 font-medium">
              {progress?.percentage || 0}% Complete
            </span>
          </div>
          
          {/* Progress Stages */}
          <div className="grid grid-cols-6 gap-2 text-xs text-gray-600 mb-4">
            {[
              { step: 1, name: 'Init', key: 'initializing' },
              { step: 2, name: 'Temp', key: 'creating_temp' },
              { step: 3, name: 'Clone', key: 'cloning' },
              { step: 4, name: 'Analyze', key: 'analyzing' },
              { step: 5, name: 'Generate', key: 'generating' },
              { step: 6, name: 'Complete', key: 'finalizing' }
            ].map((stage) => (
              <div key={stage.key} className="text-center">
                <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${
                  progress?.step >= stage.step ? 'bg-blue-600' : 'bg-gray-300'
                }`}></div>
                <span className={progress?.step >= stage.step ? 'font-medium text-blue-600' : ''}>
                  {stage.name}
                </span>
              </div>
            ))}
          </div>
          
          {/* ETA and Status */}
          {progress?.estimatedTime && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-800">
                  <strong>Estimated Time Remaining:</strong> ~{progress.estimatedTime} seconds
                </span>
                <span className="text-xs text-green-600">
                  {progress.estimatedTime < 60 ? `${progress.estimatedTime}s` : `${Math.round(progress.estimatedTime / 60)}m ${progress.estimatedTime % 60}s`}
                </span>
              </div>
            </div>
          )}
          
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Current Step:</strong> {progress?.message || 'Initializing...'}
            </p>
            <div className="mt-3 flex justify-between items-center">
              <span className="text-xs text-blue-700">
                Auto-refreshing every 2 seconds...
              </span>
              <button
                onClick={async () => {
                  console.log('Manual refresh requested');
                  setIsRefreshing(true);
                  try {
                    await loadProject(projectId);
                    await fetchProgress();
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
                className="btn-secondary text-xs px-3 py-1 disabled:opacity-50"
              >
                                 {isRefreshing ? <Loader size="small" className="w-3 h-3 mr-1 inline" /> : <Clock className="w-3 h-3 mr-1 inline" />}
                 {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {currentProject.documentation?.summary && (
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="card text-center">
                  <div className="text-3xl font-bold text-primary-600">
                    {currentProject.documentation.summary.totalFiles}
                  </div>
                  <div className="text-gray-600">Total Files</div>
                </div>
                <div className="card text-center">
                  <div className="text-3xl font-bold text-primary-600">
                    {currentProject.documentation.summary.totalDirectories}
                  </div>
                  <div className="text-gray-600">Directories</div>
                </div>
                <div className="card text-center">
                  <div className="text-3xl font-bold text-primary-600">
                    {Object.keys(currentProject.documentation.summary.languages || {}).length}
                  </div>
                  <div className="text-gray-600">Languages</div>
                </div>
                <div className="card text-center">
                  <div className="text-3xl font-bold text-primary-600">
                    {currentProject.documentation.summary.hasReadme ? 'Yes' : 'No'}
                  </div>
                  <div className="text-gray-600">README</div>
                </div>
              </div>
            )}

            {currentProject.documentation?.summary?.languages && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Languages Used</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(currentProject.documentation.summary.languages).map(([lang, count]) => (
                    <div key={lang} className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-lg font-semibold text-primary-600">{count}</div>
                      <div className="text-sm text-gray-600 capitalize">{lang}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentProject.documentation?.summary?.fileTypes && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">File Types</h3>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  {Object.entries(currentProject.documentation.summary.fileTypes).map(([ext, count]) => (
                    <div key={ext} className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-lg font-semibold text-primary-600">{count}</div>
                      <div className="text-sm text-gray-600 font-mono">{ext}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'structure' && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Repository Structure</h3>
            <div className="font-mono text-sm">
              {currentProject.documentation?.structure && 
                renderFileTree(currentProject.documentation.structure)
              }
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">File Analysis</h3>
            {currentProject.documentation?.files && 
              renderFileDetails(currentProject.documentation.files)
            }
          </div>
        )}

        {activeTab === 'readme' && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Original README</h3>
            {currentProject.documentation?.readme ? (
              <div>
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <strong>Path:</strong> {currentProject.documentation.readme.path}
                  </p>
                </div>
                <MarkdownRenderer content={currentProject.documentation.readme.content} />
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>No README file found in this repository</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'generated' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Generated README</h3>
              {currentProject.documentation?.generatedReadme && (
                <a
                  href={`/api/projects/${projectId}/readme`}
                  download
                  className="btn-primary inline-flex items-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download README.md</span>
                </a>
              )}
            </div>
            
            {currentProject.documentation?.generatedReadme ? (
              <div>
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    <strong>✨ New README Generated!</strong> This is a brand new README file created specifically for your project based on code analysis.
                  </p>
                </div>
                <div className="border rounded-lg p-6 bg-gray-50">
                  <MarkdownRenderer content={currentProject.documentation.generatedReadme.markdown} />
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>Generated README not available yet</p>
                <p className="text-sm mt-2">This will appear once the project analysis is complete.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDetail;