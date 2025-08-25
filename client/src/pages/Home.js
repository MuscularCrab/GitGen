import React, { useState } from 'react';
import { useProjects } from '../context/ProjectContext';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const { createProject } = useProjects();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    repoUrl: '',
    projectName: '',
    description: '',
    mode: 'v2' // Default to v2
  });
  const [processingProgress, setProcessingProgress] = useState(null);
  const [readmeModes, setReadmeModes] = useState(null);
  const [loadingModes, setLoadingModes] = useState(false);

  // Load README modes on component mount
  React.useEffect(() => {
    loadReadmeModes();
  }, []);

  const loadReadmeModes = async () => {
    setLoadingModes(true);
    try {
      const response = await fetch('/api/readme-modes');
      if (response.ok) {
        const data = await response.json();
        setReadmeModes(data.modes);
      }
    } catch (error) {
      console.error('Error loading README modes:', error);
    } finally {
      setLoadingModes(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.repoUrl) {
      alert('Please fill in the Repository URL');
      return;
    }

    try {
      // Extract project name from repository URL if not provided
      let projectName = formData.projectName;
      if (!projectName) {
        const urlParts = formData.repoUrl.split('/');
        projectName = urlParts[urlParts.length - 1]?.replace('.git', '') || 'Project';
      }

      const project = await createProject({
        repoUrl: formData.repoUrl,
        projectName: projectName,
        description: formData.description,
        mode: formData.mode
      });

      console.log('Project created:', project);

      // Handle different possible response structures
      const projectId = project?.projectId || project?.id || project?.project?.id;
      
      if (projectId) {
        console.log('Starting to monitor project:', projectId);
        
        // Check if the project is already completed
        if (project.status === 'completed') {
          console.log('Project already completed, redirecting immediately...');
          setFormData(prev => ({ ...prev, submitted: true, success: true }));
          // Redirect immediately for completed projects
          setTimeout(() => {
            try {
              navigate(`/projects/${projectId}`);
            } catch (navError) {
              console.error('React Router navigation failed, using fallback:', navError);
              window.location.href = `/projects/${projectId}`;
            }
          }, 100);
        } else {
          // Start monitoring for processing projects
          setFormData(prev => ({ ...prev, submitted: true, success: true }));
          monitorProjectStatus(projectId);
        }
      } else {
        console.error('Invalid project response - no projectId found:', project);
        alert('Invalid project response. Please try again.');
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project. Please try again.');
    }
  };

  const monitorProjectStatus = async (projectId) => {
    try {
      console.log(`Monitoring project ${projectId}...`);
      const response = await fetch(`/api/projects/${projectId}/progress`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const project = await response.json();
      console.log('Project progress update:', project);
      console.log('Project status:', project.status);
      console.log('Project step:', project.step);
      console.log('Project percentage:', project.percentage);

      if (project.status === 'completed' || project.status === 'failed') {
        console.log('AI generation completed, redirecting to project...', project.status);
        if (project.status === 'completed') {
          console.log('Redirecting to project detail page...');
          // Add a small delay to ensure state updates are processed
          setTimeout(() => {
            try {
              navigate(`/projects/${projectId}`);
            } catch (navError) {
              console.error('React Router navigation failed, using fallback:', navError);
              window.location.href = `/projects/${projectId}`;
            }
          }, 100);
        } else {
          alert(`Project failed: ${project.message || 'Unknown error'}`);
        }
      } else {
        console.log('Project still processing, continuing to monitor...');
        setProcessingProgress(project);
        // Continue monitoring every 2 seconds
        setTimeout(() => monitorProjectStatus(projectId), 2000);
      }
    } catch (error) {
      console.error('Error monitoring project status:', error);
      // Continue monitoring even if there's an error
      setTimeout(() => monitorProjectStatus(projectId), 5000);
    }
  };

  return (
    <div className="min-h-screen home-background-light dark:home-background-dark">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
              GitGen
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300">
              AI-Powered README Generation for GitHub Repositories
            </p>
            <p className="text-lg text-gray-500 dark:text-gray-400 mt-2">
              Transform your repository into professional documentation in minutes
            </p>
          </div>

          {/* Main Form */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 mb-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Repository URL */}
              <div>
                <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Repository URL *
                </label>
                <input
                  type="url"
                  id="repoUrl"
                  name="repoUrl"
                  value={formData.repoUrl}
                  onChange={handleInputChange}
                  placeholder="https://github.com/username/repository"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  required
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Enter the HTTPS or SSH URL of your GitHub repository
                </p>
              </div>

              {/* Project Name */}
              <div>
                <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  id="projectName"
                  name="projectName"
                  value={formData.projectName}
                  onChange={handleInputChange}
                  placeholder="My Awesome Project"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Optional - will be extracted from repository if not provided
                </p>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Brief description of your project..."
                  rows="3"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Optional - AI will generate description from code analysis
                </p>
              </div>

              {/* README Generation Mode Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  README Generation Mode *
                </label>
                {loadingModes ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="loader"></div>
                    <span className="ml-2 text-gray-500">Loading modes...</span>
                  </div>
                ) : readmeModes ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(readmeModes).map(([modeKey, modeInfo]) => (
                      <div
                        key={modeKey}
                        className={`relative border-2 rounded-lg p-4 cursor-pointer transition-all ${
                          formData.mode === modeKey
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, mode: modeKey }))}
                      >
                        <div className="flex items-start space-x-3">
                          <input
                            type="radio"
                            name="mode"
                            value={modeKey}
                            checked={formData.mode === modeKey}
                            onChange={() => setFormData(prev => ({ ...prev, mode: modeKey }))}
                            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                          />
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {modeInfo.name}
                              </h3>
                              {modeInfo.recommended && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  Recommended
                                </span>
                              )}
                              {modeInfo.default && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                              {modeInfo.description}
                            </p>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              <strong>Features:</strong>
                              <ul className="mt-1 space-y-1">
                                {modeInfo.features.map((feature, index) => (
                                  <li key={index} className="flex items-center">
                                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-2"></span>
                                    {feature}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    Failed to load README modes. Using default mode.
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={formData.submitted}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {formData.submitted ? 'Generating Documentation...' : 'Generate Documentation'}
                </button>
              </div>
            </form>

            {/* Success Message and Progress */}
            {formData.submitted && formData.success && (
              <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800 dark:text-green-200">
                      {processingProgress && processingProgress.status === 'completed' 
                        ? 'Documentation already generated!' 
                        : 'Documentation generation started!'}
                    </h3>
                    <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                      {processingProgress && processingProgress.status === 'completed'
                        ? 'This project has already been processed. Redirecting to view the generated documentation...'
                        : 'We\'re analyzing your repository and generating comprehensive documentation. This may take a few minutes.'}
                    </p>
                  </div>
                </div>

                {/* Progress Display */}
                {processingProgress && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm text-green-700 mb-2">
                      <span>{processingProgress.message || 'Processing...'}</span>
                      <span>{processingProgress.percentage || 0}%</span>
                    </div>
                    <div className="w-full bg-green-200 rounded-full h-2 mb-3">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${processingProgress.percentage || 0}%` }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-6 gap-2 text-xs">
                      {[
                        { step: 1, label: 'Setup' }, { step: 2, label: 'Clone' },
                        { step: 3, label: 'Analyze' }, { step: 4, label: 'Generate' },
                        { step: 5, label: 'AI' }, { step: 6, label: 'Complete' }
                      ].map((stage) => (
                        <div key={stage.step} className="text-center">
                          <div className={`w-4 h-4 rounded-full mx-auto mb-1 ${
                            processingProgress.step >= stage.step ? 'bg-green-600' : 'bg-green-200'
                          }`}></div>
                          <span className={processingProgress.step >= stage.step ? 'font-medium text-green-700' : 'text-green-500'}>
                            {stage.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    {processingProgress.estimatedTime && (
                      <div className="mt-3 text-xs text-green-600 text-center">
                        <strong>Estimated Time Remaining:</strong> ~{processingProgress.estimatedTime} seconds
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Features Section */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-8">
              Why Choose GitGen?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Lightning Fast</h3>
                <p className="text-gray-600 dark:text-gray-400">Generate professional READMEs in minutes, not hours</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">AI-Powered</h3>
                <p className="text-gray-600 dark:text-gray-400">Advanced AI analyzes your code and generates intelligent documentation</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Professional Quality</h3>
                <p className="text-gray-600 dark:text-gray-400">GitHub-ready documentation that impresses contributors and users</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;