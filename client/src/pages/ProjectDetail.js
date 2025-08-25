import React, { useEffect, useState } from 'react';
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

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { currentProject, loading, error, loadProject } = useProjects();
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedFiles, setExpandedFiles] = useState(new Set());

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId, loadProject]);

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
          <Clock className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
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
              <Clock className="w-8 h-8 text-blue-600 animate-pulse" />
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