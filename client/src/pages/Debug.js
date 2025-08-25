import React from 'react';
import { apiBaseUrl } from '../config';
import { 
  TestTube, 
  Activity, 
  GitBranch, 
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  XCircle
} from 'lucide-react';

const Debug = () => {
  const [testResults, setTestResults] = React.useState({});

  const runTest = async (testName, testFunction) => {
    try {
      setTestResults(prev => ({ ...prev, [testName]: { status: 'running', message: 'Testing...' } }));
      
      const result = await testFunction();
      
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { status: 'success', message: result } 
      }));
    } catch (error) {
      setTestResults(prev => ({ 
        ...prev, 
        [testName]: { status: 'error', message: error.message } 
      }));
    }
  };

  const testAPI = async () => {
    const response = await fetch(`${apiBaseUrl}/api/test`);
    const data = await response.json();
    return `API is working! Response: ${JSON.stringify(data)}`;
  };

  const testHealth = async () => {
    const response = await fetch(`${apiBaseUrl}/api/health`);
    const data = await response.json();
    return `Health check passed! Response: ${JSON.stringify(data)}`;
  };

  const testGit = async () => {
    const response = await fetch(`${apiBaseUrl}/api/test-git`);
    const data = await response.json();
    return `Git test response: ${JSON.stringify(data)}`;
  };

  const testProjectCreation = async () => {
    const testData = {
      repoUrl: 'https://github.com/test/test',
      projectName: 'Test Project',
      description: 'This is a test project'
    };
    const response = await fetch(`${apiBaseUrl}/api/test-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    const data = await response.json();
    return `Test project created! Response: ${JSON.stringify(data)}`;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Activity className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'running':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4 flex items-center justify-center space-x-3">
          <TestTube className="w-10 h-10 text-blue-600" />
          <span>Debug & Testing</span>
        </h1>
        <p className="text-xl text-gray-600">
          Test API connections and backend functionality
        </p>
      </div>

      <div className="grid gap-6">
        {/* API Connection Test */}
        <div className="card">
          <div className="flex items-center space-x-3 mb-4">
            <Activity className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">API Connection Test</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Test basic API connectivity and response
          </p>
          <button
            onClick={() => runTest('api', testAPI)}
            className="btn-primary"
            disabled={testResults.api?.status === 'running'}
          >
            Test API
          </button>
          {testResults.api && (
            <div className={`mt-4 p-4 rounded-lg border ${getStatusColor(testResults.api.status)}`}>
              <div className="flex items-center space-x-2">
                {getStatusIcon(testResults.api.status)}
                <span className="font-medium">
                  {testResults.api.status === 'success' ? 'Success' : 
                   testResults.api.status === 'error' ? 'Error' : 'Running'}
                </span>
              </div>
              <p className="mt-2 text-sm">{testResults.api.message}</p>
            </div>
          )}
        </div>

        {/* Health Check Test */}
        <div className="card">
          <div className="flex items-center space-x-3 mb-4">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-900">Health Check</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Test backend health and status endpoints
          </p>
          <button
            onClick={() => runTest('health', testHealth)}
            className="btn-primary"
            disabled={testResults.health?.status === 'running'}
          >
            Health Check
          </button>
          {testResults.health && (
            <div className={`mt-4 p-4 rounded-lg border ${getStatusColor(testResults.health.status)}`}>
              <div className="flex items-center space-x-2">
                {getStatusIcon(testResults.health.status)}
                <span className="font-medium">
                  {testResults.health.status === 'success' ? 'Success' : 
                   testResults.health.status === 'error' ? 'Error' : 'Running'}
                </span>
              </div>
              <p className="mt-2 text-sm">{testResults.health.message}</p>
            </div>
          )}
        </div>

        {/* Git Functionality Test */}
        <div className="card">
          <div className="flex items-center space-x-3 mb-4">
            <GitBranch className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">Git Functionality</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Test Git operations and repository access
          </p>
          <button
            onClick={() => runTest('git', testGit)}
            className="btn-primary"
            disabled={testResults.git?.status === 'running'}
          >
            Test Git
          </button>
          {testResults.git && (
            <div className={`mt-4 p-4 rounded-lg border ${getStatusColor(testResults.git.status)}`}>
              <div className="flex items-center space-x-2">
                {getStatusIcon(testResults.git.status)}
                <span className="font-medium">
                  {testResults.git.status === 'success' ? 'Success' : 
                   testResults.git.status === 'error' ? 'Error' : 'Running'}
                </span>
              </div>
              <p className="mt-2 text-sm">{testResults.git.message}</p>
            </div>
          )}
        </div>

        {/* Project Creation Test */}
        <div className="card">
          <div className="flex items-center space-x-3 mb-4">
            <FolderOpen className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-semibold text-gray-900">Project Creation</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Test project creation workflow with sample data
          </p>
          <button
            onClick={() => runTest('project', testProjectCreation)}
            className="btn-primary"
            disabled={testResults.project?.status === 'running'}
          >
            Test Project Creation
          </button>
          {testResults.project && (
            <div className={`mt-4 p-4 rounded-lg border ${getStatusColor(testResults.project.status)}`}>
              <div className="flex items-center space-x-2">
                {getStatusIcon(testResults.project.status)}
                <span className="font-medium">
                  {testResults.project.status === 'success' ? 'Success' : 
                   testResults.project.status === 'error' ? 'Error' : 'Running'}
                </span>
              </div>
              <p className="mt-2 text-sm">{testResults.project.message}</p>
            </div>
          )}
        </div>

        {/* System Information */}
        <div className="card">
          <div className="flex items-center space-x-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
            <h2 className="text-xl font-semibold text-gray-900">System Information</h2>
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <p><strong>API Base URL:</strong> {apiBaseUrl}</p>
            <p><strong>Environment:</strong> {process.env.NODE_ENV || 'development'}</p>
            <p><strong>Current Time:</strong> {new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Debug;
