import React, { useState } from 'react';
import { Plus, Trash2, Play, Clock, CheckCircle, AlertCircle, GitBranch } from 'lucide-react';
import { apiBaseUrl } from '../config';

const BatchProcessing = () => {
  const [repositories, setRepositories] = useState([
    { repoUrl: '', projectName: '', description: '' }
  ]);
  const [mode, setMode] = useState('v2');
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchId, setBatchId] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null);
  const [error, setError] = useState(null);

  const addRepository = () => {
    setRepositories([...repositories, { repoUrl: '', projectName: '', description: '' }]);
  };

  const removeRepository = (index) => {
    if (repositories.length > 1) {
      setRepositories(repositories.filter((_, i) => i !== index));
    }
  };

  const updateRepository = (index, field, value) => {
    const updated = [...repositories];
    updated[index][field] = value;
    setRepositories(updated);
  };

  const validateRepositories = () => {
    for (const repo of repositories) {
      if (!repo.repoUrl.trim()) {
        setError('Repository URL is required for all repositories');
        return false;
      }
      if (!repo.projectName.trim()) {
        setError('Project name is required for all repositories');
        return false;
      }
    }
    return true;
  };

  const startBatchProcessing = async () => {
    if (!validateRepositories()) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Extract project names from URLs if not provided
      const processedRepos = repositories.map(repo => {
        let projectName = repo.projectName;
        if (!projectName) {
          const urlParts = repo.repoUrl.split('/');
          projectName = urlParts[urlParts.length - 1]?.replace('.git', '') || 'Project';
        }
        return {
          ...repo,
          projectName
        };
      });

      const response = await fetch(`${apiBaseUrl}/api/projects/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositories: processedRepos,
          mode
        })
      });

      if (response.ok) {
        const data = await response.json();
        setBatchId(data.batchId);
        setBatchStatus({
          batchId: data.batchId,
          totalProjects: data.totalRepositories,
          completed: 0,
          processing: 0,
          queued: data.totalRepositories,
          failed: 0,
          projects: data.results
        });
        
        // Start monitoring batch status
        monitorBatchStatus(data.batchId);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to start batch processing');
      }
    } catch (error) {
      setError('Failed to start batch processing: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const monitorBatchStatus = async (id) => {
    const checkStatus = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/batch/${id}`);
        if (response.ok) {
          const status = await response.json();
          setBatchStatus(status);
          
          // Continue monitoring if not all projects are completed
          if (status.completed + status.failed < status.totalProjects) {
            setTimeout(checkStatus, 5000); // Check every 5 seconds
          }
        }
      } catch (error) {
        console.error('Error checking batch status:', error);
      }
    };
    
    checkStatus();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'queued':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'queued':
        return 'text-yellow-600 bg-yellow-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Batch Processing
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Process multiple repositories simultaneously. Up to 10 repositories can be processed in a single batch.
        </p>
      </div>

      {/* Mode Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          README Generation Mode
        </label>
        <div className="flex space-x-4">
          <label className="flex items-center">
            <input
              type="radio"
              value="v2"
              checked={mode === 'v2'}
              onChange={(e) => setMode(e.target.value)}
              className="mr-2"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Beginner-friendly (v2)</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="v1"
              checked={mode === 'v1'}
              onChange={(e) => setMode(e.target.value)}
              className="mr-2"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Comprehensive (v1)</span>
          </label>
        </div>
      </div>

      {/* Repository List */}
      <div className="space-y-4 mb-6">
        {repositories.map((repo, index) => (
          <div key={index} className="flex items-start space-x-4 p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Repository URL *
                </label>
                <input
                  type="text"
                  value={repo.repoUrl}
                  onChange={(e) => updateRepository(index, 'repoUrl', e.target.value)}
                  placeholder="https://github.com/username/repository.git"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={repo.projectName}
                  onChange={(e) => updateRepository(index, 'projectName', e.target.value)}
                  placeholder="My Awesome Project"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={repo.description}
                  onChange={(e) => updateRepository(index, 'description', e.target.value)}
                  placeholder="Brief description of your project..."
                  rows="2"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            
            <button
              onClick={() => removeRepository(index)}
              disabled={repositories.length === 1}
              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Remove repository"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Repository Button */}
      <div className="mb-6">
        <button
          onClick={addRepository}
          disabled={repositories.length >= 10}
          className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Repository
        </button>
        <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
          {repositories.length}/10 repositories
        </span>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center space-x-2 text-red-800 dark:text-red-200">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Start Processing Button */}
      <div className="mb-6">
        <button
          onClick={startBatchProcessing}
          disabled={isProcessing || repositories.length === 0}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {isProcessing ? (
            <>
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Starting Batch Processing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2 inline" />
              Start Batch Processing ({repositories.length} repositories)
            </>
          )}
        </button>
      </div>

      {/* Batch Status */}
      {batchStatus && (
        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">
              Batch Status
            </h4>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ID: {batchStatus.batchId}
            </span>
          </div>
          
          {/* Progress Summary */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{batchStatus.totalProjects}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{batchStatus.completed}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Completed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{batchStatus.processing + batchStatus.queued}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">In Progress</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{batchStatus.failed}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
            </div>
          </div>

          {/* Individual Project Status */}
          <div className="space-y-2">
            {batchStatus.projects.map((project, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(project.status)}
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {project.projectName}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {project.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                    </div>
                  </div>
                </div>
                
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                  {project.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchProcessing;