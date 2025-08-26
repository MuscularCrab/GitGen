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
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import Loader from '../components/Loader';

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { currentProject, loading, error, loadProject } = useProjects();
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [structureSearch, setStructureSearch] = useState('');

  // Auto-expand folders when searching to show results
  useEffect(() => {
    if (structureSearch && currentProject?.documentation?.structure) {
      const searchPaths = new Set();
      const findSearchPaths = (struct, currentPath = '') => {
        Object.entries(struct).forEach(([name, item]) => {
          const fullPath = currentPath ? `${currentPath}/${name}` : name;
          if (fullPath.toLowerCase().includes(structureSearch.toLowerCase()) ||
              name.toLowerCase().includes(structureSearch.toLowerCase())) {
            // Add this path and all parent paths
            let parentPath = currentPath;
            while (parentPath) {
              searchPaths.add(parentPath);
              const lastSlash = parentPath.lastIndexOf('/');
              parentPath = lastSlash > 0 ? parentPath.substring(0, lastSlash) : '';
            }
          }
          if (item.type === 'directory' && item.children) {
            findSearchPaths(item.children, fullPath);
          }
        });
      };
      
      findSearchPaths(currentProject.documentation.structure);
      setExpandedFiles(prev => new Set([...prev, ...searchPaths]));
    }
  }, [structureSearch, currentProject?.documentation?.structure]);

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId, loadProject]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.export-dropdown')) {
        setShowExportDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportDropdown]);

  // Handle export functionality
  const handleExport = async (type = 'readme') => {
    if (!currentProject?.documentation) {
      alert('No documentation available to export');
      return;
    }

    setIsExporting(true);
    try {
      let content, filename, contentType;
      
      switch (type) {
        case 'readme':
          if (!currentProject.documentation.generatedReadme) {
            alert('No README available to export');
            return;
          }
          content = currentProject.documentation.generatedReadme.raw;
          filename = `${currentProject.projectName}-README.md`;
          contentType = 'text/markdown';
          break;
          
        case 'summary':
          if (!currentProject.documentation.summary) {
            alert('No project summary available to export');
            return;
          }
          content = JSON.stringify(currentProject.documentation.summary, null, 2);
          filename = `${currentProject.projectName}-summary.json`;
          contentType = 'application/json';
          break;
          
        case 'structure':
          if (!currentProject.documentation.structure) {
            alert('No project structure available to export');
            return;
          }
          content = JSON.stringify(currentProject.documentation.structure, null, 2);
          filename = `${currentProject.projectName}-structure.json`;
          contentType = 'application/json';
          break;
          
        case 'files':
          if (!currentProject.documentation.files) {
            alert('No file analysis available to export');
            return;
          }
          content = JSON.stringify(currentProject.documentation.files, null, 2);
          filename = `${currentProject.projectName}-files.json`;
          contentType = 'application/json';
          break;
          
        default:
          alert('Invalid export type');
          return;
      }
      
      // Create and download file
      const blob = new Blob([content], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      // Close dropdown after export
      setShowExportDropdown(false);
      
      // Show success message
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
      notification.innerHTML = `
        <div class="flex items-center space-x-2">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
          </svg>
          <span>${filename} exported successfully!</span>
          <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">×</button>
        </div>
      `;
      document.body.appendChild(notification);
      
      // Remove notification after 3 seconds
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 3000);
      
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle share functionality
  const handleShare = async () => {
    if (!currentProject?.documentation?.generatedReadme) {
      alert('No documentation available to share');
      return;
    }

    try {
      // Try to use native Web Share API if available
      if (navigator.share) {
        await navigator.share({
          title: `${currentProject.projectName} Documentation`,
          text: `Check out the documentation for ${currentProject.projectName}`,
          url: window.location.href
        });
      } else {
        // Fallback: copy URL to clipboard
        await navigator.clipboard.writeText(window.location.href);
        
        // Show success message
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-blue-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        notification.innerHTML = `
          <div class="flex items-center space-x-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
            </svg>
            <span>Project URL copied to clipboard!</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">×</button>
          </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 3000);
      }
    } catch (error) {
      console.error('Share error:', error);
      // Fallback: copy URL to clipboard
      try {
        await navigator.clipboard.writeText(window.location.href);
        // Show success message
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-blue-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        notification.innerHTML = `
          <div class="flex items-center space-x-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
            </svg>
            <span>Project URL copied to clipboard!</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">×</button>
          </div>
        `;
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 3000);
      } catch (clipboardError) {
        console.error('Clipboard error:', clipboardError);
        alert('Failed to share. Please copy the URL manually.');
      }
    }
  };

  // Handle copying project URL to clipboard
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      alert('Project URL copied to clipboard!');
    } catch (error) {
      console.error('Copy error:', error);
      alert('Failed to copy URL. Please copy it manually.');
    }
  };



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
    if (!structure || Object.keys(structure).length === 0) {
      return (
        <div className="text-gray-500 italic py-2">
          No files or directories found
        </div>
      );
    }

    // Filter items based on search
    const filteredEntries = Object.entries(structure).filter(([name, item]) => {
      if (!structureSearch) return true;
      const fullPath = path ? `${path}/${name}` : name;
      return fullPath.toLowerCase().includes(structureSearch.toLowerCase()) ||
             name.toLowerCase().includes(structureSearch.toLowerCase());
    });

    if (filteredEntries.length === 0) {
      return (
        <div className="text-gray-500 italic py-2">
          No items match your search: "{structureSearch}"
        </div>
      );
    }

    return filteredEntries.map(([name, item]) => {
      const fullPath = path ? `${path}/${name}` : name;
      const isExpanded = expandedFiles.has(fullPath);
      
      if (item.type === 'directory') {
        // Count files and subdirectories in this directory
        const childItems = item.children || {};
        const fileCount = Object.values(childItems).filter(child => child.type === 'file').length;
        const dirCount = Object.values(childItems).filter(child => child.type === 'directory').length;
        const totalItems = fileCount + dirCount;
        
        return (
          <div key={fullPath} className="border-l border-gray-200 ml-4">
            <button
              onClick={() => toggleFileExpansion(fullPath)}
              className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 py-2 px-2 w-full text-left rounded hover:bg-gray-50 transition-colors"
            >
              {/* Expand/collapse indicator */}
              <div className="w-4 h-4 flex items-center justify-center">
                {isExpanded ? (
                  <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
              
              {/* Folder icon */}
              <Folder className={`w-4 h-4 ${isExpanded ? 'text-blue-600' : 'text-blue-500'}`} />
              
              {/* Folder name */}
              <span className={`font-medium ${isExpanded ? 'text-blue-700' : 'text-gray-700'}`}>
                {name}
              </span>
              
              {/* Item count badge */}
              <span className="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                {totalItems} item{totalItems !== 1 ? 's' : ''}
              </span>
              
              {/* Directory indicator */}
              <span className="text-gray-400 text-xs">/</span>
            </button>
            
            {/* Expanded content with better visual hierarchy */}
            {isExpanded && item.children && (
              <div className="ml-4 mt-1">
                {renderFileTree(item.children, fullPath)}
              </div>
            )}
          </div>
        );
      } else {
        // File item with enhanced display
        const fileSize = item.size ? Math.round(item.size / 1024) : 0;
        const fileExtension = name.split('.').pop()?.toLowerCase();
        
        // Get appropriate icon based on file type
        const getFileIcon = (ext) => {
          const iconClass = "w-4 h-4";
          switch (ext) {
            case 'js':
            case 'ts':
            case 'jsx':
            case 'tsx':
              return <Code className={`${iconClass} text-yellow-500`} />;
            case 'css':
            case 'scss':
            case 'sass':
              return <Code className={`${iconClass} text-pink-500`} />;
            case 'html':
            case 'htm':
              return <Code className={`${iconClass} text-orange-500`} />;
            case 'json':
            case 'xml':
            case 'yaml':
            case 'yml':
              return <Code className={`${iconClass} text-purple-500`} />;
            case 'md':
            case 'txt':
              return <FileText className={`${iconClass} text-gray-500`} />;
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'svg':
              return <FileText className={`${iconClass} text-green-500`} />;
            default:
              return <FileText className={`${iconClass} text-gray-400`} />;
          }
        };
        
        return (
          <div key={fullPath} className="ml-4 py-1 px-2 hover:bg-gray-50 rounded transition-colors">
            <div className="flex items-center space-x-2">
              {/* File icon */}
              {getFileIcon(fileExtension)}
              
              {/* File name */}
              <span className="text-gray-700 font-mono text-sm">{name}</span>
              
              {/* File size */}
              {fileSize > 0 && (
                <span className="text-xs text-gray-500 ml-auto">
                  {fileSize}KB
                </span>
              )}
            </div>
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
            
            {/* Mode Information */}
            {currentProject.mode && (
              <div className="flex items-center space-x-2 text-gray-600 mt-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  currentProject.mode === 'v2' 
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                }`}>
                  {currentProject.mode === 'v2' ? 'v2 - Beginner-Friendly' : 'v1 - Comprehensive'}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Export Dropdown */}
          <div className="relative export-dropdown">
            <button 
              onClick={() => setShowExportDropdown(!showExportDropdown)}
              disabled={!currentProject?.documentation || isExporting}
              className="btn-secondary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <div className="loader w-4 h-4"></div>
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>{isExporting ? 'Exporting...' : 'Export'}</span>
              {!isExporting && <ChevronDown className="w-4 h-4" />}
            </button>
            
            {/* Export Dropdown Menu */}
            {showExportDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                <div className="py-1">
                  <button
                    onClick={() => handleExport('readme')}
                    disabled={!currentProject?.documentation?.generatedReadme || isExporting}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <FileText className="w-4 h-4" />
                    <span>README.md</span>
                  </button>
                  <button
                    onClick={() => handleExport('summary')}
                    disabled={!currentProject?.documentation?.summary || isExporting}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Project Summary</span>
                  </button>
                  <button
                    onClick={() => handleExport('structure')}
                    disabled={!currentProject?.documentation?.structure || isExporting}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Folder className="w-4 h-4" />
                    <span>Project Structure</span>
                  </button>
                  <button
                    onClick={() => handleExport('files')}
                    disabled={!currentProject?.documentation?.files || isExporting}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Code className="w-4 h-4" />
                    <span>File Analysis</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <button 
            onClick={handleShare}
            disabled={!currentProject?.documentation?.generatedReadme}
            className="btn-primary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
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
          
          {/* Progress Percentage Display */}
          {progress?.percentage !== undefined && (
            <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 mb-2">
                  {progress.percentage}%
                </div>
                <div className="text-sm text-blue-700 mb-3">
                  <strong>Processing Progress</strong>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-blue-200 rounded-full h-3 mb-3">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.percentage}%` }}
                  ></div>
                </div>
                
                {/* Current Step Info */}
                <div className="text-xs text-blue-600">
                  {progress.message || 'Processing...'}
                </div>
              </div>
            </div>
          )}
          
          {/* Repository Metrics (when available) */}
          {progress?.repoMetrics && (
            <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <h4 className="text-sm font-medium text-purple-800 mb-2">Repository Analysis</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">{progress.repoMetrics.totalFiles}</div>
                  <div className="text-purple-700">Files</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">{progress.repoMetrics.totalDirectories}</div>
                  <div className="text-purple-700">Directories</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {progress.repoMetrics.totalSize ? `${Math.round(progress.repoMetrics.totalSize / (1024 * 1024))}MB` : 'N/A'}
                  </div>
                  <div className="text-purple-700">Size</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">{progress.repoMetrics.languages?.length || 0}</div>
                  <div className="text-purple-700">Languages</div>
                </div>
              </div>
              {progress.repoMetrics.languages && progress.repoMetrics.languages.length > 0 && (
                <div className="mt-2 text-xs text-purple-700">
                  <strong>Languages detected:</strong> {progress.repoMetrics.languages.join(', ')}
                </div>
              )}
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Repository Structure</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    // Expand all folders
                    const allPaths = new Set();
                    const expandAll = (struct, currentPath = '') => {
                      Object.entries(struct).forEach(([name, item]) => {
                        const fullPath = currentPath ? `${currentPath}/${name}` : name;
                        if (item.type === 'directory') {
                          allPaths.add(fullPath);
                          if (item.children) {
                            expandAll(item.children, fullPath);
                          }
                        }
                      });
                    };
                    if (currentProject.documentation?.structure) {
                      expandAll(currentProject.documentation.structure);
                      setExpandedFiles(allPaths);
                    }
                  }}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedFiles(new Set())}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Collapse All
                </button>
              </div>
            </div>
            
            {/* Search and Structure info */}
            {currentProject.documentation?.structure && (
              <div className="space-y-4 mb-4">
                {/* Search input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search files and folders..."
                    value={structureSearch}
                    onChange={(e) => setStructureSearch(e.target.value)}
                    className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {structureSearch && (
                    <button
                      onClick={() => setStructureSearch('')}
                      className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 hover:text-gray-600"
                    >
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                
                {/* Structure info */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-2 text-sm text-blue-800 mb-2">
                    <Folder className="w-4 h-4" />
                    <span className="font-medium">Structure Overview</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-blue-600">
                        {Object.keys(currentProject.documentation.structure).length}
                      </div>
                      <div className="text-blue-700">Root Items</div>
                    </div>
                                         <div className="text-center">
                       <div className="text-lg font-semibold text-blue-600">
                         {(() => {
                           let dirCount = 0;
                           function countDirs(structure) {
                             Object.values(structure).forEach(item => {
                               if (item.type === 'directory') {
                                 dirCount++;
                                 if (item.children) countDirs(item.children);
                               }
                             });
                           }
                           countDirs(currentProject.documentation.structure);
                           return dirCount;
                         })()}
                       </div>
                       <div className="text-blue-700">Directories</div>
                     </div>
                     <div className="text-center">
                       <div className="text-lg font-semibold text-blue-600">
                         {(() => {
                           let fileCount = 0;
                           function countFiles(structure) {
                             Object.values(structure).forEach(item => {
                               if (item.type === 'file') {
                                 fileCount++;
                               } else if (item.type === 'directory' && item.children) {
                                 countFiles(item.children);
                               }
                             });
                           }
                           countFiles(currentProject.documentation.structure);
                           return fileCount;
                         })()}
                       </div>
                       <div className="text-blue-700">Files</div>
                     </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-blue-600">
                        {expandedFiles.size}
                      </div>
                      <div className="text-blue-700">Expanded</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* File tree */}
            <div className="font-mono text-sm">
              {currentProject.documentation?.structure ? (
                <div>
                  {/* Breadcrumb navigation */}
                  {structureSearch && (
                    <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-center space-x-2 text-sm text-yellow-800">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <span>Search results for: <strong>"{structureSearch}"</strong></span>
                        <span className="text-yellow-600">•</span>
                        <span>Folders auto-expanded to show results</span>
                      </div>
                    </div>
                  )}
                  
                  {/* Tree structure */}
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    {renderFileTree(currentProject.documentation.structure)}
                  </div>
                  
                  {/* Empty state when no search results */}
                  {structureSearch && (
                    <div className="mt-4 text-center text-sm text-gray-500">
                      <p>Use the search above to find specific files or folders</p>
                      <p>Click on folder names to expand/collapse them</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Folder className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No file structure available</p>
                  <p className="text-sm mt-2">
                    {currentProject.status === 'processing' 
                      ? 'File structure will be available once processing is complete.'
                      : 'File structure could not be generated for this project.'}
                  </p>
                </div>
              )}
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
                <p className="text-sm mt-2">
                  {currentProject.status === 'processing' 
                    ? 'This will appear once the project analysis is complete. Please wait for processing to finish.'
                    : currentProject.status === 'failed'
                    ? 'Documentation generation failed. Please try regenerating the project.'
                    : 'This will appear once the project analysis is complete.'}
                </p>
                {currentProject.status === 'processing' && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Status:</strong> {currentProject.status} - The project is currently being processed.
                    </p>
                  </div>
                )}
                {currentProject.status === 'failed' && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">
                      <strong>Error:</strong> {currentProject.error || 'Unknown error occurred during processing.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Footer */}
      <footer className="mt-16 py-8 border-t border-gray-200 dark:border-gray-700">
        <div className="text-center">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Powered by Ventris Labs
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Advanced AI solutions for modern development workflows
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-6 text-sm text-gray-500 dark:text-gray-400">
            <span>© 2025 Ventris Labs. All rights reserved.</span>
            <span>•</span>
            <span>Built with React & Node.js</span>
            <span>•</span>
            <span>AI-powered by Gemini</span>
          </div>
          <div className="mt-4">
            <a 
              href="https://ventrislabs.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-200"
            >
              Visit Ventris Labs →
            </a>
          </div>
        </div>
      </footer>
      
    </div>
  );
};

export default ProjectDetail;