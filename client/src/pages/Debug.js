import React from 'react';
import { apiBaseUrl } from '../config';
import { useProjects } from '../context/ProjectContext';
import { 
  TestTube, 
  Activity, 
  GitBranch, 
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Database,
  Code,
  FileText,
  GitBranch as GitIcon,
  RefreshCw
} from 'lucide-react';

const Debug = () => {
  const [testResults, setTestResults] = React.useState({});
  const [debugData, setDebugData] = React.useState({});
  const { projects, loading, error } = useProjects();

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

  const getBackendDebugInfo = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/debug/projects`);
      const data = await response.json();
      setDebugData(prev => ({ ...prev, backend: data }));
      return `Backend debug info loaded! Total projects: ${data.totalProjects}`;
    } catch (error) {
      throw new Error(`Failed to get backend debug info: ${error.message}`);
    }
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
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4 flex items-center justify-center space-x-3">
          <TestTube className="w-10 h-10 text-blue-600" />
          <span>Debug & Testing</span>
        </h1>
        <p className="text-xl text-gray-600">
          Comprehensive debugging and testing tools for GitGen
        </p>
      </div>

      {/* Frontend Debug Info */}
      <div className="mb-8">
        <div className="card">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
            <Code className="w-6 h-6 text-blue-600" />
            <span>Frontend Debug Info</span>
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Loading State:</p>
                <p className="text-sm text-gray-600">{loading.toString()}</p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Projects Count:</p>
                <p className="text-sm text-gray-600">{projects.length}</p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Error State:</p>
                <p className="text-sm text-gray-600">{error || 'None'}</p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">API Base URL:</p>
                <p className="text-sm text-gray-600">{window.location.origin}</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Valid Projects:</p>
                <p className="text-sm text-gray-600">
                  {projects.filter(p => p && p.id && p.repoUrl).length} / {projects.length}
                </p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Completed Projects:</p>
                <p className="text-sm text-gray-600">
                  {projects.filter(p => p.status === 'completed').length}
                </p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Processing Projects:</p>
                <p className="text-sm text-gray-600">
                  {projects.filter(p => p.status === 'processing').length}
                </p>
              </div>
              
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-700">Failed Projects:</p>
                <p className="text-sm text-gray-600">
                  {projects.filter(p => p.status === 'failed').length}
                </p>
              </div>
            </div>
          </div>

          {/* Projects Data */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Projects Data</h3>
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto">
              <pre className="text-xs">{JSON.stringify(projects, null, 2)}</pre>
            </div>
          </div>

          {/* Filtered Projects */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Valid Projects (Filtered)</h3>
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto">
              <pre className="text-xs">{JSON.stringify(projects.filter(p => p && p.id && p.repoUrl), null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* Backend Debug Info */}
      <div className="mb-8">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <Database className="w-6 h-6 text-green-600" />
              <span>Backend Debug Info</span>
            </h2>
            <button
              onClick={() => runTest('backendDebug', getBackendDebugInfo)}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh Backend Info</span>
            </button>
          </div>
          
          {debugData.backend ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-800">Total Projects:</p>
                  <p className="text-lg font-bold text-green-600">{debugData.backend.totalProjects}</p>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-800">Timestamp:</p>
                  <p className="text-sm text-blue-600">{debugData.backend.timestamp}</p>
                </div>
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm font-medium text-purple-800">Backend Status:</p>
                  <p className="text-sm text-purple-600">Running</p>
                </div>
              </div>
              
              <div className="mt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Backend Projects Details</h3>
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto">
                  <pre className="text-xs">{JSON.stringify(debugData.backend.projects, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Database className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Click "Refresh Backend Info" to load backend debug information</p>
            </div>
          )}
        </div>
      </div>

      {/* Debug Buttons */}
      <div className="mb-8">
        <div className="card">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
            <GitIcon className="w-6 h-6 text-orange-600" />
            <span>Debug Actions</span>
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button 
              onClick={() => runTest('backendDebug', getBackendDebugInfo)}
              className="btn-secondary text-sm p-3 flex items-center space-x-2"
            >
              <Database className="w-4 h-4" />
              <span>Debug Projects (Backend)</span>
            </button>
            
            <button 
              onClick={() => runTest('testBackend', testAPI)}
              className="btn-secondary text-sm p-3 flex items-center space-x-2"
            >
              <TestTube className="w-4 h-4" />
              <span>Test Backend</span>
            </button>
            
            <button 
              onClick={() => runTest('testHealth', testHealth)}
              className="btn-secondary text-sm p-3 flex items-center space-x-2"
            >
              <Activity className="w-4 h-4" />
              <span>Health Check</span>
            </button>
            
            <button 
              onClick={() => runTest('testGit', testGit)}
              className="btn-secondary text-sm p-3 flex items-center space-x-2"
            >
              <GitIcon className="w-4 h-4" />
              <span>Test Git</span>
            </button>
            
            <button 
              onClick={() => runTest('testProjectCreation', testProjectCreation)}
              className="btn-secondary text-sm p-3 flex items-center space-x-2"
            >
              <FileText className="w-4 h-4" />
              <span>Create Test Project</span>
            </button>
            
            <button 
              onClick={() => window.location.reload()}
              className="btn-primary text-sm p-3 flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Page</span>
            </button>
          </div>
        </div>
      </div>

      {/* Test Results */}
      <div className="mb-8">
        <div className="card">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
            <TestTube className="w-6 h-6 text-purple-600" />
            <span>Test Results</span>
          </h2>
          
          <div className="space-y-3">
            {Object.entries(testResults).map(([testName, result]) => (
              <div key={testName} className={`p-4 border rounded-lg ${getStatusColor(result.status)}`}>
                <div className="flex items-center space-x-3">
                  {getStatusIcon(result.status)}
                  <div className="flex-1">
                    <h3 className="font-medium capitalize">{testName.replace(/([A-Z])/g, ' $1').trim()}</h3>
                    <p className="text-sm mt-1">{result.message}</p>
                  </div>
                </div>
              </div>
            ))}
            
            {Object.keys(testResults).length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <TestTube className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>No tests have been run yet. Use the debug actions above to start testing.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Debug;
