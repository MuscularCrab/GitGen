import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../context/ProjectContext';
import { apiBaseUrl } from '../config';
import { 
  BookOpen, 
  GitBranch, 
  Zap, 
  Shield, 
  Users, 
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';

const Home = () => {
  const { createProject, loading, error, clearError } = useProjects();
  const [formData, setFormData] = useState({
    repoUrl: '',
    projectName: '',
    description: ''
  });

  // Add AI status display
  const [aiConfig, setAiConfig] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);

  useEffect(() => {
    const checkAIStatus = async () => {
      try {
        setAiLoading(true);
        const response = await fetch('/api/ai-config');
        const config = await response.json();
        setAiConfig(config);
      } catch (error) {
        console.error('Failed to check AI status:', error);
      } finally {
        setAiLoading(false);
      }
    };
    
    checkAIStatus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    
    console.log('Form submitted with data:', formData);
    
    try {
      console.log('Calling createProject...');
      const projectId = await createProject(formData);
      console.log('Project created successfully with ID:', projectId);
      // Redirect to project detail page
      window.location.href = `/projects/${projectId}`;
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const features = [
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Generate comprehensive documentation in seconds, not minutes.'
    },
    {
      icon: Shield,
      title: 'Secure & Private',
      description: 'Your code stays private. We only process what you share.'
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Share documentation with your team and stakeholders.'
    },
    {
      icon: BookOpen,
      title: 'Smart Analysis',
      description: 'AI-powered code analysis for better documentation.'
    }
  ];

  const supportedLanguages = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'PHP',
    'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', 'Scala', 'Clojure'
  ];

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="text-center py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Generate Documentation
            <span className="text-primary-600"> Automatically</span>
          </h1>
                     <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
             Transform your Git repositories into beautiful, comprehensive documentation 
             with just a few clicks. Generate brand new README files automatically based on your code analysis.
           </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/projects"
              className="btn-primary text-lg px-8 py-3 inline-flex items-center space-x-2"
            >
              <span>View Projects</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#how-it-works"
              className="btn-secondary text-lg px-8 py-3"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Project Creation Form */}
      <section className="max-w-2xl mx-auto">
        <div className="card">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Start Your First Project
            </h2>
                         <p className="text-gray-600">
               Enter your Git repository URL and we'll analyze your code to generate a brand new README file automatically.
             </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2 text-red-800">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Debug section */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center space-x-2 text-blue-800 mb-2">
              <span className="text-sm font-medium">Debug: Test API Connection</span>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    console.log('Testing API connection...');
                    const response = await fetch(`${apiBaseUrl}/api/test`);
                    const data = await response.json();
                    console.log('API test response:', data);
                    alert(`API is working! Response: ${JSON.stringify(data)}`);
                  } catch (error) {
                    console.error('API test failed:', error);
                    alert(`API test failed: ${error.message}`);
                  }
                }}
                className="btn-secondary text-sm px-3 py-1 mr-2"
              >
                Test API
              </button>
                             <button
                 type="button"
                 onClick={async () => {
                   try {
                     console.log('Testing health endpoint...');
                     const response = await fetch(`${apiBaseUrl}/api/health`);
                     const data = await response.json();
                     console.log('Health check response:', data);
                     alert(`Health check passed! Response: ${JSON.stringify(data)}`);
                   } catch (error) {
                     console.error('Health check failed:', error);
                     alert(`Health check failed: ${error.message}`);
                   }
                 }}
                 className="btn-secondary text-sm px-3 py-1"
               >
                 Health Check
               </button>
               <button
                 type="button"
                 onClick={async () => {
                   try {
                     console.log('Testing Git functionality...');
                     const response = await fetch(`${apiBaseUrl}/api/test-git`);
                     const data = await response.json();
                     console.log('Git test response:', data);
                     alert(`Git test response: ${JSON.stringify(data)}`);
                   } catch (error) {
                     console.error('Git test failed:', error);
                     alert(`Git test failed: ${error.message}`);
                   }
                 }}
                 className="btn-secondary text-sm px-3 py-1"
                                >
                   Test Git
                 </button>
                 <button
                   type="button"
                   onClick={async () => {
                     try {
                       console.log('Testing project creation...');
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
                       console.log('Test project response:', data);
                       alert(`Test project created! Response: ${JSON.stringify(data)}`);
                     } catch (error) {
                       console.error('Test project creation failed:', error);
                       alert(`Test project creation failed: ${error.message}`);
                     }
                   }}
                   className="btn-secondary text-sm px-3 py-1"
                 >
                   Test Project Creation
                 </button>
                 <button
                   type="button"
                   onClick={() => {
                     console.log('Emergency stop: resetting loading state');
                     // Force reset the loading state
                     window.location.reload();
                   }}
                   className="btn-secondary text-sm px-3 py-1 bg-red-100 text-red-800 border-red-300 hover:bg-red-200"
                 >
                   Emergency Stop
                 </button>
               </div>
             </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700 mb-2">
                Git Repository URL *
              </label>
              <input
                type="url"
                id="repoUrl"
                name="repoUrl"
                value={formData.repoUrl}
                onChange={handleInputChange}
                placeholder="https://github.com/username/repository"
                className="input-field"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                Supports GitHub, GitLab, Bitbucket, and other Git hosting services
              </p>
            </div>

            <div>
              <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-2">
                Project Name *
              </label>
              <input
                type="text"
                id="projectName"
                name="projectName"
                value={formData.projectName}
                onChange={handleInputChange}
                placeholder="My Awesome Project"
                className="input-field"
                required
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Brief description of your project..."
                rows="3"
                className="input-field"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="flex items-center justify-center space-x-2">
                  <Clock className="w-5 h-5 animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center space-x-2">
                  <BookOpen className="w-5 h-5" />
                  <span>Generate Documentation</span>
                </div>
              )}
            </button>
          </form>

          {/* AI Status Display */}
          {aiConfig && (
            <div className="mt-8 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
              <div className="flex items-center space-x-2 text-purple-800 mb-2">
                <span className="text-sm font-medium">
                  {aiConfig.aiEnabled ? '🤖 AI-Powered Generation' : '⚠️ AI Generation Disabled'}
                </span>
              </div>
              <div className="text-sm text-purple-700">
                {aiConfig.aiEnabled ? (
                  <div>
                    <p>✅ Using Gemini AI for intelligent README generation</p>
                    <p className="text-xs mt-1">Model: {aiConfig.model} | Temperature: {aiConfig.temperature}</p>
                  </div>
                ) : (
                  <div>
                    <p>Using template-based generation. Add GEMINI_API_KEY to enable AI.</p>
                    <a 
                      href="https://makersuite.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-800 underline text-xs"
                    >
                      Get Gemini API Key
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Why Choose GitGen?
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Built for developers, by developers. Get professional-grade documentation 
            without the hassle.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="text-center">
                <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-8 h-8 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-600">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Supported Languages */}
      <section className="py-16 bg-white rounded-2xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Supports All Major Languages
          </h2>
          <p className="text-xl text-gray-600">
            From JavaScript to Rust, we've got you covered.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 max-w-4xl mx-auto">
          {supportedLanguages.map((language, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-lg p-4 text-center hover:bg-primary-50 transition-colors duration-200"
            >
              <span className="text-sm font-medium text-gray-700">{language}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Three simple steps to beautiful documentation
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
              1
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Connect Repository
            </h3>
            <p className="text-gray-600">
              Provide your Git repository URL and project details
            </p>
          </div>

                     <div className="text-center">
             <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
               2
             </div>
             <h3 className="text-lg font-semibold text-gray-900 mb-2">
               Code Analysis
             </h3>
             <p className="text-gray-600">
               Our system analyzes your code structure, functions, and dependencies
             </p>
           </div>

                     <div className="text-center">
             <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
               3
             </div>
             <h3 className="text-lg font-semibold text-gray-900 mb-2">
               New README Generated
             </h3>
             <p className="text-gray-600">
               Get a professional README file ready to use in your repository
             </p>
           </div>
        </div>
      </section>
    </div>
  );
};

export default Home;